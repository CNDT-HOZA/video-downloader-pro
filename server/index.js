const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec, execSync, spawn } = require('child_process');
const { resolveAllTools, isToolResolved, getAppDir } = require('./lib/resolve-tools');
const TaskManager = require('./lib/task-manager');
const { downloadVideo, getFormats } = require('./lib/downloader');
const { convertToMp4 } = require('./lib/converter');
const proxyManager = require('./lib/proxy-manager');
const { ensureAllTools } = require('./lib/auto-install');

// Load proxies ngay khi khởi động
proxyManager.fetchProxies();

// Không gọi resolveAllTools() ở đây để tránh báo lỗi giả trước khi auto-install chạy

const os = require('os');
const app = express();
const PORT = 3847;

let OUTPUT_DIR = path.join(os.homedir(), 'Downloads');

const physicalDir = getAppDir();
const SETTINGS_FILE = path.join(physicalDir, 'settings.json');

try {
  if (fs.existsSync(SETTINGS_FILE)) {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    if (settings.outputDir) {
      OUTPUT_DIR = settings.outputDir;
    }
  }
} catch (err) {
  console.error('Error loading settings:', err);
}

try {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
} catch (err) {
  console.error(`[Warning] Could not create ${OUTPUT_DIR}, using local output folder.`);
  OUTPUT_DIR = process.pkg ? path.join(physicalDir, 'output') : path.resolve(__dirname, '..', 'output');
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

app.use(cors());
app.use(express.json());

const taskManager = new TaskManager(2);

const convertQueue = [];
let activeConverts = 0;
const MAX_CONVERTS = 1;

function processConvertQueue() {
  if (activeConverts >= MAX_CONVERTS || convertQueue.length === 0) return;
  const job = convertQueue.shift();
  activeConverts++;
  startConvertTask(job.taskId, job.downloadedPath);
}

async function startConvertTask(taskId, downloadedPath) {
  const task = taskManager.getTask(taskId);
  if (!task) {
    activeConverts--;
    processConvertQueue();
    return;
  }

  const ext = path.extname(downloadedPath).toLowerCase();
  taskManager.addLog(taskId, `Đang chuẩn bị xử lý file (${ext.replace('.','').toUpperCase()})...`);
  taskManager.updateTask(taskId, { status: 'converting', stage: 'convert', progress: 0, format: ext, childProcess: null });

  try {
    const result = await convertToMp4(downloadedPath, OUTPUT_DIR, task.options);
    const { childProcess: convProcess, emitter: convEmitter, isRemux } = result;

    if (isRemux) {
      taskManager.updateTask(taskId, { stage: 'remux', childProcess: convProcess });
    } else {
      taskManager.updateTask(taskId, { childProcess: convProcess });
    }

    convEmitter.on('progress', (pct) => {
      taskManager.updateTask(taskId, { progress: pct });
    });

    convEmitter.on('log', (msg) => {
      taskManager.addLog(taskId, msg);
    });

    convEmitter.on('complete', (finalPath) => {
      taskManager.addLog(taskId, `✅ Hoàn tất: ${finalPath}`);
      taskManager.updateTask(taskId, { status: 'done', stage: 'done', progress: 100, outputPath: finalPath, childProcess: null });
      activeConverts--;
      processConvertQueue();
    });

    convEmitter.on('error', (err) => {
      taskManager.addLog(taskId, `❌ Lỗi chuyển đổi: ${err.message}`);
      taskManager.updateTask(taskId, { status: 'error', error: err.message, childProcess: null });
      activeConverts--;
      processConvertQueue();
    });
  } catch (convErr) {
    taskManager.addLog(taskId, `❌ Lỗi khởi tạo converter: ${convErr.message}`);
    taskManager.updateTask(taskId, { status: 'error', error: convErr.message, childProcess: null });
    activeConverts--;
    processConvertQueue();
  }
}

taskManager.on('task:start', async (taskId) => {
  const task = taskManager.getTask(taskId);
  if (!task) return;

  // Nếu là task đang ở bước convert (do retry), đẩy thẳng vào hàng đợi
  if (task.stage === 'convert' && task.downloadedPath) {
    taskManager.addLog(taskId, `Đang xếp hàng chờ Convert...`);
    convertQueue.push({ taskId, downloadedPath: task.downloadedPath });
    processConvertQueue();
    return;
  }

  try {
    taskManager.addLog(taskId, `Bắt đầu tải: ${task.url}`);
    taskManager.updateTask(taskId, { status: 'downloading', stage: 'download', progress: 0, error: null });

    const { childProcess: dlProcess, emitter: dlEmitter } = downloadVideo(task.url, OUTPUT_DIR, task.options);
    taskManager.updateTask(taskId, { childProcess: dlProcess });

    dlEmitter.on('progress', (pct) => {
      taskManager.updateTask(taskId, { progress: pct });
    });

    dlEmitter.on('log', (msg) => {
      taskManager.addLog(taskId, msg);
    });

    dlEmitter.on('complete', async (downloadedPath) => {
      taskManager.updateTask(taskId, { downloadedPath, childProcess: null });
      taskManager.addLog(taskId, `Tải xong, đang xếp hàng chờ Convert...`);
      convertQueue.push({ taskId, downloadedPath });
      processConvertQueue();
    });

    dlEmitter.on('error', (err) => {
      taskManager.addLog(taskId, `❌ Lỗi tải: ${err.message}`);
      taskManager.updateTask(taskId, { status: 'error', error: err.message, childProcess: null });
    });

  } catch (error) {
    taskManager.addLog(taskId, `❌ Lỗi: ${error.message}`);
    taskManager.updateTask(taskId, { status: 'error', error: error.message });
  }
});

// Endpoints

let isServerReady = false;
let startupError = null;

app.get('/api/health', (req, res) => {
  if (!isServerReady) {
    return res.json({ status: 'installing', version: '1.0.0' });
  }

  const missing = ['yt-dlp', 'ffmpeg', 'ffprobe'].filter((t) => !isToolResolved(t));
  res.json({
    status: 'ok',
    version: '1.0.0',
    missingTools: missing,
    startupError: startupError || undefined,
  });
});

app.all('/api/formats', async (req, res) => {
  try {
    const url = req.method === 'POST' ? req.body.url : req.query.url;
    const cookies = req.method === 'POST' ? req.body.cookies : null;
    
    if (!url) return res.status(400).json({ error: 'URL is required' });
    
    const info = await getFormats(url, cookies);
    res.json(info);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/download', (req, res) => {
  const { url, quality, codec, keepOriginalRes, targetRes, formatId, cookies, proxy } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  
  const options = { codec: codec || 'h264', keepOriginalRes, targetRes, cookies, proxy };

  if (formatId) {
    options.formatId = formatId;
  } else {
    const qualityMap = { '2160': 'best4k', '1440': 'best1440', '1080': 'best1080', '720': 'best1080', 'best': 'best' };
    options.quality = qualityMap[quality] || quality || 'best';
  }

  const taskId = taskManager.createTask(url, options);
  res.json({ taskId, message: 'Download started' });
});

app.get('/api/status/:taskId', (req, res) => {
  const { taskId } = req.params;
  const task = taskManager.getTask(taskId);
  
  if (!task) return res.status(404).json({ error: 'Task not found' });
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  res.write(`data: ${JSON.stringify(task)}\n\n`);
  
  const onUpdate = (id, updatedTask) => {
    if (id === taskId) {
      res.write(`data: ${JSON.stringify(updatedTask)}\n\n`);
      if (['done', 'error', 'cancelled'].includes(updatedTask.status)) {
        res.end();
        taskManager.removeListener('task:update', onUpdate);
      }
    }
  };
  
  taskManager.on('task:update', onUpdate);
  
  req.on('close', () => {
    taskManager.removeListener('task:update', onUpdate);
  });
});

app.get('/api/history', (req, res) => {
  res.json(taskManager.getAllTasks());
});

app.delete('/api/cancel/:taskId', (req, res) => {
  const { taskId } = req.params;
  const success = taskManager.cancelTask(taskId);
  
  if (success) {
    res.json({ message: 'Task cancelled' });
  } else {
    res.status(404).json({ error: 'Task not found' });
  }
});

app.post('/api/retry/:taskId', (req, res) => {
  const { taskId } = req.params;
  const task = taskManager.getTask(taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (task.status !== 'error' && task.status !== 'paused') {
    return res.status(400).json({ error: 'Only failed/paused tasks can be retried' });
  }

  taskManager.addLog(taskId, 'Đang tiếp tục tải (từ dữ liệu cũ)...');
  
  // Xóa error, giữ nguyên stage để biết tiếp tục từ đâu
  taskManager.updateTask(taskId, { status: 'pending', error: null, progress: 0 });

  // Đẩy lại vào queue của taskManager
  taskManager.queue.push(taskId);
  taskManager._processQueue();

  res.json({ message: 'Retry initiated' });
});

app.post('/api/pause/:taskId', (req, res) => {
  const { taskId } = req.params;
  const task = taskManager.getTask(taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (task.status !== 'downloading' && task.status !== 'converting') {
    return res.status(400).json({ error: 'Task is not active' });
  }

  // Kill process nhưng giữ file tạm (yt-dlp --continue sẽ tiếp tục)
  if (task.childProcess) {
    try { task.childProcess.kill('SIGTERM'); } catch(e) {}
  }

  const pausedStage = task.status; // 'downloading' hoặc 'converting'
  taskManager.addLog(taskId, `⏸️ Đã tạm dừng (${pausedStage === 'downloading' ? 'đang tải' : 'đang chuyển đổi'})`);
  taskManager.updateTask(taskId, { status: 'paused', pausedStage, childProcess: null });

  // Nếu đang convert thì giảm activeConverts
  if (pausedStage === 'converting') {
    activeConverts--;
    processConvertQueue();
  }

  res.json({ message: 'Task paused' });
});

app.post('/api/resume/:taskId', (req, res) => {
  const { taskId } = req.params;
  const task = taskManager.getTask(taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (task.status !== 'paused') {
    return res.status(400).json({ error: 'Task is not paused' });
  }

  taskManager.addLog(taskId, '▶️ Đang tiếp tục...');

  if (task.pausedStage === 'converting' && task.downloadedPath) {
    // Tiếp tục convert
    taskManager.updateTask(taskId, { status: 'converting', error: null });
    convertQueue.push({ taskId, downloadedPath: task.downloadedPath });
    processConvertQueue();
  } else {
    // Tiếp tục download (yt-dlp --continue sẽ nối tiếp file .part)
    taskManager.updateTask(taskId, { status: 'pending', error: null, progress: 0 });
    taskManager.queue.push(taskId);
    taskManager._processQueue();
  }

  res.json({ message: 'Task resumed' });
});

app.delete('/api/clear-completed', (req, res) => {
  const success = taskManager.clearCompletedTasks();
  res.json({ success, message: 'Cleared completed tasks' });
});

app.get('/api/check-tools', async (req, res) => {
  try {
    const paths = resolveAllTools();
    const toolsToCheck = ['ffmpeg', 'ffprobe', 'yt-dlp'];
    const results = [];

    for (const name of toolsToCheck) {
      let installed = false;
      let version = null;
      let toolPath = paths[name] || null;

      try {
        if (toolPath) {
          const versionFlag = (name === 'ffmpeg' || name === 'ffprobe') ? '-version' : '--version';
          const cmd = `"${toolPath}" ${versionFlag}`;
          const output = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
          installed = true;
          version = output.split('\n')[0].trim();
        }
      } catch (e) {
        installed = false;
      }

      results.push({ name, installed, version, path: toolPath });
    }

    res.json({ tools: results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/install-tool', async (req, res) => {
  const { tool } = req.body;
  const { installYtDlp, installFFmpeg } = require('./lib/auto-install');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  res.write('data: ' + JSON.stringify({ log: 'Đang tải ' + tool + '...' }) + '\n\n');

  try {
    let ok = false;
    if (tool === 'yt-dlp') {
      ok = await installYtDlp();
    } else if (tool === 'ffmpeg' || tool === 'ffprobe') {
      ok = await installFFmpeg();
    } else if (tool === 'deno') {
      // Bỏ qua deno, không bắt buộc
      ok = true;
    }

    if (ok) {
      resolveAllTools();
      res.write('data: ' + JSON.stringify({ success: true, message: 'Đã cài đặt xong ' + tool }) + '\n\n');
    } else {
      res.write('data: ' + JSON.stringify({ success: false, message: 'Lỗi khi tải ' + tool }) + '\n\n');
    }
  } catch (e) {
    res.write('data: ' + JSON.stringify({ success: false, message: e.message }) + '\n\n');
  }
  res.end();
});

app.post('/api/open-folder', (req, res) => {
  let { path: folderPath } = req.body;
  
  try {
    if (!folderPath || !fs.existsSync(folderPath)) {
      // Fallback: Mở thư mục gốc nếu file không còn tồn tại hoặc không được cấp
      if (fs.existsSync(OUTPUT_DIR)) {
        exec(`explorer.exe "${OUTPUT_DIR}"`);
        return res.json({ success: true, fallback: true });
      }
      return res.status(404).json({ error: 'Path not found' });
    }

    const stats = fs.statSync(folderPath);
    if (stats.isDirectory()) {
      exec(`explorer.exe "${folderPath}"`);
    } else {
      exec(`explorer.exe /select,"${folderPath}"`);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Hộp thoại chọn thư mục.
 *
 * Vấn đề cốt lõi: tiến trình server chạy nền (được Chrome khởi động gián tiếp
 * qua native host) nên Windows KHÔNG cho nó chiếm foreground. Cách cũ gọi
 * Shell.BrowseForFolder với hwnd = 0 — hộp thoại có mở thật, nhưng không có
 * cửa sổ cha nên bị chìm xuống dưới trình duyệt và người dùng tưởng là không
 * hiện gì.
 *
 * Cách sửa: tạo một Form ẩn đặt TopMost làm cửa sổ cha. TopMost được vẽ đè lên
 * mọi cửa sổ khác mà KHÔNG cần quyền foreground, nên hộp thoại luôn nhìn thấy.
 */
function buildPickerScript(resultFile, startDir) {
  const q = (s) => String(s).replace(/'/g, "''"); // escape nháy đơn cho PowerShell

  return [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$owner = New-Object System.Windows.Forms.Form',
    '$owner.TopMost = $true',           // <- mấu chốt: luôn nổi lên trên
    '$owner.ShowInTaskbar = $false',
    "$owner.FormBorderStyle = 'None'",
    '$owner.Opacity = 0',
    '$owner.Size = New-Object System.Drawing.Size(1,1)',
    "$owner.StartPosition = 'CenterScreen'",
    '$owner.Show()',
    '$owner.Activate()',
    '[System.Windows.Forms.Application]::DoEvents()',
    '',
    '$dlg = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$dlg.Description = 'Chon thu muc luu video'",
    '$dlg.ShowNewFolderButton = $true',
    `if (Test-Path -LiteralPath '${q(startDir)}') { $dlg.SelectedPath = '${q(startDir)}' }`,
    '',
    '$result = $dlg.ShowDialog($owner)',
    '$owner.Close()',
    '',
    'if ($result -eq [System.Windows.Forms.DialogResult]::OK) {',
    `  Set-Content -LiteralPath '${q(resultFile)}' -Value $dlg.SelectedPath -Encoding UTF8`,
    '} else {',
    `  Set-Content -LiteralPath '${q(resultFile)}' -Value '__CANCELLED__' -Encoding UTF8`,
    '}',
  ].join('\r\n');
}

app.get('/api/pick-folder', (req, res) => {
  // Không dùng __dirname: dưới pkg nó là snapshot ảo chỉ đọc.
  // tmpdir luôn ghi được kể cả khi ứng dụng nằm trong Program Files.
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const resultFile = path.join(os.tmpdir(), `vd_pick_result_${stamp}.txt`);
  const scriptFile = path.join(os.tmpdir(), `vd_pick_folder_${stamp}.ps1`);

  try { fs.unlinkSync(resultFile); } catch {}

  try {
    // BOM UTF-8 bắt buộc: PowerShell 5.1 đọc file không BOM theo bảng mã ANSI,
    // đường dẫn tiếng Việt sẽ hỏng.
    fs.writeFileSync(scriptFile, '\uFEFF' + buildPickerScript(resultFile, OUTPUT_DIR), 'utf8');
  } catch (e) {
    return res.status(500).json({ error: `Không tạo được hộp thoại chọn thư mục: ${e.message}` });
  }

  const powershell = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'
  );

  // -STA bắt buộc cho WinForms; windowsHide chỉ giấu cửa sổ console của
  // PowerShell, hộp thoại được tạo sau nên vẫn hiện bình thường.
  const child = spawn(powershell, [
    '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', scriptFile
  ], { windowsHide: true });

  let answered = false;
  const finish = (payload, status) => {
    if (answered) return;
    answered = true;
    try { fs.unlinkSync(scriptFile); } catch {}
    try { fs.unlinkSync(resultFile); } catch {}
    res.status(status || 200).json(payload);
  };

  const timer = setTimeout(() => {
    try { child.kill(); } catch {}
    finish({ cancelled: true, reason: 'timeout' });
  }, 180000);

  child.on('error', (err) => {
    clearTimeout(timer);
    finish({ error: `Không chạy được PowerShell: ${err.message}` }, 500);
  });

  child.on('close', () => {
    clearTimeout(timer);
    try {
      // Set-Content -Encoding UTF8 của PowerShell 5.1 ghi kèm BOM, phải bỏ đi
      const selected = fs.readFileSync(resultFile, 'utf8').replace(/^\uFEFF/, '').trim();
      if (!selected || selected === '__CANCELLED__') {
        return finish({ cancelled: true });
      }
      finish({ path: selected });
    } catch {
      finish({ cancelled: true });
    }
  });
});

app.get('/api/settings', (req, res) => {
  res.json({ outputDir: OUTPUT_DIR });
});

app.post('/api/settings', (req, res) => {
  const { outputDir } = req.body;
  if (!outputDir) return res.status(400).json({ error: 'outputDir is required' });

  try {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    OUTPUT_DIR = outputDir;
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ outputDir: OUTPUT_DIR }, null, 2));

    res.json({ success: true, outputDir: OUTPUT_DIR });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const server = app.listen(PORT, async () => {
  console.log(`\n=============================================`);
  console.log(`Video Downloader Server starting...`);
  console.log(`Listening on http://localhost:${PORT}`);
  console.log(`App Directory:    ${physicalDir}`);
  console.log(`Output Directory: ${OUTPUT_DIR}`);
  console.log(`=============================================\n`);

  // Tự đăng ký Native Messaging Host nếu chưa đúng.
  // Nhờ vậy chỉ cần chạy server MỘT LẦN bằng bất kỳ cách nào (bấm đúp
  // server.exe, START_SERVER.bat) là auto-start được thiết lập — không phải
  // nhớ chạy setup.bat, và tự sửa lại khi thư mục bị di chuyển.
  try {
    const reg = require('./setup-registry').ensureRegistered();
    if (reg.changed && reg.ok) {
      console.log(`[Setup] Da tu dang ky Native Messaging Host cho ${reg.count} trinh duyet.`);
    } else if (reg.changed && !reg.ok) {
      console.error(`[Setup] Tu dang ky that bai: ${reg.error || 'khong ro'}`);
    }
  } catch (err) {
    console.error('[Setup] Bo qua tu dang ky:', err.message);
  }

  // Tự động tải tool thiếu.
  // Bất kỳ lỗi nào ở đây cũng KHÔNG được chặn isServerReady — nếu không
  // /api/health sẽ trả 'installing' vĩnh viễn và extension kẹt ở màn hình chờ.
  try {
    await ensureAllTools();
  } catch (err) {
    startupError = err.message;
    console.error('[Startup] ensureAllTools thất bại:', err.message);
  }

  try {
    resolveAllTools();
  } catch (err) {
    startupError = startupError || err.message;
    console.error('[Startup] resolveAllTools thất bại:', err.message);
  }

  const missing = ['yt-dlp', 'ffmpeg', 'ffprobe'].filter((t) => !isToolResolved(t));
  if (missing.length > 0) {
    console.error(`[Startup] ⚠️  Thiếu công cụ: ${missing.join(', ')}`);
    console.error(`[Startup]     Đặt các file .exe vào: ${path.join(physicalDir, 'bin')}`);
  }

  isServerReady = true;
  console.log('[Startup] Server sẵn sàng.');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[Startup] Cổng ${PORT} đã bị chiếm — có thể server đang chạy sẵn. Thoát.`);
    process.exit(0);
  }
  console.error('[Startup] Không mở được cổng:', err.message);
  process.exit(1);
});

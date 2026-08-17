const { spawn } = require('child_process');
const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');
const { getToolPath, isToolResolved } = require('./resolve-tools');

/**
 * Tham số JS runtime cho yt-dlp.
 *
 * YouTube bắt giải "n challenge" bằng JavaScript; không có runtime thì yt-dlp
 * chỉ lấy được ảnh và báo "Requested format is not available".
 *
 * Hai điểm bắt buộc, đều từng làm hỏng chức năng tải:
 *
 *  1. PHẢI truyền --js-runtimes. Mặc định yt-dlp đánh dấu node là
 *     "(unavailable)" dù node.exe nằm trong PATH — cờ này mới bật nó lên.
 *  2. PHẢI kèm đường dẫn tuyệt đối (cú pháp RUNTIME:PATH). Server dựng lại PATH
 *     từ registry, mà nhiều bản cài (deno/node qua WinGet) không ghi vào registry
 *     PATH, nên tiến trình con không thấy chúng.
 *
 * Truyền cả deno lẫn node nếu có; yt-dlp tự ưu tiên deno.
 */
function jsRuntimeArgs() {
  const args = [];
  for (const name of ['deno', 'node']) {
    if (isToolResolved(name)) {
      args.push('--js-runtimes', `${name}:${getToolPath(name)}`);
    }
  }
  return args;
}

function downloadVideo(url, outputDir, options = {}) {
  const emitter = new EventEmitter();

  const formatArgs = [];

  if (options.formatId) {
    formatArgs.push('-f', `${options.formatId}+bestaudio/${options.formatId}/best`);
  } else {
    switch (options.quality) {
      case 'best4k':
        formatArgs.push('-f', 'bestvideo[height<=2160]+bestaudio/best[height<=2160]/best');
        break;
      case 'best1440':
        formatArgs.push('-f', 'bestvideo[height<=1440]+bestaudio/best[height<=1440]/best');
        break;
      case 'best1080':
        formatArgs.push('-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best');
        break;
      default:
        formatArgs.push('-f', 'bestvideo+bestaudio/best');
        break;
    }
  }

  const args = [
    ...formatArgs,
    '--no-playlist',
    '--merge-output-format', 'mkv',
    '--remote-components', 'ejs:github',
    ...jsRuntimeArgs(),
    '--continue',
    '--socket-timeout', '60',
    '--retries', '30',
    '--fragment-retries', '30',
    '--retry-sleep', 'linear=1::3',
    '--file-access-retries', '5',
  ];

  let cookieFile = null;
  if (options.cookies) {
    const os = require('os');
    cookieFile = path.join(os.tmpdir(), `yt-cookies-${Date.now()}-${Math.floor(Math.random()*1000)}.txt`);
    fs.writeFileSync(cookieFile, options.cookies, 'utf-8');
    args.push('--cookies', cookieFile);
  }

  if (options.proxy) {
    console.log(`[Downloader] Sử dụng Proxy: ${options.proxy}`);
    args.push('--proxy', options.proxy);
  }

  args.push(
    '-o', path.join(outputDir, `temp_${options.taskId}_%(title).80B.%(ext)s`),
    '--newline',
    '--windows-filenames',
    url
  );

  const ytDlp = getToolPath('yt-dlp');
  console.log(`[Downloader] ${ytDlp} ${args.join(' ')}`);
  emitter.emit('log', `Đang tải từ: ${url}`);

  const proc = spawn(ytDlp, args, {
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    windowsHide: true,
  });

  let spawnFailed = false;
  proc.on('error', (err) => {
    spawnFailed = true;
    emitter.emit('error', new Error(
      `Không chạy được yt-dlp (${ytDlp}): ${err.message}\n` +
      `Hãy mở tab Cài đặt trong extension và bấm "Tải công cụ", hoặc đặt yt-dlp.exe vào thư mục bin/.`
    ));
  });

  proc.stdout.on('data', (data) => {
    const lines = data.toString('utf-8').split(/\r?\n/);
    for (const line of lines) {
      const progressMatch = line.match(/\[download\]\s+(\d+\.\d+)%/);
      if (progressMatch) {
        emitter.emit('progress', parseFloat(progressMatch[1]));
      }
    }
  });

  let stderrData = '';
  proc.stderr.on('data', (data) => {
    stderrData += data.toString('utf-8');
  });

  proc.on('close', (code) => {
    if (cookieFile) {
      try { fs.unlinkSync(cookieFile); } catch (e) {}
    }
    if (spawnFailed) return; // đã báo lỗi ở handler 'error'
    if (code !== 0) {
      return emitter.emit('error', new Error(`yt-dlp thoát với code ${code}\nLỗi: ${stderrData.substring(0, 500)}`));
    }
    
    // Tìm file mkv mới nhất
    try {
      const files = fs.readdirSync(outputDir);
      let newestFile = null;
      let newestTime = 0;
      
      for (const f of files) {
        if (!f.startsWith(`temp_${options.taskId}_`)) continue;
        if (f.endsWith('.tmp.mp4')) continue; // Bỏ qua file tạm của FFmpeg nếu có
        
        const fullPath = path.join(outputDir, f);
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs > newestTime) {
          newestTime = stat.mtimeMs;
          newestFile = fullPath;
        }
      }
      
      if (newestFile) {
        console.log(`[Downloader] Complete: ${newestFile}`);
        emitter.emit('complete', newestFile);
      } else {
        emitter.emit('error', new Error('Không tìm thấy file đầu ra.'));
      }
    } catch (err) {
      emitter.emit('error', err);
    }
  });

  return { childProcess: proc, emitter };
}

const proxyManager = require('./proxy-manager');

async function getFormats(url, cookiesStr, useFallback = false, retryCount = 0, proxyLogs = []) {
  return new Promise(async (resolve, reject) => {
    const args = [
      '-J',
      '--no-playlist',
      '--remote-components', 'ejs:github',
      ...jsRuntimeArgs()
    ];

    if (useFallback) {
      args.push('--extractor-args', 'youtube:player_client=ios,android,web');
    }

    let cookieFile = null;
    if (cookiesStr && !useFallback) {
      cookieFile = path.join(require('os').tmpdir(), `yt-cookies-${Date.now()}-${Math.floor(Math.random()*1000)}.txt`);
      require('fs').writeFileSync(cookieFile, cookiesStr, 'utf-8');
      args.push('--cookies', cookieFile);
    }

    // Lấy proxy nếu đã thất bại lần đầu
    let currentProxy = null;
    if (retryCount > 0) {
      currentProxy = await proxyManager.getProxy();
      if (currentProxy) {
        const msg = `[Proxy] Thử IP: ${currentProxy} (Lần ${retryCount}/3)`;
        console.log(msg);
        proxyLogs.push(msg);
        args.push('--proxy', currentProxy);
      }
    }

    args.push(url);

    const ytDlp = getToolPath('yt-dlp');
    const child = spawn(ytDlp, args, {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      windowsHide: true,
    });
    let spawnFailed = false;
    let stdoutData = '';
    let stderrData = '';

    child.stdout.on('data', (d) => { stdoutData += d.toString('utf-8'); });
    child.stderr.on('data', (d) => { stderrData += d.toString('utf-8'); });

    child.on('close', async (code) => {
      if (cookieFile) {
        try { require('fs').unlinkSync(cookieFile); } catch (e) {}
      }

      if (spawnFailed) return; // đã reject ở handler 'error'

      if (code !== 0) {
        const errStr = stderrData.toLowerCase();
        const isBotBlocked = errStr.includes('sign in to confirm') || errStr.includes('bot') || errStr.includes('403');
        
        if (isBotBlocked) {
          if (currentProxy) {
            proxyManager.markProxyDead(currentProxy); // Proxy này cũng bị block
          }

          if (retryCount < 3) {
            console.log('[Downloader] Bot check detected, đổi IP (Proxy) và thử lại...');
            try {
              // Thử không fallback trước, nếu retry 3 thì thử luôn fallback
              const fallbackInfo = await getFormats(url, cookiesStr, retryCount === 2, retryCount + 1, proxyLogs);
              return resolve(fallbackInfo);
            } catch (fallbackErr) {
              return reject(fallbackErr);
            }
          }
        }
        
        let errMsg = `Lỗi phân tích video: ${stderrData.substring(0, 300)}`;
        if (proxyLogs.length > 0) {
          errMsg += `\nLịch sử Proxy:\n${proxyLogs.join('\n')}`;
        }
        return reject(new Error(errMsg));
      }

      try {
        const info = JSON.parse(stdoutData);
        resolve({
          title: info.title,
          thumbnail: info.thumbnail,
          duration: info.duration,
          formats: (info.formats || []).map((f) => ({
            formatId: f.format_id,
            ext: f.ext,
            resolution: f.resolution || (f.width ? `${f.width}x${f.height}` : 'audio only'),
            fps: f.fps,
            filesize: f.filesize || f.filesize_approx,
            vcodec: f.vcodec,
            acodec: f.acodec,
          })),
          usedFallback: useFallback,
          usedProxy: currentProxy // Trả về proxy đã dùng thành công
        });
      } catch (err) {
        reject(new Error(`Không thể đọc dữ liệu video: ${err.message}`));
      }
    });

    child.on('error', (err) => {
      spawnFailed = true;
      reject(new Error(
        `Không chạy được yt-dlp (${ytDlp}): ${err.message}\n` +
        `Hãy mở tab Cài đặt trong extension và bấm "Tải công cụ", hoặc đặt yt-dlp.exe vào thư mục bin/.`
      ));
    });
  });
}

module.exports = { downloadVideo, getFormats };

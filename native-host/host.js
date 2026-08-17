/**
 * host.js — Native Messaging Host: Chrome khởi động file này, nó bật server nền.
 *
 * Chạy ở 2 chế độ:
 *  - Đóng gói pkg : chính server.exe (spawn lại chính nó với tham số --server)
 *  - Từ source    : node.exe chạy file này (spawn node server/index.js)
 */

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');

const IS_PKG = Boolean(process.pkg);
const APP_DIR = IS_PKG ? path.dirname(process.execPath) : path.resolve(__dirname, '..', 'server');
const SERVER_PORT = 3847;

// === Logging ===
// Thư mục cài đặt có thể chỉ đọc (Program Files, ổ mạng...). Chọn nơi ghi được
// một lần lúc khởi động, nếu không thì bỏ luôn log chứ không được crash.
const LOG_DIR = pickWritableDir([APP_DIR, path.join(os.tmpdir(), 'video-downloader')]);

function pickWritableDir(candidates) {
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return dir;
    } catch (e) {
      // thử ứng viên tiếp theo
    }
  }
  return null;
}

function logDebug(msg) {
  if (!LOG_DIR) return;
  try {
    fs.appendFileSync(path.join(LOG_DIR, 'host_js.log'), `[${new Date().toISOString()}] ${msg}\n`);
  } catch (e) {}
}

// === Native Messaging Protocol ===

function sendMessage(msg) {
  const json = JSON.stringify(msg);
  const len = Buffer.byteLength(json, 'utf-8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(len, 0);
  process.stdout.write(header);
  process.stdout.write(json, 'utf-8');
}

let inputBuffer = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);

  while (inputBuffer.length >= 4) {
    const msgLen = inputBuffer.readUInt32LE(0);
    if (inputBuffer.length < 4 + msgLen) break;

    const msgData = inputBuffer.slice(4, 4 + msgLen).toString('utf-8');
    inputBuffer = inputBuffer.slice(4 + msgLen);

    try {
      const msg = JSON.parse(msgData);
      handleMessage(msg);
    } catch (e) {
      sendMessage({ type: 'error', error: e.message });
    }
  }
});

process.stdin.on('end', () => process.exit(0));

// === Server Management ===

/**
 * @returns {Promise<null|{status: string, missingTools?: string[]}>}
 *          null nếu server chưa chạy; ngược lại là nội dung /api/health.
 *          Phân biệt 'ok' với 'installing' — trước đây chỉ cần HTTP 200 là coi
 *          như xong, nên lỗi cài công cụ bị che mất.
 */
function checkServer() {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${SERVER_PORT}/api/health`, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ status: 'unknown' });
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(2000, () => { req.destroy(); resolve(null); });
  });
}

function readServerLogTail() {
  if (!LOG_DIR) return '';
  try {
    const logPath = path.join(LOG_DIR, 'server.log');
    if (fs.existsSync(logPath)) {
      return fs.readFileSync(logPath, 'utf8').slice(-1000);
    }
  } catch (e) {}
  return '';
}

function spawnServer() {
  let logStream = 'ignore';
  if (LOG_DIR) {
    try {
      logStream = fs.openSync(path.join(LOG_DIR, 'server.log'), 'a');
    } catch (e) {
      logStream = 'ignore';
    }
  }

  const spawnEnv = Object.assign({}, process.env);

  // Dưới pkg, child_process.spawn bị vá lại để LUÔN gán env.PKG_EXECPATH =
  // đường dẫn exe (prelude/bootstrap.js). Khi đó bootstrap của tiến trình con
  // hiểu argv[1] là tên FILE SCRIPT cần chạy, chứ không phải entrypoint mặc
  // định — nên `server.exe --server` sẽ chết với "Cannot find module ...\--server".
  // Cách đúng là truyền thẳng đường dẫn entrypoint trong snapshot.
  const command = process.execPath;
  let args;
  if (IS_PKG) {
    const entry = process.pkg.defaultEntrypoint || process.pkg.entrypoint;
    args = entry ? [entry, '--server'] : ['--server'];
  } else {
    args = [path.join(APP_DIR, 'index.js')];
  }

  logDebug(`Spawning: ${command} ${args.join(' ')} (cwd=${APP_DIR})`);

  const child = spawn(command, args, {
    cwd: APP_DIR,
    env: spawnEnv,
    detached: true,
    stdio: ['ignore', logStream, logStream],
    windowsHide: true,
  });

  child.unref();
  return child;
}

let starting = false;

async function startServer() {
  if (starting) return;
  starting = true;

  try {
    logDebug('startServer() called');

    const health = await checkServer();
    if (health) {
      logDebug(`Server already running (status=${health.status})`);
      sendMessage({
        type: 'status',
        status: health.status === 'ok' ? 'already_running' : 'installing',
        missingTools: health.missingTools || [],
      });
      return;
    }

    const child = spawnServer();

    // Chờ tối đa 30s: lần chạy đầu trên máy mới server còn phải tải
    // yt-dlp (~17MB) và FFmpeg (~170MB) nên lâu hơn hẳn.
    let health2 = null;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      health2 = await checkServer();
      if (health2) break;
    }

    if (!health2) {
      const errorLog = readServerLogTail();
      logDebug(`start_failed. log tail: ${errorLog.slice(-300)}`);
      sendMessage({
        type: 'status',
        status: 'start_failed',
        pid: child.pid,
        errorLog,
      });
      return;
    }

    logDebug(`server_started (status=${health2.status})`);
    sendMessage({
      type: 'status',
      status: health2.status === 'ok' ? 'server_started' : 'installing',
      pid: child.pid,
      missingTools: health2.missingTools || [],
      errorLog: health2.startupError || '',
    });
  } catch (err) {
    logDebug(`startServer error: ${err.message}`);
    sendMessage({ type: 'error', error: err.message });
  } finally {
    starting = false;
  }
}

function handleMessage(msg) {
  switch (msg.action) {
    case 'start':
      startServer();
      break;
    case 'ping':
      sendMessage({ type: 'pong' });
      break;
    case 'check':
      checkServer().then((health) => {
        sendMessage({
          type: 'status',
          status: health ? (health.status === 'ok' ? 'running' : 'installing') : 'stopped',
          missingTools: health ? health.missingTools || [] : [],
        });
      });
      break;
    default:
      sendMessage({ type: 'error', error: 'Unknown action' });
  }
}

process.on('uncaughtException', (err) => {
  logDebug(`uncaughtException: ${err.stack || err.message}`);
  try { sendMessage({ type: 'error', error: err.message }); } catch (e) {}
});

logDebug(`host.js started (pkg=${IS_PKG}, appDir=${APP_DIR}, logDir=${LOG_DIR})`);

// Tự động khởi động server ngay khi Chrome kết nối tới native host
startServer();

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const SERVER_PORT = 3847;

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

function checkServer() {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${SERVER_PORT}/api/health`, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve(true));
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

async function startServer() {
  logDebug('startServer() called');
  const isRunning = await checkServer();

  if (isRunning) {
    logDebug('Server already running');
    sendMessage({ type: 'status', status: 'already_running' });
    return;
  }

  try {
    const logStream = fs.openSync(path.join(__dirname, 'server.log'), 'a');
    
    logDebug('Spawning server process: ' + process.execPath);
    const serverProcess = spawn(process.execPath, ['index.js'], {
      cwd: SERVER_DIR,
      detached: true,
      stdio: ['ignore', logStream, logStream],
      windowsHide: true
    });

    serverProcess.unref();

    // Đợi server khởi động
    let started = false;
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      started = await checkServer();
      if (started) break;
    }

    let errorLog = '';
    if (!started) {
      try {
        const logPath = path.join(__dirname, 'server.log');
        if (fs.existsSync(logPath)) {
          const logContent = fs.readFileSync(logPath, 'utf8');
          // Lấy 500 ký tự cuối cùng
          errorLog = logContent.slice(-500);
        }
      } catch(e) {}
    }

    sendMessage({
      type: 'status',
      status: started ? 'server_started' : 'start_failed',
      pid: serverProcess.pid,
      errorLog: errorLog
    });
  } catch (err) {
    sendMessage({ type: 'error', error: err.message });
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
      checkServer().then((running) => {
        sendMessage({ type: 'status', status: running ? 'running' : 'stopped' });
      });
      break;
    default:
      sendMessage({ type: 'error', error: 'Unknown action' });
  }
}

const fs = require('fs');

function logDebug(msg) {
  try {
    fs.appendFileSync(path.join(__dirname, 'host_js.log'), `[${new Date().toISOString()}] ${msg}\n`);
  } catch(e) {}
}

logDebug('host.js started');

// Tự động khởi động server khi native host được kết nối
startServer();

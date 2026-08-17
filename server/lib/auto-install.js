/**
 * auto-install.js — Tự động tải yt-dlp.exe và FFmpeg nếu thiếu
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const { resolveAllTools, isToolResolved, getBinDir } = require('./resolve-tools');

// Không dùng __dirname: khi đóng gói bằng pkg, __dirname trỏ vào snapshot ảo
// (C:\snapshot\...) chỉ đọc, mkdir/ghi file sẽ ném lỗi và tool tải về sẽ nằm
// ở nơi resolve-tools không bao giờ tìm tới.
const BIN_DIR = getBinDir();

const NODE_VERSION = 'v22.16.0';

const TOOLS = {
  'yt-dlp': {
    url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
    filename: 'yt-dlp.exe',
    size: '~17MB'
  },
  ffmpeg: {
    zipUrl: 'https://github.com/GyanD/codexffmpeg/releases/download/7.1.1/ffmpeg-7.1.1-full_build.zip',
    extractFiles: ['ffmpeg.exe', 'ffprobe.exe'],
    extractDir: 'ffmpeg-7.1.1-full_build',
    size: '~170MB'
  },
  node: {
    zipUrl: `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-win-x64.zip`,
    extractDir: `node-${NODE_VERSION}-win-x64`,
    size: '~30MB'
  }
};

/**
 * Trạng thái cài đặt để /api/health báo về cho extension.
 * Nhờ đó người dùng thấy thanh tiến độ thay vì ngồi nhìn spinner trống khi
 * phải tải gần 200MB ở lần chạy đầu.
 */
const progress = {
  active: false,
  tool: null,
  percent: 0,
  downloadedMB: 0,
  totalMB: 0,
  pending: [],
  done: [],
  failed: [],
};

function getInstallProgress() {
  return { ...progress, pending: [...progress.pending], done: [...progress.done], failed: [...progress.failed] };
}

function download(url, dest, label) {
  return new Promise((resolve, reject) => {
    console.log(`[AutoInstall] Đang tải ${label}...`);
    if (!fs.existsSync(path.dirname(dest))) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
    }
    const file = fs.createWriteStream(dest);
    const follow = (url) => {
      https.get(url, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          return follow(res.headers.location);
        }
        if (res.statusCode !== 200) {
          file.close();
          try { fs.unlinkSync(dest); } catch (ex) {}
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const total = parseInt(res.headers['content-length'] || '0');
        let downloaded = 0;
        progress.tool = label;
        progress.percent = 0;
        progress.downloadedMB = 0;
        progress.totalMB = total > 0 ? +(total / 1048576).toFixed(1) : 0;

        res.on('data', (chunk) => {
          downloaded += chunk.length;
          progress.downloadedMB = +(downloaded / 1048576).toFixed(1);
          if (total > 0) {
            progress.percent = Math.min(100, Math.round((downloaded / total) * 100));
            process.stdout.write(`\r[AutoInstall]   ${label}: ${progress.percent}% (${progress.downloadedMB}MB)   `);
          }
        });
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log(`\n[AutoInstall] ✅ ${label} tải xong`);
          resolve();
        });
      }).on('error', (e) => {
        file.close();
        try { fs.unlinkSync(dest); } catch(ex) {}
        reject(e);
      });
    };
    follow(url);
  });
}

function extractZip(zipPath, destDir) {
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`,
    { stdio: 'pipe', windowsHide: true }
  );
}

async function installYtDlp() {
  const dest = path.join(BIN_DIR, 'yt-dlp.exe');
  if (fs.existsSync(dest)) return true;

  try {
    ensureBinDir();
    await download(TOOLS['yt-dlp'].url, dest, 'yt-dlp.exe');
    return true;
  } catch (e) {
    console.error(`[AutoInstall] ❌ Lỗi tải yt-dlp: ${e.message}`);
    return false;
  }
}

async function installFFmpeg() {
  const ffmpegPath = path.join(BIN_DIR, 'ffmpeg.exe');
  const ffprobePath = path.join(BIN_DIR, 'ffprobe.exe');
  if (fs.existsSync(ffmpegPath) && fs.existsSync(ffprobePath)) return true;

  const zipPath = path.join(BIN_DIR, 'ffmpeg.zip');
  try {
    ensureBinDir();
    await download(TOOLS.ffmpeg.zipUrl, zipPath, 'FFmpeg');

    console.log('[AutoInstall] Đang giải nén FFmpeg...');
    progress.tool = 'FFmpeg (dang giai nen)';
    extractZip(zipPath, BIN_DIR);

    const extractedBin = path.join(BIN_DIR, TOOLS.ffmpeg.extractDir, 'bin');
    for (const file of TOOLS.ffmpeg.extractFiles) {
      const src = path.join(extractedBin, file);
      const dst = path.join(BIN_DIR, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dst);
      }
    }

    // Dọn dẹp
    try {
      fs.rmSync(path.join(BIN_DIR, TOOLS.ffmpeg.extractDir), { recursive: true });
      fs.unlinkSync(zipPath);
    } catch(e) {}

    console.log('[AutoInstall] ✅ FFmpeg giải nén xong');
    return true;
  } catch (e) {
    console.error(`[AutoInstall] ❌ Lỗi tải FFmpeg: ${e.message}`);
    try { fs.unlinkSync(zipPath); } catch(ex) {}
    return false;
  }
}

/**
 * Node.js dùng làm JS runtime cho yt-dlp (giải mã nsig của YouTube).
 * Chỉ lấy đúng node.exe, bỏ npm/docs cho nhẹ.
 */
async function installNode() {
  const dest = path.join(BIN_DIR, 'node', 'node.exe');
  if (fs.existsSync(dest)) return true;

  const zipPath = path.join(BIN_DIR, 'node.zip');
  try {
    ensureBinDir();
    await download(TOOLS.node.zipUrl, zipPath, 'Node.js');

    console.log('[AutoInstall] Đang giải nén Node.js...');
    progress.tool = 'Node.js (dang giai nen)';
    extractZip(zipPath, BIN_DIR);

    const src = path.join(BIN_DIR, TOOLS.node.extractDir, 'node.exe');
    if (!fs.existsSync(src)) throw new Error('Khong tim thay node.exe trong file zip');

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);

    try {
      fs.rmSync(path.join(BIN_DIR, TOOLS.node.extractDir), { recursive: true });
      fs.unlinkSync(zipPath);
    } catch (e) {}

    console.log('[AutoInstall] ✅ Node.js sẵn sàng');
    return true;
  } catch (e) {
    console.error(`[AutoInstall] ❌ Lỗi tải Node.js: ${e.message}`);
    try { fs.unlinkSync(zipPath); } catch (ex) {}
    return false;
  }
}

function ensureBinDir() {
  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
  }
}

/**
 * Đảm bảo yt-dlp / ffmpeg / ffprobe sẵn sàng.
 * KHÔNG BAO GIỜ ném lỗi — nếu thư mục không ghi được hoặc mạng hỏng thì chỉ
 * trả về false, để server vẫn khởi động và báo lỗi rõ ràng cho người dùng.
 */
async function ensureAllTools() {
  console.log(`[AutoInstall] Thư mục công cụ: ${BIN_DIR}`);

  try {
    ensureBinDir();
  } catch (e) {
    console.error(`[AutoInstall] ❌ Không tạo được thư mục ${BIN_DIR}: ${e.message}`);
  }

  // Resolve trước để biết tool nào đã có (bin/ hoặc PATH hệ thống)
  resolveAllTools();

  const missing = [];
  if (!isToolResolved('yt-dlp')) missing.push('yt-dlp');
  if (!isToolResolved('ffmpeg') || !isToolResolved('ffprobe')) missing.push('ffmpeg');
  // Chỉ cần MỘT JS runtime. Máy đã có deno thì không tải Node.js (35MB) làm gì.
  if (!isToolResolved('deno') && !isToolResolved('node')) missing.push('node');

  if (missing.length === 0) {
    console.log('[AutoInstall] Tất cả công cụ đã sẵn sàng.');
    progress.active = false;
    return true;
  }

  console.log(`[AutoInstall] Thiếu: ${missing.join(', ')}. Đang tự động tải...`);

  const installers = {
    'yt-dlp': installYtDlp,
    ffmpeg: installFFmpeg,
    node: installNode,
  };

  progress.active = true;
  progress.pending = [...missing];
  progress.done = [];
  progress.failed = [];

  let allOk = true;
  for (const name of missing) {
    progress.tool = name;
    progress.percent = 0;
    progress.downloadedMB = 0;
    progress.totalMB = 0;

    const ok = await installers[name]();
    progress.pending = progress.pending.filter((t) => t !== name);
    if (ok) {
      progress.done.push(name);
    } else {
      progress.failed.push(name);
      allOk = false;
    }
  }

  progress.active = false;
  progress.tool = null;

  // Re-resolve để nhận tool vừa tải (kể cả khi chỉ tải được một phần)
  resolveAllTools();

  return allOk;
}

module.exports = {
  ensureAllTools, installYtDlp, installFFmpeg, installNode, getInstallProgress, BIN_DIR
};

/**
 * auto-install.js — Tự động tải yt-dlp.exe và FFmpeg nếu thiếu
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const BIN_DIR = path.join(__dirname, '..', 'bin');

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
  }
};

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
          fs.unlinkSync(dest);
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const total = parseInt(res.headers['content-length'] || '0');
        let downloaded = 0;
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (total > 0) {
            const pct = ((downloaded / total) * 100).toFixed(0);
            const mb = (downloaded / 1024 / 1024).toFixed(1);
            process.stdout.write(`\r[AutoInstall]   ${label}: ${pct}% (${mb}MB)   `);
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

async function installYtDlp() {
  const dest = path.join(BIN_DIR, 'yt-dlp.exe');
  if (fs.existsSync(dest)) return true;
  
  try {
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
    await download(TOOLS.ffmpeg.zipUrl, zipPath, 'FFmpeg');
    
    console.log('[AutoInstall] Đang giải nén FFmpeg...');
    execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${BIN_DIR}' -Force"`, { stdio: 'pipe', windowsHide: true });
    
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

async function ensureAllTools() {
  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
  }
  
  const { getToolPath } = require('./resolve-tools');
  const missing = [];
  
  if (!getToolPath('yt-dlp') || getToolPath('yt-dlp') === 'yt-dlp') {
    missing.push('yt-dlp');
  }
  if (!getToolPath('ffmpeg') || getToolPath('ffmpeg') === 'ffmpeg') {
    missing.push('ffmpeg');
  }
  
  // Kiểm tra thêm trong bin/
  if (!fs.existsSync(path.join(BIN_DIR, 'yt-dlp.exe'))) {
    if (!missing.includes('yt-dlp')) {
      // Có trong PATH nhưng chưa có trong bin/ — OK, dùng PATH
    }
  }
  
  if (missing.length === 0) {
    console.log('[AutoInstall] Tất cả công cụ đã sẵn sàng.');
    return true;
  }
  
  console.log(`[AutoInstall] Thiếu: ${missing.join(', ')}. Đang tự động tải...`);
  
  let allOk = true;
  if (missing.includes('yt-dlp')) {
    const ok = await installYtDlp();
    if (!ok) allOk = false;
  }
  if (missing.includes('ffmpeg')) {
    const ok = await installFFmpeg();
    if (!ok) allOk = false;
  }
  
  // Re-resolve sau khi cài
  if (allOk) {
    const { resolveAllTools } = require('./resolve-tools');
    resolveAllTools();
  }
  
  return allOk;
}

module.exports = { ensureAllTools, installYtDlp, installFFmpeg };

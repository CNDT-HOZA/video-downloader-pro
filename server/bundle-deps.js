/**
 * bundle-deps.js — Tải và đóng gói yt-dlp.exe, FFmpeg, Node.js portable
 * Chạy: node bundle-deps.js
 * Kết quả: thư mục server/bin/ chứa tất cả công cụ cần thiết
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const BIN_DIR = path.join(__dirname, 'bin');
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
const FFMPEG_VERSION = '7.1.1';
const FFMPEG_URL = `https://github.com/GyanD/codexffmpeg/releases/download/${FFMPEG_VERSION}/ffmpeg-${FFMPEG_VERSION}-full_build.zip`;

if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true });

function download(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Đang tải: ${url}`);
    const file = fs.createWriteStream(dest);
    const request = (url) => {
      https.get(url, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          return request(res.headers.location);
        }
        const total = parseInt(res.headers['content-length'] || '0');
        let downloaded = 0;
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (total > 0) {
            const pct = ((downloaded / total) * 100).toFixed(1);
            process.stdout.write(`\r  ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)}MB)`);
          }
        });
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log(' ✅');
          resolve();
        });
      }).on('error', reject);
    };
    request(url);
  });
}

async function main() {
  console.log('=== Đóng gói phần mềm phụ thuộc ===\n');

  // 1. Tải yt-dlp.exe
  const ytdlpPath = path.join(BIN_DIR, 'yt-dlp.exe');
  if (!fs.existsSync(ytdlpPath)) {
    await download(YTDLP_URL, ytdlpPath);
  } else {
    console.log('yt-dlp.exe đã có sẵn ✅');
  }

  // 2. Tải FFmpeg
  const ffmpegExe = path.join(BIN_DIR, 'ffmpeg.exe');
  if (!fs.existsSync(ffmpegExe)) {
    const zipPath = path.join(BIN_DIR, 'ffmpeg.zip');
    await download(FFMPEG_URL, zipPath);
    
    console.log('Đang giải nén FFmpeg...');
    execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${BIN_DIR}' -Force"`, { stdio: 'inherit' });
    
    // Copy ffmpeg.exe, ffprobe.exe ra bin/
    const extractedDir = path.join(BIN_DIR, `ffmpeg-${FFMPEG_VERSION}-full_build`, 'bin');
    for (const file of ['ffmpeg.exe', 'ffprobe.exe']) {
      const src = path.join(extractedDir, file);
      const dst = path.join(BIN_DIR, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dst);
        console.log(`  ${file} ✅`);
      }
    }
    
    // Dọn dẹp
    try {
      fs.rmSync(path.join(BIN_DIR, `ffmpeg-${FFMPEG_VERSION}-full_build`), { recursive: true });
      fs.unlinkSync(zipPath);
    } catch(e) {}
    
    console.log('FFmpeg giải nén xong ✅');
  } else {
    console.log('FFmpeg đã có sẵn ✅');
  }

  console.log('\n=== Hoàn tất! ===');
  console.log(`Thư mục bin/: ${BIN_DIR}`);
  console.log('Các file:');
  fs.readdirSync(BIN_DIR).filter(f => f.endsWith('.exe')).forEach(f => {
    const size = (fs.statSync(path.join(BIN_DIR, f)).size / 1024 / 1024).toFixed(1);
    console.log(`  ${f} (${size}MB)`);
  });
}

main().catch(console.error);

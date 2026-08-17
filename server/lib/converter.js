const { spawn } = require('child_process');
const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');
const { getToolPath } = require('./resolve-tools');

function getMediaInfo(inputPath) {
  return new Promise((resolve, reject) => {
    const ffprobe = getToolPath('ffprobe');
    const child = spawn(ffprobe, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      inputPath
    ], { windowsHide: true });

    let spawnFailed = false;
    let stdoutData = '';
    let stderrData = '';

    child.stdout.on('data', (d) => { stdoutData += d.toString(); });
    child.stderr.on('data', (d) => { stderrData += d.toString(); });

    child.on('close', (code) => {
      if (spawnFailed) return;
      if (code !== 0) return reject(new Error(`ffprobe failed (code ${code}): ${stderrData}`));
      try {
        resolve(JSON.parse(stdoutData));
      } catch (e) {
        reject(new Error(`ffprobe parse error: ${e.message}`));
      }
    });

    child.on('error', (err) => {
      spawnFailed = true;
      reject(new Error(
        `Không chạy được ffprobe (${ffprobe}): ${err.message}\n` +
        `Hãy mở tab Cài đặt trong extension và bấm "Tải công cụ", hoặc đặt ffmpeg.exe + ffprobe.exe vào thư mục bin/.`
      ));
    });
  });
}

const { getBestEncoder } = require('./hw-accel');

async function convertToMp4(inputPath, outputDir, options = {}) {
  const emitter = new EventEmitter();

  try {
    const info = await getMediaInfo(inputPath);
    const isMp4 = inputPath.toLowerCase().endsWith('.mp4');
    let hasH264 = false;
    let durationSec = 0;

    if (info.format && info.format.duration) {
      durationSec = parseFloat(info.format.duration);
    }

    if (info.streams) {
      const videoStream = info.streams.find((s) => s.codec_type === 'video');
      if (videoStream && videoStream.codec_name === 'h264') {
        hasH264 = true;
      }
    }

    // Smart skip: nếu đã là MP4 H.264 và không cần H.265
    if (isMp4 && hasH264 && options.codec !== 'h265' && !options.targetRes) {
      console.log('[Converter] Skipped — đã là MP4 H.264');
      
      // Đổi tên file bỏ prefix temp_taskId_
      const parsedSkip = path.parse(inputPath);
      let cleanSkipName = parsedSkip.name;
      if (cleanSkipName.startsWith('temp_')) {
        const first_ = cleanSkipName.indexOf('_');
        const second_ = cleanSkipName.indexOf('_', first_ + 1);
        if (second_ !== -1) cleanSkipName = cleanSkipName.substring(second_ + 1);
      }
      const cleanPath = path.join(outputDir, cleanSkipName + parsedSkip.ext);
      if (inputPath !== cleanPath) {
        try { fs.renameSync(inputPath, cleanPath); } catch(e) {}
      }
      const finalPath = fs.existsSync(cleanPath) ? cleanPath : inputPath;

      setTimeout(() => {
        emitter.emit('log', 'Video đã ở định dạng MP4 H.264, bỏ qua chuyển đổi');
        emitter.emit('progress', 100);
        emitter.emit('complete', finalPath);
      }, 100);
      return { childProcess: null, emitter, isRemux: true };
    }

    const parsedPath = path.parse(inputPath);
    let cleanName = parsedPath.name;
    if (cleanName.startsWith('temp_')) {
      // temp_taskId_VideoTitle -> VideoTitle
      const firstUnderscore = cleanName.indexOf('_');
      if (firstUnderscore !== -1) {
        const secondUnderscore = cleanName.indexOf('_', firstUnderscore + 1);
        if (secondUnderscore !== -1) {
          cleanName = cleanName.substring(secondUnderscore + 1);
        }
      }
    }

    const outputFilename = cleanName + '.mp4';
    const outputPath = path.join(outputDir, outputFilename);
    const tempOutputPath = outputPath + '.tmp.mp4';

    let codecLib = getBestEncoder(options.codec || 'h264');
    const isGPU = !codecLib.startsWith('libx');
    let isRemux = false;

    // Nếu video tải về dạng MKV nhưng BÊN TRONG CỐT LÕI ĐÃ LÀ H.264, và người dùng yêu cầu H.264 => chỉ cần copy (remux)
    if (hasH264 && options.codec !== 'h265' && !options.targetRes) {
      codecLib = 'copy';
      isRemux = true;
    }

    const args = [];
    if (!isRemux) {
      args.push('-hwaccel', 'auto');
    }
    
    args.push('-i', inputPath);
    args.push('-c:v', codecLib);
    args.push('-c:a', 'aac');
    args.push('-b:a', '320k');
    args.push('-movflags', '+faststart');
    
    if (!isRemux) {
      args.push('-pix_fmt', 'yuv420p');
    }

    if (!isRemux) {
      if (isGPU) {
        if (codecLib.includes('nvenc')) {
          args.push('-preset', 'p4', '-cq', '22');
        } else if (codecLib.includes('amf')) {
          args.push('-quality', 'quality', '-rc', 'cqp', '-qp_p', '22', '-qp_i', '22');
        } else if (codecLib.includes('qsv')) {
          args.push('-preset', 'medium', '-global_quality', '22');
        } else {
          args.push('-preset', 'medium');
        }
      } else {
        args.push('-preset', 'fast', '-crf', '20');
      }
    }

    if (options.targetRes && !isRemux) {
      args.push('-vf', `scale=-2:${options.targetRes}`);
    }

    args.push('-progress', 'pipe:1', '-y', tempOutputPath);

    const ffmpeg = getToolPath('ffmpeg');
    console.log(`[Converter] ${ffmpeg} ${args.join(' ')}`);
    if (isRemux) {
      emitter.emit('log', `Đang đóng gói file sang MP4 (tốc độ siêu tốc vì giữ nguyên lõi H.264)...`);
    } else {
      emitter.emit('log', `Bắt đầu chuyển đổi sang ${codecLib.toUpperCase()}...`);
    }

    const ffmpegProcess = spawn(ffmpeg, args, { windowsHide: true });
    const returnIsRemux = isRemux;
    let ffmpegSpawnFailed = false;

    const totalDurationUs = durationSec * 1_000_000;
    let progressBuffer = '';

    ffmpegProcess.stdout.on('data', (data) => {
      progressBuffer += data.toString();
      const lines = progressBuffer.split('\n');
      progressBuffer = lines.pop(); 

      for (const line of lines) {
        let match = line.match(/out_time_us=(\d+)/);
        if (!match) {
          match = line.match(/out_time_ms=(\d+)/);
        }

        if (match && totalDurationUs > 0) {
          const currentUs = parseInt(match[1], 10);
          const pct = Math.min((currentUs / totalDurationUs) * 100, 99.9);
          emitter.emit('progress', Math.round(pct * 10) / 10);
          continue;
        }

        const timeStr = line.match(/out_time=(\d{2}):(\d{2}):(\d{2})\.\d+/);
        if (timeStr && durationSec > 0) {
          const secs = parseInt(timeStr[1]) * 3600 + parseInt(timeStr[2]) * 60 + parseInt(timeStr[3]);
          const pct = Math.min((secs / durationSec) * 100, 99.9);
          emitter.emit('progress', Math.round(pct * 10) / 10);
          continue;
        }

        const speedMatch = line.match(/speed=\s*([\d.]+)x/);
        if (speedMatch) {
          emitter.emit('log', `Tốc độ: ${speedMatch[1]}x`);
        }
      }
    });

    let stderrLog = '';
    let lastStderrLine = '';
    ffmpegProcess.stderr.on('data', (data) => {
      stderrLog += data.toString();
      const lines = data.toString().split(/\r?\n/).filter(Boolean);
      if (lines.length > 0) {
        lastStderrLine = lines[lines.length - 1].trim();
        const frameMatch = lastStderrLine.match(/time=(\d{2}):(\d{2}):(\d{2})\.\d+/);
        if (frameMatch && durationSec > 0) {
          const secs = parseInt(frameMatch[1]) * 3600 + parseInt(frameMatch[2]) * 60 + parseInt(frameMatch[3]);
          const pct = Math.min((secs / durationSec) * 100, 99.9);
          emitter.emit('progress', Math.round(pct * 10) / 10);
        }
      }
    });

    ffmpegProcess.on('close', (code) => {
      if (ffmpegSpawnFailed) return; // đã báo lỗi ở handler 'error'
      if (code === 0) {
        // Xóa file temp gốc (MKV) + TẤT CẢ file trung gian yt-dlp (f251, f400, .part, ...)
        const taskIdMatch = path.basename(inputPath).match(/^temp_([a-f0-9-]+)_/);
        if (taskIdMatch) {
          const prefix = `temp_${taskIdMatch[1]}_`;
          const dir = path.dirname(inputPath);
          try {
            const files = fs.readdirSync(dir);
            for (const f of files) {
              if (f.startsWith(prefix)) {
                try {
                  fs.unlinkSync(path.join(dir, f));
                  console.log(`[Converter] Đã xóa temp: ${f}`);
                } catch(e) {
                  // Thử lại sau 2 giây
                  const fp = path.join(dir, f);
                  setTimeout(() => { try { fs.unlinkSync(fp); } catch(e2) {} }, 2000);
                }
              }
            }
          } catch(e) {}
        } else if (fs.existsSync(inputPath)) {
          try { fs.unlinkSync(inputPath); } catch(e) {}
        }

        // Đổi tên file .tmp.mp4 → .mp4
        try {
          if (fs.existsSync(tempOutputPath)) {
            if (fs.existsSync(outputPath)) {
              try { fs.unlinkSync(outputPath); } catch(e) {}
            }
            fs.renameSync(tempOutputPath, outputPath);
          }
        } catch (e) {
          console.error(`[Converter] Không rename được: ${e.message}`);
        }

        emitter.emit('log', `Hoàn tất: ${path.basename(outputPath)}`);
        emitter.emit('progress', 100);
        emitter.emit('complete', outputPath);
        return;
      } else {
        const errLines = stderrLog.split('\n').filter((l) => l.trim()).slice(-3).join(' | ');
        const errMsg = `FFmpeg lỗi (code ${code}): ${errLines || lastStderrLine}`;
        console.error(`[Converter] ${errMsg}`);
        emitter.emit('log', errMsg);

        try {
          if (fs.existsSync(tempOutputPath)) {
            fs.unlinkSync(tempOutputPath);
          }
        } catch (e) {}
        emitter.emit('error', new Error(errMsg));
      }
    });

    ffmpegProcess.on('error', (err) => {
      ffmpegSpawnFailed = true;
      try {
        if (fs.existsSync(tempOutputPath)) {
          fs.unlinkSync(tempOutputPath);
        }
      } catch (e) {}
      emitter.emit('error', new Error(
        `Không chạy được ffmpeg (${ffmpeg}): ${err.message}\n` +
        `Hãy mở tab Cài đặt trong extension và bấm "Tải công cụ", hoặc đặt ffmpeg.exe vào thư mục bin/.`
      ));
    });

    return { childProcess: ffmpegProcess, emitter, isRemux: returnIsRemux };
  } catch (err) {
    console.error('[Converter] Init error:', err.message);
    setTimeout(() => {
      emitter.emit('log', `Lỗi: ${err.message}`);
      emitter.emit('error', err);
    }, 100);
    return { childProcess: null, emitter };
  }
}

module.exports = { convertToMp4 };

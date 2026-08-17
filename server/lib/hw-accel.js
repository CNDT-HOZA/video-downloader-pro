const { spawnSync } = require('child_process');
const { getToolPath } = require('./resolve-tools');

let hwCache = null;

function probeHardwareEncoders() {
  if (hwCache) return hwCache;
  const ffmpeg = getToolPath('ffmpeg');
  const available = {
    h264: [],
    h265: []
  };

  const probe = (encoder) => {
    try {
      const res = spawnSync(ffmpeg, [
        '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'nullsrc=s=256x256:d=0.1',
        '-frames:v', '1',
        '-c:v', encoder,
        '-f', 'null', 'NUL'
      ], { stdio: 'pipe', timeout: 10000, windowsHide: true });
      
      const stderr = (res.stderr || '').toString();
      
      // Nếu có lỗi driver version hoặc DLL failed thì trả false
      if (stderr.includes('Driver does not support') || 
          stderr.includes('DLL') ||
          stderr.includes('Failed to create') ||
          stderr.includes('Error while opening encoder')) {
        console.log(`[HW-Accel] ${encoder}: FAILED - ${stderr.split('\n')[0].trim()}`);
        return false;
      }
      
      if (res.status === 0) {
        console.log(`[HW-Accel] ${encoder}: OK`);
        return true;
      }
      
      console.log(`[HW-Accel] ${encoder}: FAILED (exit code ${res.status})`);
      return false;
    } catch (e) {
      console.log(`[HW-Accel] ${encoder}: ERROR - ${e.message}`);
      return false;
    }
  };

  // Test NVENC (NVIDIA)
  if (probe('h264_nvenc')) available.h264.push('h264_nvenc');
  if (probe('hevc_nvenc')) available.h265.push('hevc_nvenc');

  // Test AMF (AMD)
  if (probe('h264_amf')) available.h264.push('h264_amf');
  if (probe('hevc_amf')) available.h265.push('hevc_amf');

  // Test QSV (Intel)
  if (probe('h264_qsv')) available.h264.push('h264_qsv');
  if (probe('hevc_qsv')) available.h265.push('hevc_qsv');

  // Fallbacks (CPU)
  available.h264.push('libx264');
  available.h265.push('libx265');

  hwCache = available;
  console.log(`[HW-Accel] H.264 Priority: ${available.h264.join(' > ')}`);
  console.log(`[HW-Accel] H.265 Priority: ${available.h265.join(' > ')}`);

  if (available.h264[0] === 'libx264') {
    console.log('[HW-Accel] ⚠️  Không tìm thấy GPU encoder! Sẽ dùng CPU (libx264). Hãy cập nhật Driver NVIDIA lên ≥ 610.00 để kích hoạt NVENC.');
  }

  return available;
}

function resetCache() {
  hwCache = null;
}

function getBestEncoder(codec) {
  const encoders = probeHardwareEncoders();
  return codec === 'h265' ? encoders.h265[0] : encoders.h264[0];
}

module.exports = { probeHardwareEncoders, getBestEncoder, resetCache };

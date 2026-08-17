/**
 * Setup Script - Chạy 1 lần trên mỗi máy để đăng ký Native Messaging Host
 * Extension ID đã cố định: amabnkaljgacfjocmlfkfpbbglijpfcn
 * 
 * Cách dùng: node setup.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const EXTENSION_ID = 'amabnkaljgacfjocmlfkfpbbglijpfcn';

console.log('');
console.log('╔══════════════════════════════════════════════╗');
console.log('║   Video Downloader Pro - Cài đặt tự động    ║');
console.log('╚══════════════════════════════════════════════╝');
console.log('');
console.log(`Extension ID: ${EXTENSION_ID}`);
console.log('');

try {
  // 1. Tạo native messaging manifest với đường dẫn tuyệt đối
  const hostBat = path.resolve(__dirname, 'native-host', 'host.bat');
  const manifestPath = path.resolve(__dirname, 'native-host', 'com.video_downloader.server.json');

  const manifest = {
    name: 'com.video_downloader.server',
    description: 'Video Downloader Pro - Server Launcher',
    path: hostBat,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${EXTENSION_ID}/`]
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`✅ Đã tạo manifest: ${manifestPath}`);

  // 2. Đăng ký trong Windows Registry (HKCU - không cần admin)
  const regKey = 'HKCU\\SOFTWARE\\Google\\Chrome\\NativeMessagingHosts\\com.video_downloader.server';
  execSync(`reg add "${regKey}" /ve /t REG_SZ /d "${manifestPath}" /f`, { stdio: 'pipe' });
  console.log('✅ Đã đăng ký Native Messaging Host');

  // 3. Cài đặt server dependencies nếu chưa có
  const serverDir = path.resolve(__dirname, 'server');
  const nodeModules = path.join(serverDir, 'node_modules');
  if (!fs.existsSync(nodeModules)) {
    console.log('\n📦 Đang cài đặt server dependencies...');
    execSync('npm install', { cwd: serverDir, stdio: 'inherit' });
  } else {
    console.log('✅ Server dependencies đã sẵn sàng');
  }

  // 4. Tạo thư mục output nếu chưa có
  const outputDir = path.resolve(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log('✅ Đã tạo thư mục output');
  }

  console.log('');
  console.log('══════════════════════════════════════════════');
  console.log('🎉 Cài đặt hoàn tất!');
  console.log('');
  console.log('Bước tiếp theo:');
  console.log('  1. Mở chrome://extensions');
  console.log('  2. Bật Developer mode');
  console.log('  3. Load unpacked → chọn thư mục "extension"');
  console.log('  4. Server sẽ TỰ ĐỘNG khởi động khi mở extension');
  console.log('══════════════════════════════════════════════');
  console.log('');

} catch (err) {
  console.error('\n❌ Lỗi:', err.message);
  process.exit(1);
}

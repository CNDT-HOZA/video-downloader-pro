const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

try {
  const nativeDir = path.join(__dirname, '..', 'native-host');
  const jsonPath = path.join(nativeDir, 'com.video_downloader.server.json');
  const hostExePath = path.join(nativeDir, 'host.exe');

  // Đọc file JSON (UTF-8)
  const data = fs.readFileSync(jsonPath, 'utf8');
  const config = JSON.parse(data);

  // Cập nhật đường dẫn
  config.path = hostExePath;

  // Ghi lại JSON chuẩn UTF-8
  fs.writeFileSync(jsonPath, JSON.stringify(config, null, 2), 'utf8');

  // Đăng ký Registry
  execSync(`REG ADD "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.video_downloader.server" /ve /t REG_SZ /d "${jsonPath}" /f`, { stdio: 'inherit' });

  console.log('  [OK] Auto-Start registry added successfully.');
} catch (e) {
  console.error('  [ERROR] Failed to setup registry:', e.message);
  process.exit(1);
}

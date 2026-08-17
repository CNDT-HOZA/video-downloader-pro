const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

try {
  const nativeDir = path.join(__dirname, '..', 'native-host');
  const jsonPath = path.join(nativeDir, 'com.video_downloader.server.json');
  const hostExePath = path.join(nativeDir, 'host.bat');

  // Đọc file JSON (UTF-8)
  const data = fs.readFileSync(jsonPath, 'utf8');
  const config = JSON.parse(data);

  // Cập nhật đường dẫn
  config.path = hostExePath;

  // Ghi lại JSON chuẩn UTF-8
  fs.writeFileSync(jsonPath, JSON.stringify(config, null, 2), 'utf8');

  // Đăng ký Registry thông qua file .reg UTF-16LE để hỗ trợ hoàn hảo tiếng Việt
  const regPath = path.join(nativeDir, 'temp_setup.reg');
  
  // Format đường dẫn JSON theo chuẩn Registry (dùng \\ thay cho \)
  const escapedJsonPath = jsonPath.replace(/\\/g, '\\\\');
  
  // Tạo nội dung file .reg
  const regContent = '\uFEFFWindows Registry Editor Version 5.00\r\n\r\n' +
    '[HKEY_CURRENT_USER\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.video_downloader.server]\r\n' +
    '@="' + escapedJsonPath + '"\r\n';
    
  // Ghi file .reg với encoding utf16le
  fs.writeFileSync(regPath, Buffer.from(regContent, 'utf16le'));
  
  // Chạy file .reg ngầm
  execSync(`regedit.exe /s "${regPath}"`);
  
  // Xoá file .reg tạm
  fs.unlinkSync(regPath);
  console.log('  [OK] Auto-Start registry added successfully.');
} catch (e) {
  console.error('  [ERROR] Failed to setup registry:', e.message);
  process.exit(1);
}

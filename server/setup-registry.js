/**
 * setup-registry.js — Đăng ký Native Messaging Host cho các trình duyệt Chromium.
 *
 * Chạy bằng: server.exe --setup
 *
 * Không cần quyền Administrator: chỉ ghi vào HKCU và dùng reg.exe (asInvoker).
 * KHÔNG dùng regedit.exe — nó có manifest "highestAvailable" nên sẽ bật hộp thoại
 * UAC; người dùng bấm "No" là việc đăng ký thất bại im lặng và server không bao
 * giờ tự khởi động được.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const HOST_NAME = 'com.video_downloader.server';
const EXTENSION_ID = 'amabnkaljgacfjocmlfkfpbbglijpfcn';

// Mọi trình duyệt Chromium phổ biến trên Windows đều đọc HKCU tại các nhánh này
const BROWSER_KEYS = [
  ['Chrome',    'Software\\Google\\Chrome\\NativeMessagingHosts'],
  ['Chromium',  'Software\\Chromium\\NativeMessagingHosts'],
  ['Edge',      'Software\\Microsoft\\Edge\\NativeMessagingHosts'],
  ['Brave',     'Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts'],
  ['Vivaldi',   'Software\\Vivaldi\\NativeMessagingHosts'],
  ['Coc Coc',   'Software\\CocCoc\\Browser\\NativeMessagingHosts'],
  ['Opera',     'Software\\Opera Software\\Opera Stable\\NativeMessagingHosts'],
];

const SYS32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const REG_EXE = path.join(SYS32, 'reg.exe');

function getAppDir() {
  return process.pkg ? path.dirname(process.execPath) : path.join(__dirname);
}

/**
 * Đường dẫn tới file thực thi mà Chrome sẽ chạy làm native host.
 * - Bản đóng gói (pkg): chính server.exe (không tham số => chạy chế độ native host)
 * - Bản chạy từ source: native-host/host.exe (wrapper C#)
 */
function getHostExePath() {
  if (process.pkg) return process.execPath;
  return path.join(__dirname, '..', 'native-host', 'host.exe');
}

/** Giữ nguyên allowed_origins cũ nếu đã có file manifest, để không mất ID tuỳ chỉnh */
function readExistingOrigins(manifestPath) {
  try {
    const cfg = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (Array.isArray(cfg.allowed_origins) && cfg.allowed_origins.length > 0) {
      return cfg.allowed_origins;
    }
  } catch (e) {
    // Chưa có file hoặc file hỏng — dùng mặc định
  }
  return [`chrome-extension://${EXTENSION_ID}/`];
}

function writeManifest(manifestPath, hostExePath) {
  const config = {
    name: HOST_NAME,
    description: 'Video Downloader Pro - Server Launcher',
    path: hostExePath,
    type: 'stdio',
    allowed_origins: readExistingOrigins(manifestPath),
  };

  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  // UTF-8 không BOM — Chrome sẽ từ chối manifest có BOM
  fs.writeFileSync(manifestPath, JSON.stringify(config, null, 2), { encoding: 'utf8' });
  return config;
}

function importRegFile(manifestPath) {
  const escaped = manifestPath.replace(/\\/g, '\\\\');

  let content = '\uFEFFWindows Registry Editor Version 5.00\r\n\r\n';
  for (const [, key] of BROWSER_KEYS) {
    content += `[HKEY_CURRENT_USER\\${key}\\${HOST_NAME}]\r\n`;
    content += `@="${escaped}"\r\n\r\n`;
  }

  // Ghi vào tmpdir chứ không phải thư mục ứng dụng: thư mục cài đặt có thể
  // chỉ đọc (Program Files) và ta không cần để lại rác ở đó.
  const regPath = path.join(os.tmpdir(), `vd_setup_${Date.now()}.reg`);
  fs.writeFileSync(regPath, Buffer.from(content, 'utf16le'));

  try {
    // reg.exe chạy asInvoker => không bật UAC, và đọc được file .reg UTF-16LE
    // nên đường dẫn tiếng Việt vẫn chính xác.
    execFileSync(REG_EXE, ['import', regPath], { stdio: 'pipe', windowsHide: true });
  } finally {
    try { fs.unlinkSync(regPath); } catch (e) {}
  }
}

/**
 * Đọc lại registry để xác nhận đã ghi thành công.
 *
 * Dùng `reg export` (file .reg UTF-16LE) chứ không dùng `reg query`: reg.exe in
 * ra console theo bảng mã OEM, Node decode bằng UTF-8 nên đường dẫn tiếng Việt
 * bị hỏng và phép so sánh luôn sai.
 */
function verify(key, expectedPath) {
  const tmp = path.join(os.tmpdir(), `vd_verify_${Date.now()}_${Math.random().toString(36).slice(2)}.reg`);
  try {
    execFileSync(REG_EXE, ['export', `HKCU\\${key}\\${HOST_NAME}`, tmp, '/y'], {
      stdio: 'pipe',
      windowsHide: true,
    });
    const text = fs.readFileSync(tmp, 'utf16le');
    const match = text.match(/^@="(.*)"\s*$/m);
    if (!match) return false;
    const value = match[1].replace(/\\\\/g, '\\').replace(/\\"/g, '"');
    return path.resolve(value).toLowerCase() === path.resolve(expectedPath).toLowerCase();
  } catch (e) {
    return false;
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
}

function getManifestPath() {
  return path.join(getAppDir(), `${HOST_NAME}.json`);
}

/**
 * Đăng ký đã đúng và đầy đủ chưa?
 * Dùng để tự sửa im lặng lúc server khởi động — chỉ ghi lại registry khi
 * thật sự cần, tránh đụng vào registry ở mọi lần chạy.
 */
function isRegistrationCurrent() {
  const manifestPath = getManifestPath();
  const hostExePath = getHostExePath();

  if (!fs.existsSync(manifestPath) || !fs.existsSync(hostExePath)) return false;

  try {
    const cfg = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    // Chrome cho phep path tuong doi (so voi thu muc chua manifest) tren Windows.
    // Ban zip xuat xuong o dang tuong doi de khong dinh vao may nao.
    const declared = path.resolve(path.dirname(manifestPath), cfg.path || '');
    if (declared.toLowerCase() !== path.resolve(hostExePath).toLowerCase()) {
      return false;
    }
  } catch (e) {
    return false;
  }

  return BROWSER_KEYS.every(([, key]) => verify(key, manifestPath));
}

/**
 * Tự đăng ký lại nếu cần, không in gì trừ khi có thay đổi.
 * Gọi lúc server khởi động: nhờ vậy chỉ cần chạy server MỘT LẦN bằng bất kỳ
 * cách nào (bấm đúp server.exe, START_SERVER.bat...) là auto-start được thiết
 * lập, không cần nhớ chạy setup.bat.
 */
function ensureRegistered() {
  try {
    // Chỉ tự đăng ký ở bản đóng gói. Chạy từ source (node index.js) thì
    // getHostExePath() trỏ tới native-host/host.exe, tự đăng ký sẽ ghi đè
    // cấu hình đang trỏ đúng vào server.exe của người dùng.
    if (!process.pkg) return { changed: false, ok: true, skipped: true };

    if (isRegistrationCurrent()) return { changed: false, ok: true };

    const manifestPath = getManifestPath();
    const hostExePath = getHostExePath();
    if (!fs.existsSync(hostExePath)) {
      return { changed: false, ok: false, error: 'Khong tim thay ' + hostExePath };
    }

    writeManifest(manifestPath, hostExePath);
    importRegFile(manifestPath);

    const okCount = BROWSER_KEYS.filter(([, key]) => verify(key, manifestPath)).length;
    return { changed: true, ok: okCount > 0, count: okCount };
  } catch (e) {
    return { changed: false, ok: false, error: e.message };
  }
}

function main() {
  const appDir = getAppDir();
  const manifestPath = path.join(appDir, `${HOST_NAME}.json`);
  const hostExePath = getHostExePath();

  console.log('');
  console.log('  Native host   : ' + hostExePath);
  console.log('  Manifest      : ' + manifestPath);

  if (!fs.existsSync(hostExePath)) {
    console.error(`  [ERROR] Khong tim thay file thuc thi: ${hostExePath}`);
    process.exit(1);
  }

  let config;
  try {
    config = writeManifest(manifestPath, hostExePath);
  } catch (e) {
    console.error(`  [ERROR] Khong ghi duoc manifest: ${e.message}`);
    console.error('          Thu muc cai dat khong cho ghi. Hay chuyen ra ngoai Program Files.');
    process.exit(1);
  }

  console.log('  Extension ID  : ' + config.allowed_origins.join(', '));
  console.log('');

  try {
    importRegFile(manifestPath);
  } catch (e) {
    const detail = (e.stderr || e.stdout || '').toString().trim() || e.message;
    console.error(`  [ERROR] reg.exe import that bai: ${detail}`);
    process.exit(1);
  }

  let okCount = 0;
  for (const [label, key] of BROWSER_KEYS) {
    if (verify(key, manifestPath)) {
      console.log(`  [OK]   ${label}`);
      okCount++;
    } else {
      console.log(`  [SKIP] ${label} (chua ghi duoc)`);
    }
  }

  console.log('');
  if (okCount === 0) {
    console.error('  [ERROR] Khong dang ky duoc cho bat ky trinh duyet nao.');
    process.exit(1);
  }
  console.log(`  [OK] Da dang ky auto-start cho ${okCount} trinh duyet.`);
}

module.exports = { main, ensureRegistered, isRegistrationCurrent, getManifestPath };

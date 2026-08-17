/**
 * doctor.js — Chẩn đoán vì sao server không tự khởi động.
 * Chạy bằng: server.exe --doctor  (hoặc CHAN-DOAN.bat)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const { execFileSync } = require('child_process');

const HOST_NAME = 'com.video_downloader.server';
const PORT = 3847;
const SYS32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const REG_EXE = path.join(SYS32, 'reg.exe');

const BROWSER_KEYS = [
  ['Chrome',   'Software\\Google\\Chrome\\NativeMessagingHosts'],
  ['Chromium', 'Software\\Chromium\\NativeMessagingHosts'],
  ['Edge',     'Software\\Microsoft\\Edge\\NativeMessagingHosts'],
  ['Brave',    'Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts'],
  ['Vivaldi',  'Software\\Vivaldi\\NativeMessagingHosts'],
  ['Coc Coc',  'Software\\CocCoc\\Browser\\NativeMessagingHosts'],
  ['Opera',    'Software\\Opera Software\\Opera Stable\\NativeMessagingHosts'],
];

const problems = [];

function section(title) {
  console.log('');
  console.log('=== ' + title + ' ===');
}

function ok(msg)   { console.log('  [OK]   ' + toAscii(msg)); }
function warn(msg) { console.log('  [WARN] ' + toAscii(msg)); }
function bad(msg)  { const m = toAscii(msg); console.log('  [LOI]  ' + m); problems.push(m); }
/** Dòng phụ đi kèm một lỗi — in ra nhưng không đếm thành lỗi riêng */
function detail(msg) { console.log('         ' + toAscii(msg)); }

/**
 * Đọc giá trị (Default) của một khoá registry.
 *
 * Không dùng `reg query` + execFileSync: reg.exe in ra theo bảng mã OEM
 * (CP437/CP850), Node lại decode bằng UTF-8 nên đường dẫn tiếng Việt bị hỏng
 * ("Máy tính" -> "M?y t?nh") và mọi phép so sánh đường dẫn đều sai.
 * `reg export` ghi file .reg chuẩn UTF-16LE nên đọc lại là chính xác tuyệt đối.
 */
function readRegDefault(key) {
  const tmp = path.join(os.tmpdir(), `vd_doctor_${Date.now()}_${Math.random().toString(36).slice(2)}.reg`);
  try {
    execFileSync(REG_EXE, ['export', `HKCU\\${key}`, tmp, '/y'], {
      stdio: 'pipe', windowsHide: true,
    });
    const text = fs.readFileSync(tmp, 'utf16le');
    const m = text.match(/^@="(.*)"\s*$/m);
    if (!m) return null;
    // Trong file .reg, dấu \ được nhân đôi
    return m[1].replace(/\\\\/g, '\\').replace(/\\"/g, '"');
  } catch (e) {
    return null; // khoá không tồn tại
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
}

function appDir() {
  return process.pkg ? path.dirname(process.execPath) : __dirname;
}

/**
 * Bỏ dấu tiếng Việt để in ra console.
 * Console Windows mặc định dùng bảng mã OEM (CP437/CP850), còn log ghi bằng
 * UTF-8, nên in thẳng sẽ ra ký tự rác. Không thể chữa bằng `chcp 65001` vì đặt
 * lệnh đó trong file .bat làm cmd.exe đọc lệch chính file bat.
 */
function toAscii(str) {
  return String(str)
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '?');
}

function samePath(a, b) {
  try {
    return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  } catch (e) {
    return false;
  }
}

// --- 1. Vị trí cài đặt -------------------------------------------------------

function checkLocation() {
  section('1. Vi tri cai dat');
  const dir = appDir();
  console.log('  Thu muc : ' + toAscii(dir));
  console.log('  Exe     : ' + toAscii(process.execPath));
  try {
    // Cho phep doi chieu: ban exe da copy sang may nay co dung ban moi nhat khong
    console.log('  Build   : ' + fs.statSync(process.execPath).mtime.toLocaleString());
  } catch (e) {}

  const probe = path.join(dir, '.vd_write_test');
  try {
    fs.writeFileSync(probe, 'x');
    fs.unlinkSync(probe);
    ok('Thu muc ghi duoc');
  } catch (e) {
    bad('Thu muc KHONG ghi duoc (' + e.code + '). Chuyen ra ngoai Program Files.');
  }

  if (/onedrive/i.test(dir)) {
    warn('Thu muc nam trong OneDrive.');
    warn('  Neu OneDrive dat che do "Files On-Demand", file server.exe co the chi la');
    warn('  file dai dien chua tai ve, khien trinh duyet khong chay duoc no.');
    warn('  Cach xu ly: chuot phai thu muc -> "Always keep on this device",');
    warn('  hoac chuyen han thu muc ra ngoai OneDrive (vi du C:\\VideoDownloader).');
  }
}

// --- 2. Cong cu --------------------------------------------------------------

function checkTools() {
  section('2. Cong cu trong bin/');
  const bin = path.join(appDir(), 'bin');
  if (!fs.existsSync(bin)) {
    warn('Chua co thu muc bin/. Server se tu tai ve o lan chay dau (can Internet).');
    return;
  }
  for (const name of ['yt-dlp.exe', 'ffmpeg.exe', 'ffprobe.exe']) {
    const p = path.join(bin, name);
    if (fs.existsSync(p)) {
      ok(name + ' (' + (fs.statSync(p).size / 1048576).toFixed(1) + ' MB)');
    } else {
      warn(name + ' thieu - server se tu tai ve');
    }
  }
}

// --- 3. Manifest -------------------------------------------------------------

function checkManifest() {
  section('3. File manifest native host');
  const manifestPath = path.join(appDir(), HOST_NAME + '.json');

  if (!fs.existsSync(manifestPath)) {
    bad('Chua co file manifest: ' + manifestPath);
    detail('=> CHUA CHAY setup.bat tren may nay. Hay chay setup.bat.');
    return null;
  }
  ok('Co file: ' + manifestPath);

  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    bad('File manifest hong: ' + e.message);
    return null;
  }

  console.log('  path            : ' + toAscii(cfg.path));
  console.log('  allowed_origins : ' + toAscii((cfg.allowed_origins || []).join(', ')));

  if (!cfg.path || !fs.existsSync(cfg.path)) {
    bad('manifest.path tro toi file KHONG TON TAI.');
    detail('=> Thu muc da bi di chuyen. Chay lai setup.bat.');
  } else if (process.pkg && !samePath(cfg.path, process.execPath)) {
    bad('manifest.path tro toi exe KHAC voi exe dang chay.');
    detail('manifest : ' + cfg.path);
    detail('hien tai : ' + process.execPath);
    detail('=> Chay lai setup.bat.');
  } else {
    ok('manifest.path tro dung file thuc thi');
  }

  return manifestPath;
}

// --- 4. Registry -------------------------------------------------------------

function checkRegistry(manifestPath) {
  section('4. Registry (Native Messaging)');
  let found = 0;

  for (const [label, key] of BROWSER_KEYS) {
    const value = readRegDefault(`${key}\\${HOST_NAME}`);

    if (!value) {
      console.log(`  [--]   ${label}: chua dang ky`);
      continue;
    }

    found++;
    if (!fs.existsSync(value)) {
      bad(`${label}: tro toi file khong ton tai`);
      detail('-> ' + value);
      detail('=> Thu muc da bi di chuyen. Chay lai setup.bat.');
    } else if (manifestPath && !samePath(value, manifestPath)) {
      bad(`${label}: tro toi manifest KHAC`);
      detail('registry : ' + value);
      detail('hien tai : ' + manifestPath);
      detail('=> Chay lai setup.bat.');
    } else {
      ok(`${label}`);
    }
  }

  if (found === 0) {
    bad('KHONG co trinh duyet nao duoc dang ky.');
    detail('=> CHAY setup.bat tren may nay (bam dup, khong can quyen Admin).');
  }
}

// --- 5. Server ---------------------------------------------------------------

function checkServer() {
  return new Promise((resolve) => {
    section('5. Server');
    const req = http.get(`http://localhost:${PORT}/api/health`, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        ok('Server dang chay: ' + data.trim());
        resolve(true);
      });
    });
    req.on('error', () => {
      warn('Server chua chay (dieu nay binh thuong neu chua mo trinh duyet).');
      resolve(false);
    });
    req.setTimeout(2000, () => { req.destroy(); warn('Server khong phan hoi.'); resolve(false); });
  });
}

// --- 6. Log ------------------------------------------------------------------

function checkLogs() {
  section('6. Log gan nhat');
  for (const name of ['host_js.log', 'server.log']) {
    const candidates = [
      path.join(appDir(), name),
      path.join(os.tmpdir(), 'video-downloader', name),
    ];
    const found = candidates.find((p) => fs.existsSync(p));
    if (!found) {
      warn(name + ': chua co. Trinh duyet CHUA he goi native host lan nao.');
      if (name === 'host_js.log') {
        warn('  => Extension chua duoc cai/reload, hoac registry chua dung.');
      }
      continue;
    }
    console.log('  --- ' + toAscii(found) + ' (10 dong cuoi) ---');
    const lines = fs.readFileSync(found, 'utf8').trim().split(/\r?\n/).slice(-10);
    for (const l of lines) console.log('  ' + toAscii(l));
  }
}

// --- Main --------------------------------------------------------------------

async function main() {
  console.log('');
  console.log('##############################################');
  console.log('#  VIDEO DOWNLOADER - CHAN DOAN              #');
  console.log('##############################################');

  checkLocation();
  checkTools();
  const manifestPath = checkManifest();
  checkRegistry(manifestPath);
  await checkServer();
  checkLogs();

  section('KET LUAN');
  if (problems.length === 0) {
    console.log('  Khong phat hien loi cau hinh.');
    console.log('');
    console.log('  Neu server VAN khong tu khoi dong, kiem tra phia trinh duyet:');
    console.log('   1. Vao chrome://extensions, bat "Developer mode"');
    console.log('   2. Extension "Video Downloader Pro" phai dang BAT');
    console.log('   3. Bam nut reload (mui ten xoay tron) tren the extension');
    console.log('   4. Bam link "service worker" de mo DevTools, xem tab Console');
    console.log('      - Neu thay "Specified native messaging host not found"');
    console.log('        => chay lai setup.bat roi khoi dong lai trinh duyet');
    console.log('      - Neu thay "Access to the specified native messaging host');
    console.log('        is forbidden" => ID extension khong khop allowed_origins');
  } else {
    console.log('  Phat hien ' + problems.length + ' van de:');
    for (const p of problems) console.log('   - ' + p);
  }
  console.log('');
}

main();

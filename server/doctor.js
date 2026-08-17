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

/**
 * Việc người dùng thực sự cần làm.
 * Tách riêng khỏi `problems` vì phần lớn lỗi là hệ quả dây chuyền: thiếu
 * manifest kéo theo 7 khoá registry hỏng và 4 thư viện chưa tải — nhưng tất cả
 * chỉ cần MỘT hành động. Liệt kê 12 lỗi ngang hàng làm người dùng hoảng
 * và không biết bắt đầu từ đâu.
 */
const actions = new Map(); // key -> { order, text }

function needAction(key, order, text) {
  if (!actions.has(key)) actions.set(key, { order, text });
}

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
  // Doi chieu voi may goc: sai phien ban la nguyen nhan pho bien nhat
  try { console.log('  Phien ban: ' + require('./package.json').version); } catch (e) {}
  try {
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
  section('2. Cong cu');

  const bin = path.join(appDir(), 'bin');
  console.log('  Thu muc bin/: ' + (fs.existsSync(bin) ? toAscii(bin) : 'chua co (server se tu tai ve)'));
  console.log('');

  let rt;
  try {
    rt = require('./lib/resolve-tools');
    // Tam tat log cua resolve-tools cho ban chan doan de doc
    const saved = [console.log, console.warn, console.error];
    console.log = console.warn = console.error = () => {};
    try {
      rt.resolveAllTools();
    } finally {
      [console.log, console.warn, console.error] = saved;
    }
  } catch (e) {
    bad('Khong nap duoc resolve-tools: ' + e.message);
    return;
  }

  for (const name of ['yt-dlp', 'ffmpeg', 'ffprobe']) {
    if (rt.isToolResolved(name)) {
      ok(name.padEnd(8) + toAscii(rt.getToolPath(name)));
    } else {
      bad(name.padEnd(8) + 'KHONG TIM THAY');
      detail('=> Server se tu tai ve o lan chay sau (can Internet).');
      needAction('tools', 3, 'Bat server mot lan de no tu tai thu vien (~230MB, can Internet).');
    }
  }

  // JS runtime: thieu la YouTube bao "n challenge solving failed" va chi tai
  // duoc anh, du yt-dlp/ffmpeg deu day du.
  console.log('');
  const hasDeno = rt.isToolResolved('deno');
  const hasNode = rt.isToolResolved('node');
  if (hasDeno) ok('deno    ' + toAscii(rt.getToolPath('deno')));
  if (hasNode) ok('node    ' + toAscii(rt.getToolPath('node')));

  if (hasDeno || hasNode) {
    ok('JS runtime: co (' + (hasDeno ? 'deno' : 'node') + ') - tai YouTube duoc');
  } else {
    bad('JS runtime: KHONG CO (thieu ca deno lan node)');
    detail('=> YouTube se bao "n challenge solving failed" va chi tai duoc anh.');
    detail('=> Server se tu tai Node.js ve o lan chay sau.');
    needAction('tools', 3, 'Bat server mot lan de no tu tai thu vien (~230MB, can Internet).');
  }
}

// --- 3. Manifest -------------------------------------------------------------

function checkManifest() {
  section('3. File manifest native host');
  const manifestPath = path.join(appDir(), HOST_NAME + '.json');

  if (!fs.existsSync(manifestPath)) {
    bad('Chua co file manifest: ' + manifestPath);
    detail('=> CHUA CHAY setup.bat tren may nay. Hay chay setup.bat.');
    needAction('setup', 1, 'Chay setup.bat (bam dup, khong can quyen Admin).');
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

  // Tren Windows, Chrome cho phep path tuong doi so voi thu muc chua manifest.
  // Ban zip xuat xuong dung dang tuong doi de khong phu thuoc may nao.
  const resolvedExe = cfg.path
    ? path.resolve(path.dirname(manifestPath), cfg.path)
    : '';

  if (!cfg.path || !fs.existsSync(resolvedExe)) {
    bad('manifest.path tro toi file KHONG TON TAI.');
    detail('=> Thu muc da bi di chuyen. Chay lai setup.bat.');
    needAction('setup', 1, 'Chay setup.bat (bam dup, khong can quyen Admin).');
  } else if (process.pkg && !samePath(resolvedExe, process.execPath)) {
    bad('manifest.path tro toi exe KHAC voi exe dang chay.');
    detail('manifest : ' + resolvedExe);
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
      needAction('setup', 1, 'Chay setup.bat (bam dup, khong can quyen Admin).');
    } else if (manifestPath && !samePath(value, manifestPath)) {
      bad(`${label}: tro toi manifest KHAC`);
      detail('registry : ' + value);
      detail('hien tai : ' + manifestPath);
      detail('=> Chay lai setup.bat.');
      needAction('setup', 1, 'Chay setup.bat (bam dup, khong can quyen Admin).');
    } else {
      ok(`${label}`);
    }
  }

  if (found === 0) {
    bad('KHONG co trinh duyet nao duoc dang ky.');
    detail('=> CHAY setup.bat tren may nay (bam dup, khong can quyen Admin).');
    needAction('setup', 1, 'Chay setup.bat (bam dup, khong can quyen Admin).');
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
        needAction('ext', 2, 'Vao chrome://extensions -> Developer mode -> Load unpacked -> chon thu muc extension (neu da cai thi bam reload).');
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
    // Phan lon loi la he qua day chuyen (thieu manifest -> 7 khoa registry
    // hong -> 4 thu vien chua tai). In danh sach VIEC CAN LAM, khong dumb
    // 12 dong loi ngang hang khien nguoi dung khong biet bat dau tu dau.
    const todo = [...actions.values()].sort((a, b) => a.order - b.order);

    console.log('  VIEC CAN LAM (theo dung thu tu):');
    console.log('');
    todo.forEach((a, i) => console.log('   ' + (i + 1) + '. ' + a.text));

    if (todo.length > 0 && todo[0].text.startsWith('Chay setup.bat')) {
      console.log('');
      console.log('  Chi can lam buoc 1 la phan lon loi ben tren tu het:');
      console.log('  setup.bat ghi lai file manifest, cac khoa registry se tro dung');
      console.log('  vao no, roi trinh duyet moi goi duoc server.');
    }

    console.log('');
    console.log('  --- Chi tiet ' + problems.length + ' van de da phat hien ---');
    for (const p of problems) console.log('   - ' + p);
  }
  console.log('');
}

main();

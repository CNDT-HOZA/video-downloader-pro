/**
 * resolve-tools.js — Tìm ffmpeg, ffprobe, yt-dlp, node trên Windows
 * Giải quyết vấn đề PATH không cập nhật khi server chạy từ Native Messaging Host
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// node là tuỳ chọn (yt-dlp dùng làm JS runtime), thiếu thì chỉ cảnh báo
const TOOL_NAMES = ['ffmpeg', 'ffprobe', 'yt-dlp', 'node'];
const OPTIONAL_TOOLS = ['node'];
const resolvedPaths = {};

/**
 * Thư mục vật lý của ứng dụng trên đĩa.
 * Khi đóng gói bằng pkg, __dirname trỏ vào snapshot ảo (C:\snapshot\...) chỉ đọc,
 * nên mọi thao tác với file thật phải đi từ process.execPath.
 */
function getAppDir() {
  return process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
}

function getBinDir() {
  return path.join(getAppDir(), 'bin');
}

function pathSegments() {
  return (process.env.PATH || '').split(path.delimiter).filter(Boolean);
}

function hasInPath(dir) {
  let target;
  try {
    target = path.resolve(dir).toLowerCase();
  } catch (e) {
    return true;
  }
  return pathSegments().some((p) => {
    try {
      return path.resolve(p).toLowerCase() === target;
    } catch (e) {
      return false;
    }
  });
}

function addToPath(dir) {
  if (!dir || hasInPath(dir)) return;
  process.env.PATH = dir + path.delimiter + (process.env.PATH || '');
}

// REG_EXPAND_SZ trả về chuỗi chưa nở, ví dụ %SystemRoot%\system32
function expandEnvVars(str) {
  return str.replace(/%([^%]+)%/g, (m, name) => process.env[name] || m);
}

function refreshPath() {
  const sys32 = 'C:\\Windows\\System32';
  addToPath(sys32);

  const regExe = path.join(sys32, 'reg.exe');
  const queries = [
    'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
    'HKCU\\Environment',
  ];

  for (const key of queries) {
    try {
      const out = execSync(`"${regExe}" query "${key}" /v Path`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const match = out.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i);
      if (!match) continue;

      // Gộp thêm vào PATH hiện tại, KHÔNG thay thế — nếu thay thế sẽ mất
      // các thư mục do tiến trình cha (Chrome / native host) truyền vào.
      for (const dir of expandEnvVars(match[1].trim()).split(';')) {
        const d = dir.trim();
        if (d) addToPath(d);
      }
    } catch (err) {
      // Key không tồn tại hoặc không có quyền đọc — bỏ qua
    }
  }

  addToPath(sys32);
}

function findTool(name) {
  const exeName = name + (process.platform === 'win32' ? '.exe' : '');
  const binDir = getBinDir();

  // 0. Ưu tiên tuyệt đối thư mục bin/ đi kèm ứng dụng (portable mode)
  const localCandidates = [
    path.join(binDir, exeName),
    path.join(binDir, name, exeName), // bin\node\node.exe
  ];
  for (const candidate of localCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  // 1. Thử PATH hiện tại
  for (const dir of pathSegments()) {
    try {
      const fullPath = path.join(dir, exeName);
      if (fs.existsSync(fullPath)) return fullPath;
    } catch (e) {
      // Segment PATH không hợp lệ
    }
  }

  // 2. Tìm trong các vị trí phổ biến trên Windows
  if (process.platform === 'win32') {
    const home = process.env.USERPROFILE || '';
    const commonPaths = [
      // WinGet FFmpeg
      path.join(home, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages'),
      // Chocolatey
      'C:\\ProgramData\\chocolatey\\bin',
      // Scoop
      path.join(home, 'scoop', 'shims'),
      // Manual installs
      'C:\\ffmpeg\\bin',
      path.join(home, 'ffmpeg', 'bin'),
      // Node.js
      'C:\\Program Files\\nodejs',
      'C:\\Program Files (x86)\\nodejs',
      path.join(home, 'AppData', 'Roaming', 'npm'),
      // Python Scripts (for yt-dlp)
      path.join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'Scripts'),
      path.join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'Scripts'),
      path.join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python310', 'Scripts'),
      path.join(home, 'AppData', 'Roaming', 'Python', 'Python312', 'Scripts'),
      // pip --user
      path.join(home, 'AppData', 'Local', 'pip', 'Scripts'),
    ];

    for (const dir of commonPaths) {
      // Tìm đệ quy trong WinGet packages
      if (dir.includes('WinGet') && fs.existsSync(dir)) {
        const found = findInDirRecursive(dir, exeName, 3);
        if (found) return found;
      } else {
        const fullPath = path.join(dir, exeName);
        if (fs.existsSync(fullPath)) return fullPath;
      }
    }
  }

  return null;
}

function findInDirRecursive(dir, filename, maxDepth, depth = 0) {
  if (depth > maxDepth) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) {
        return fullPath;
      }
      if (entry.isDirectory()) {
        const found = findInDirRecursive(fullPath, filename, maxDepth, depth + 1);
        if (found) return found;
      }
    }
  } catch (err) {
    // Permission denied, etc.
  }
  return null;
}

function resolveAllTools() {
  // Refresh PATH trước
  refreshPath();

  // bin/ luôn được ưu tiên trong PATH để các tiến trình con (yt-dlp gọi ffmpeg,
  // yt-dlp gọi node làm JS runtime) tìm thấy đúng bản đi kèm.
  addToPath(getBinDir());

  for (const name of TOOL_NAMES) {
    const toolPath = findTool(name);
    if (toolPath) {
      resolvedPaths[name] = toolPath;
      addToPath(path.dirname(toolPath));
      console.log(`[resolve-tools] OK ${name}: ${toolPath}`);
    } else {
      delete resolvedPaths[name];
      if (OPTIONAL_TOOLS.includes(name)) {
        console.warn(`[resolve-tools] (tuỳ chọn) ${name}: không tìm thấy`);
      } else {
        console.error(`[resolve-tools] THIẾU ${name}: KHÔNG TÌM THẤY!`);
      }
    }
  }

  // Reset hw-accel cache để probe lại GPU với đúng FFmpeg version
  try { require('./hw-accel').resetCache(); } catch (e) {}

  return resolvedPaths;
}

/**
 * Trả về đường dẫn tuyệt đối của tool. Nếu chưa resolve được thì trả về tên trần
 * để hệ điều hành tự tìm trong PATH (hành vi cũ, dùng làm phương án cuối).
 */
function getToolPath(name) {
  return resolvedPaths[name] || name;
}

/** true nếu tool đã được tìm thấy ở một đường dẫn cụ thể */
function isToolResolved(name) {
  return Boolean(resolvedPaths[name]);
}

module.exports = { resolveAllTools, getToolPath, isToolResolved, getAppDir, getBinDir };

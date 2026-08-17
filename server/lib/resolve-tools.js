/**
 * resolve-tools.js — Tìm ffmpeg, ffprobe, yt-dlp trên Windows
 * Giải quyết vấn đề PATH không cập nhật khi server chạy từ Native Messaging Host
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const TOOL_NAMES = ['ffmpeg', 'ffprobe', 'yt-dlp'];
const resolvedPaths = {};

function refreshPath() {
  // Đảm bảo System32 luôn trong PATH
  const sys32 = 'C:\\Windows\\System32';
  if (!process.env.PATH.includes(sys32)) {
    process.env.PATH = sys32 + path.delimiter + process.env.PATH;
  }

  try {
    const regExe = path.join(sys32, 'reg.exe');
    // Đọc PATH mới nhất từ registry (cả Machine + User)
    const machinePath = execSync(
      `"${regExe}" query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment" /v Path`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
    ).match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i);

    const userPath = execSync(
      `"${regExe}" query "HKCU\\Environment" /v Path`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
    ).match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i);

    const parts = [];
    if (machinePath) parts.push(machinePath[1].trim());
    if (userPath) parts.push(userPath[1].trim());

    if (parts.length > 0) {
      process.env.PATH = parts.join(';');
      // Đảm bảo System32 vẫn trong PATH sau refresh
      if (!process.env.PATH.includes(sys32)) {
        process.env.PATH = sys32 + path.delimiter + process.env.PATH;
      }
      console.log('[resolve-tools] PATH refreshed from registry');
    }
  } catch (err) {
    console.warn('[resolve-tools] Could not refresh PATH:', err.message);
  }
}

function findTool(name) {
  const exeName = name + (process.platform === 'win32' ? '.exe' : '');

  // 0. Ưu tiên thư mục bin/ trong dự án (portable mode)
  const localBin = path.join(__dirname, '..', 'bin');
  const localPath = path.join(localBin, exeName);
  if (fs.existsSync(localPath)) {
    return localPath;
  }

  // 1. Thử PATH hiện tại
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of dirs) {
    const fullPath = path.join(dir, exeName);
    if (fs.existsSync(fullPath)) {
      return fullPath;
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

  for (const name of TOOL_NAMES) {
    const toolPath = findTool(name);
    if (toolPath) {
      resolvedPaths[name] = toolPath;
      // Thêm thư mục chứa tool vào PATH
      const dir = path.dirname(toolPath);
      if (!process.env.PATH.includes(dir)) {
        process.env.PATH = dir + path.delimiter + process.env.PATH;
      }
      console.log(`[resolve-tools] ✅ ${name}: ${toolPath}`);
    } else {
      console.error(`[resolve-tools] ❌ ${name}: KHÔNG TÌM THẤY!`);
    }
  }

  // Reset hw-accel cache để probe lại GPU với đúng FFmpeg version
  try { require('./hw-accel').resetCache(); } catch(e) {}

  return resolvedPaths;
}

function getToolPath(name) {
  return resolvedPaths[name] || name;
}

module.exports = { resolveAllTools, getToolPath };

/**
 * cli.js — điểm vào duy nhất của server.exe
 *
 *   server.exe --setup    → đăng ký Native Messaging Host vào registry
 *   server.exe --server   → chạy Express server nền (cổng 3847)
 *   server.exe <origin>   → chế độ Native Messaging Host (Chrome tự gọi,
 *                           truyền vào chrome-extension://... và --parent-window)
 *   server.exe            → không tham số (người dùng bấm đúp) → chạy server
 */

const args = process.argv.slice(2);

const isNativeHostLaunch = args.some(
  (a) => a.startsWith('chrome-extension://') || a.startsWith('--parent-window')
);

if (args.includes('--setup')) {
  require('./setup-registry.js').main();
} else if (args.includes('--doctor')) {
  require('./doctor.js');
} else if (args.includes('--server') || args.length === 0) {
  require('./index.js');
} else if (isNativeHostLaunch || args.includes('--host')) {
  require('../native-host/host.js');
} else {
  console.error(`Tham so khong hop le: ${args.join(' ')}`);
  console.error('Dung: server.exe [--setup | --server | --doctor]');
  process.exit(2);
}

const { execSync } = require('child_process');
try {
  const buf = execSync('reg query "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.video_downloader.server" /ve');
  console.log('Hex dump of registry output:');
  console.log(buf.toString('hex'));
  console.log('String output (utf8):');
  console.log(buf.toString('utf8'));
} catch(e) {
  console.error(e.message);
}

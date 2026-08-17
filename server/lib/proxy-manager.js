const https = require('https');
const http = require('http');

class ProxyManager {
  constructor() {
    this.proxies = [];
    this.currentIndex = 0;
    this.isFetching = false;
    // URL cung cấp proxy miễn phí (HTTP)
    this.apiUrl = 'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all';
  }

  async fetchProxies() {
    if (this.isFetching) return;
    this.isFetching = true;
    console.log('[ProxyManager] Đang tải danh sách Proxy mới...');

    try {
      const data = await new Promise((resolve, reject) => {
        https.get(this.apiUrl, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => resolve(body));
        }).on('error', reject);
      });

      // Parse danh sách IP:PORT
      const lines = data.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 5 && l.includes(':'));
      
      // Trộn ngẫu nhiên (Shuffle)
      for (let i = lines.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [lines[i], lines[j]] = [lines[j], lines[i]];
      }

      this.proxies = lines;
      this.currentIndex = 0;
      console.log(`[ProxyManager] Đã nạp thành công ${this.proxies.length} proxy.`);
    } catch (err) {
      console.error('[ProxyManager] Lỗi tải proxy:', err.message);
    } finally {
      this.isFetching = false;
    }
  }

  async getProxy() {
    // Nếu chưa có proxy hoặc sắp hết, tải thêm
    if (this.proxies.length === 0 || this.currentIndex >= this.proxies.length - 5) {
      await this.fetchProxies();
    }
    
    if (this.proxies.length === 0) return null; // Fallback nếu chết toàn bộ

    const proxy = this.proxies[this.currentIndex];
    this.currentIndex++;
    return `http://${proxy}`;
  }

  markProxyDead(proxyUrl) {
    if (!proxyUrl) return;
    const ipPort = proxyUrl.replace('http://', '').replace('https://', '').replace('socks5://', '');
    const index = this.proxies.indexOf(ipPort);
    if (index !== -1) {
      this.proxies.splice(index, 1);
      if (this.currentIndex > index) {
        this.currentIndex--;
      }
    }
  }
}

// Khởi tạo Singleton
const proxyManager = new ProxyManager();

module.exports = proxyManager;

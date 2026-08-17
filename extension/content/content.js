// content.js — Phát hiện video & hiển thị overlay tải xuống
(() => {
  'use strict';

  const MIN_WIDTH = 200;
  const MIN_HEIGHT = 120;
  const overlayMap = new WeakMap();
  let lastUrl = location.href;

  // === Platform Detection ===
  const PLATFORMS = [
    { name: 'YouTube', pattern: /youtube\.com\/(watch|shorts|live)|youtu\.be\// },
    { name: 'TikTok', pattern: /tiktok\.com\/@[^/]+\/video\// },
    { name: 'Facebook', pattern: /facebook\.com\/(watch|reel\/|.*\/videos\/)/ },
    { name: 'Instagram', pattern: /instagram\.com\/(reel\/|p\/)/ },
    { name: 'X', pattern: /(twitter|x)\.com\/[^/]+\/status\// },
    { name: 'Vimeo', pattern: /vimeo\.com\/\d+/ },
    { name: 'Dailymotion', pattern: /dailymotion\.com\/video\// },
    { name: 'Bilibili', pattern: /bilibili\.com\/video\// },
  ];

  function getCurrentPlatform() {
    return PLATFORMS.find((p) => p.pattern.test(location.href));
  }

  function getVideoUrl(videoEl) {
    const platform = getCurrentPlatform();
    if (platform) return location.href;
    if (videoEl.src && videoEl.src.startsWith('http') && !videoEl.src.startsWith('blob:')) return videoEl.src;
    const source = videoEl.querySelector('source[src]');
    if (source && source.src && !source.src.startsWith('blob:')) return source.src;
    return location.href;
  }

  // === Shadow DOM CSS ===
  const OVERLAY_CSS = `
    * { box-sizing: border-box; margin: 0; padding: 0; }

    :host {
      position: absolute !important;
      top: 10px !important;
      right: 10px !important;
      z-index: 2147483647 !important;
      pointer-events: auto !important;
      display: block !important;
      line-height: normal !important;
    }

    .vdp {
      font-family: 'Segoe UI', -apple-system, system-ui, sans-serif;
      font-size: 13px;
      color: #f1f1f4;
      line-height: 1.4;
      position: relative;
      text-align: left;
      direction: ltr;
    }

    .vdp-trigger {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      border: none;
      background: rgba(34, 197, 94, 0.85);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
      opacity: 0.75;
      transform: scale(1);
      pointer-events: auto;
    }

    :host(:hover) .vdp-trigger,
    .vdp-trigger.active {
      opacity: 1;
      transform: scale(1.05);
    }

    .vdp-trigger:hover {
      background: rgba(34, 197, 94, 1);
      transform: scale(1.08) !important;
      box-shadow: 0 4px 16px rgba(59, 130, 246, 0.4);
    }

    .vdp-trigger svg {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }

    .vdp-panel {
      position: absolute;
      top: 50px;
      right: 0;
      width: 260px;
      background: rgba(12, 12, 16, 0.92);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-radius: 14px;
      padding: 16px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.08);
      display: flex;
      flex-direction: column;
      gap: 12px;
      animation: vdpSlideIn 0.2s ease;
      pointer-events: auto;
    }

    @keyframes vdpSlideIn {
      from { opacity: 0; transform: translateY(-8px) scale(0.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .vdp-panel.hidden {
      display: none !important;
    }

    .vdp-title {
      font-size: 14px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 6px;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      letter-spacing: -0.01em;
    }

    .vdp-title svg {
      width: 16px;
      height: 16px;
      color: #3b82f6;
    }

    .vdp-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .vdp-label {
      font-size: 11px;
      color: #68687a;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .vdp-select {
      width: 100%;
      padding: 8px 28px 8px 10px;
      background: rgba(255, 255, 255, 0.07);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      color: #f1f1f4;
      font-family: inherit;
      font-size: 13px;
      outline: none;
      cursor: pointer;
      appearance: none;
      -webkit-appearance: none;
      transition: border-color 0.15s;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%239898a6'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 10px center;
    }

    .vdp-select:focus {
      border-color: #3b82f6;
    }

    .vdp-select option {
      background: #1a1a24;
      color: #f1f1f4;
    }

    .vdp-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .vdp-download {
      width: 100%;
      padding: 10px;
      background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%);
      border: none;
      border-radius: 10px;
      color: white;
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
      box-shadow: 0 2px 8px rgba(59, 130, 246, 0.25);
      letter-spacing: -0.01em;
    }

    .vdp-download:hover {
      filter: brightness(1.1);
      box-shadow: 0 4px 14px rgba(59, 130, 246, 0.35);
      transform: translateY(-1px);
    }

    .vdp-download:active {
      transform: scale(0.98);
    }

    .vdp-download:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
      filter: none;
    }

    .vdp-download.success {
      background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
      box-shadow: 0 2px 8px rgba(34, 197, 94, 0.25);
    }

    .vdp-download.error {
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      box-shadow: 0 2px 8px rgba(239, 68, 68, 0.25);
    }

    .vdp-status {
      font-size: 12px;
      color: #9898a6;
      text-align: center;
      padding: 4px;
    }

    .vdp-status.hidden { display: none; }

    .vdp-loading {
      display: flex;
      justify-content: center;
      padding: 8px;
    }

    .vdp-spinner {
      width: 18px;
      height: 18px;
      border: 2px solid rgba(255, 255, 255, 0.15);
      border-top-color: #3b82f6;
      border-radius: 50%;
      animation: vdpSpin 0.7s linear infinite;
    }

    @keyframes vdpSpin {
      to { transform: rotate(360deg); }
    }
  `;

  // === Create Overlay ===

  function createOverlay(videoEl) {
    if (overlayMap.has(videoEl)) return;

    const rect = videoEl.getBoundingClientRect();
    if (rect.width < MIN_WIDTH || rect.height < MIN_HEIGHT) return;

    const videoUrl = getVideoUrl(videoEl);

    // Find positioned parent
    const parent = findPositionedParent(videoEl);
    if (!parent) return;

    // Create shadow host
    const host = document.createElement('vdp-overlay');
    const shadow = host.attachShadow({ mode: 'open' });

    // Style
    const styleEl = document.createElement('style');
    styleEl.textContent = OVERLAY_CSS;
    shadow.appendChild(styleEl);

    // Container
    const container = document.createElement('div');
    container.className = 'vdp';
    container.innerHTML = `
      <button class="vdp-trigger" title="Tải video">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </button>
      <div class="vdp-panel hidden">
        <div class="vdp-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          Tải video
        </div>
        <div class="vdp-row">
          <div class="vdp-group">
            <span class="vdp-label">Chất lượng</span>
            <select class="vdp-select vdp-quality">
              <option value="best">Tốt nhất</option>
            </select>
          </div>
          <div class="vdp-group">
            <span class="vdp-label">Định dạng</span>
            <select class="vdp-select vdp-format">
              <option value="h264">H.264</option>
              <option value="h265">H.265</option>
            </select>
          </div>
        </div>
        <button class="vdp-download">Tải xuống & Convert</button>
        <div class="vdp-status hidden"></div>
      </div>
    `;
    shadow.appendChild(container);

    parent.appendChild(host);
    overlayMap.set(videoEl, host);

    // Wire events
    setupEvents(host, shadow, container, videoUrl);
  }

  function findPositionedParent(videoEl) {
    // YouTube: dùng player container
    if (/youtube\.com/.test(location.hostname)) {
      const player = document.querySelector('#movie_player');
      if (player) return player;
      const html5Player = document.querySelector('.html5-video-player');
      if (html5Player) return html5Player;
    }

    // Duyệt lên tìm parent có position != static
    let el = videoEl.parentElement;
    let depth = 0;
    while (el && el !== document.body && el !== document.documentElement && depth < 8) {
      const style = getComputedStyle(el);
      if (style.position !== 'static') {
        return el;
      }
      el = el.parentElement;
      depth++;
    }

    // Fallback: set parent relative
    const parent = videoEl.parentElement;
    if (parent && parent !== document.body) {
      parent.style.position = 'relative';
      return parent;
    }

    return null;
  }

  // === Event Setup ===

  function setupEvents(host, shadow, container, videoUrl) {
    const trigger = container.querySelector('.vdp-trigger');
    const panel = container.querySelector('.vdp-panel');
    const qualitySelect = container.querySelector('.vdp-quality');
    const formatSelect = container.querySelector('.vdp-format');
    const downloadBtn = container.querySelector('.vdp-download');
    const statusEl = container.querySelector('.vdp-status');

    let panelOpen = false;
    let formatsLoaded = false;
    let currentProxyUrl = null;

    function openPanel() {
      panel.classList.remove('hidden');
      trigger.classList.add('active');
      panelOpen = true;

      if (!formatsLoaded) {
        loadFormats();
      }
    }

    function closePanel() {
      panel.classList.add('hidden');
      trigger.classList.remove('active');
      panelOpen = false;
    }

    async function loadFormats() {
      statusEl.textContent = '';
      statusEl.classList.add('hidden');

      // Thêm loading spinner
      const loadingDiv = document.createElement('div');
      loadingDiv.className = 'vdp-loading';
      loadingDiv.innerHTML = '<div class="vdp-spinner"></div>';
      panel.insertBefore(loadingDiv, downloadBtn);

      try {
        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { action: 'fetchFormats', url: videoUrl },
            resolve
          );
        });

        loadingDiv.remove();

        if (response && response.formats) {
          formatsLoaded = true;
          currentProxyUrl = response.usedProxy || null;
          populateQualities(qualitySelect, response.formats, response.usedFallback);
        } else if (response && response.error) {
          statusEl.innerText = response.error;
          statusEl.classList.remove('hidden');
        }
      } catch (err) {
        loadingDiv.remove();
        statusEl.textContent = 'Lỗi kết nối server';
        statusEl.classList.remove('hidden');
      }
    }

    // Toggle panel on trigger click
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (panelOpen) closePanel();
      else openPanel();
    });

    // Prevent clicks inside panel from propagating
    panel.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // Download button
    downloadBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();

      downloadBtn.disabled = true;
      downloadBtn.textContent = 'Đang xử lý...';
      downloadBtn.className = 'vdp-download';

      try {
        const selectedVal = qualitySelect.value;
        const msg = {
          action: 'startDownload',
          url: videoUrl,
          codec: formatSelect.value,
          keepOriginalRes: true,
          proxy: currentProxyUrl
        };
        if (selectedVal === 'best') {
          msg.quality = 'best';
        } else {
          msg.formatId = selectedVal;
        }

        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage(msg, resolve);
        });

        if (response && response.taskId) {
          downloadBtn.textContent = '✓ Đã thêm vào hàng đợi';
          downloadBtn.className = 'vdp-download success';
          setTimeout(() => {
            downloadBtn.textContent = 'Tải xuống & Convert';
            downloadBtn.className = 'vdp-download';
            downloadBtn.disabled = false;
            closePanel();
          }, 2000);
        } else {
          throw new Error(response?.error || 'Unknown error');
        }
      } catch (err) {
        downloadBtn.textContent = '✗ Lỗi — thử lại';
        downloadBtn.className = 'vdp-download error';
        downloadBtn.disabled = false;
        statusEl.textContent = err.message || 'Kiểm tra server đang chạy';
        statusEl.classList.remove('hidden');
      }
    });

    // Close panel on outside click
    document.addEventListener('click', (e) => {
      if (panelOpen && !host.contains(e.target)) {
        closePanel();
      }
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panelOpen) {
        closePanel();
      }
    });
  }

  function populateQualities(selectEl, formats, usedFallback) {
    const videoFormats = formats
      .filter((f) => {
        if (!f.resolution || f.resolution === 'audio only') return false;
        if (f.vcodec === 'none') return false;
        if (usedFallback) return true; // Bỏ qua bộ lọc nếu server phải dùng fallback
        const m = f.resolution.match(/(\d+)x(\d+)/);
        const h = m ? parseInt(m[2]) : 0;
        return h >= 1080;
      })
      .map((f) => {
        const m = f.resolution.match(/(\d+)x(\d+)/);
        return { ...f, height: m ? parseInt(m[2]) : 0 };
      })
      .sort((a, b) => b.height - a.height || (b.filesize || 0) - (a.filesize || 0));

    videoFormats.forEach((f) => {
      const opt = document.createElement('option');
      opt.value = f.formatId;

      let label = f.height >= 2160 ? `4K ${f.height}p`
        : f.height >= 1440 ? `2K ${f.height}p`
        : f.height >= 1080 ? `FHD ${f.height}p`
        : f.height >= 720 ? `HD ${f.height}p`
        : `${f.height}p`;

      const codec = f.vcodec || '';
      if (codec.startsWith('avc') || codec.startsWith('h264')) label += ' • H.264';
      else if (codec.startsWith('hev') || codec.startsWith('hvc')) label += ' • H.265';
      else if (codec.startsWith('vp9') || codec.startsWith('vp09')) label += ' • VP9';
      else if (codec.startsWith('av01')) label += ' • AV1';

      if (f.fps && f.fps > 30) label += ` • ${f.fps}fps`;

      if (f.filesize) {
        const mb = f.filesize / (1024 * 1024);
        label += mb >= 1024 ? ` • ${(mb/1024).toFixed(1)}GB` : ` • ${mb.toFixed(0)}MB`;
      }

      opt.textContent = label;
      selectEl.appendChild(opt);
    });
  }

  // === Video Scanning ===

  function scanForVideos() {
    const videos = document.querySelectorAll('video');

    videos.forEach((video) => {
      if (overlayMap.has(video)) {
        const host = overlayMap.get(video);
        if (!document.body.contains(host)) {
          overlayMap.delete(video);
        } else {
          return;
        }
      }

      // Chờ video có kích thước
      if (video.readyState >= 1) {
        createOverlay(video);
      } else {
        video.addEventListener('loadedmetadata', () => createOverlay(video), { once: true });
        // Fallback: thử lại sau 2s
        setTimeout(() => createOverlay(video), 2000);
      }
    });

    // Platform-specific: nếu đang ở trang video platform, tìm video chính
    const platform = getCurrentPlatform();
    if (platform && videos.length > 0) {
      // Ưu tiên video lớn nhất
      let mainVideo = null;
      let maxArea = 0;
      videos.forEach((v) => {
        const r = v.getBoundingClientRect();
        const area = r.width * r.height;
        if (area > maxArea) {
          maxArea = area;
          mainVideo = v;
        }
      });
      if (mainVideo) {
        if (overlayMap.has(mainVideo)) {
           const host = overlayMap.get(mainVideo);
           if (!document.body.contains(host)) {
              overlayMap.delete(mainVideo);
              createOverlay(mainVideo);
           }
        } else {
           createOverlay(mainVideo);
        }
      }
    }
  }

  // === Cleanup Removed Videos ===

  function cleanupRemovedOverlays() {
    document.querySelectorAll('vdp-overlay').forEach((host) => {
      // Kiểm tra xem video gốc còn trong DOM không
      const parent = host.parentElement;
      if (!parent || !document.body.contains(parent)) {
        host.remove();
      }
    });
  }

  // === MutationObserver: theo dõi video mới ===

  const observer = new MutationObserver((mutations) => {
    let shouldScan = false;

    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.tagName === 'VIDEO' || node.querySelector?.('video')) {
              shouldScan = true;
              break;
            }
          }
        }

        // Cleanup nếu có node bị xóa
        for (const node of mutation.removedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.tagName === 'VIDEO' || node.querySelector?.('video')) {
              cleanupRemovedOverlays();
            }
          }
        }
      }

      if (shouldScan) break;
    }

    if (shouldScan) {
      // Debounce scan
      clearTimeout(scanForVideos._timer);
      scanForVideos._timer = setTimeout(scanForVideos, 500);
    }

    // SPA navigation detection
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // Xóa overlays cũ trên các trang SPA
      document.querySelectorAll('vdp-overlay').forEach((el) => el.remove());
      // weakmap entries sẽ tự được GC
      setTimeout(scanForVideos, 300);
      setTimeout(scanForVideos, 1500);
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // === Message Handler (từ popup/service-worker) ===

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getVideoUrls') {
      sendResponse(detectVideoUrls());
    } else if (request.action === 'getPageUrl') {
      sendResponse(location.href);
    }
  });

  function detectVideoUrls() {
    const urls = [];
    const addUrl = (url, source, type) => {
      if (url && url.startsWith('http') && !urls.some((u) => u.url === url)) {
        urls.push({ url, source, type });
      }
    };

    // Meta tags
    document
      .querySelectorAll(
        'meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"], meta[name="twitter:player:stream"]'
      )
      .forEach((meta) => addUrl(meta.content, 'meta', 'video'));

    // Video elements
    document.querySelectorAll('video').forEach((video) => {
      if (video.src && !video.src.startsWith('blob:')) addUrl(video.src, 'video', 'video');
      video.querySelectorAll('source').forEach((source) => {
        if (source.src && !source.src.startsWith('blob:')) addUrl(source.src, 'source', 'video');
      });
    });

    // Current page URL (platform)
    const platform = getCurrentPlatform();
    if (platform) {
      addUrl(location.href, 'page', 'platform');
    }

    return urls;
  }

  // === Init ===

  // Quét ngay khi DOM sẵn sàng
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(scanForVideos, 500));
  } else {
    setTimeout(scanForVideos, 500);
  }

  // Quét lại khi trang load xong (cho lazy-loaded videos)
  window.addEventListener('load', () => setTimeout(scanForVideos, 1500));
})();

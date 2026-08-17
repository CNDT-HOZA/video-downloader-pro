const API_URL = 'http://localhost:3847';

// UI Elements
const serverStatus = document.getElementById('serverStatus');
const statusLabel = document.getElementById('statusLabel');
const offlineState = document.getElementById('offlineState');
const startingState = document.getElementById('startingState');
const mainContent = document.getElementById('mainContent');
const copyCmdBtn = document.getElementById('copyCmdBtn');
const retryBtn = document.getElementById('retryBtn');
const offlineDetail = document.getElementById('offlineDetail');
const offlineCmd = document.getElementById('offlineCmd');

const urlInput = document.getElementById('urlInput');
const pasteBtn = document.getElementById('pasteBtn');
const analyzeBtn = document.getElementById('analyzeBtn');
const detectedUrlWrapper = document.getElementById('detectedUrlWrapper');
const detectedUrlText = document.getElementById('detectedUrlText');
const useDetectedUrlBtn = document.getElementById('useDetectedUrlBtn');

const videoInfoCard = document.getElementById('videoInfoCard');
const videoThumb = document.getElementById('videoThumb');
const videoPlatform = document.getElementById('videoPlatform');
const videoDuration = document.getElementById('videoDuration');
const videoTitle = document.getElementById('videoTitle');
const qualitySelect = document.getElementById('qualitySelect');
const formatSelect = document.getElementById('formatSelect');
const keepResToggle = document.getElementById('keepResToggle');
const downloadBtn = document.getElementById('downloadBtn');

const taskList = document.getElementById('taskList');

const outputDirInput = document.getElementById('outputDirInput');
const changeFolderBtn = document.getElementById('changeFolderBtn');
const setupScreen = document.getElementById('setupScreen');
const toolsList = document.getElementById('toolsList');
const installAllBtn = document.getElementById('installAllBtn');
const setupStatus = document.getElementById('setupStatus');

let currentVideoUrl = '';
let currentProxyUrl = null;
let healthCheckAttempts = 0;
const MAX_HEALTH_RETRIES = 300;

// === Server Connection ===

function setServerState(state) {
  serverStatus.className = `server-status ${state}`;
  
  offlineState.classList.add('hidden');
  startingState.classList.add('hidden');
  mainContent.classList.add('hidden');
  
  switch (state) {
    case 'online':
      statusLabel.textContent = 'Đã kết nối';
      mainContent.classList.remove('hidden');
      break;
    case 'connecting':
      statusLabel.textContent = 'Đang kết nối';
      startingState.classList.remove('hidden');
      break;
    case 'installing':
      statusLabel.textContent = 'Đang cài đặt tài nguyên... (1-2 phút)';
      startingState.classList.remove('hidden');
      break;
    case 'offline':
      statusLabel.textContent = 'Offline';
      offlineState.classList.remove('hidden');
      describeOfflineReason();
      break;
  }
}

// Giải thích lý do offline dựa trên phản hồi cuối cùng của native host
async function describeOfflineReason() {
  const state = await chrome.storage.local.get(['serverStatus', 'serverErrorLog']);

  switch (state.serverStatus) {
    case 'host_missing':
      offlineDetail.textContent =
        'Trình duyệt chưa tìm thấy Native Host. Hãy chạy setup.bat trong thư mục cài đặt, rồi mở lại trình duyệt.';
      offlineCmd.textContent = 'setup.bat';
      break;
    case 'start_failed':
      offlineDetail.textContent =
        'Native host chạy được nhưng server không lên. Mở file server\\server.log để xem lỗi.';
      offlineCmd.textContent = 'START_SERVER.bat';
      break;
    default:
      offlineDetail.textContent =
        'Chưa kết nối được server. Bấm "Thử lại", hoặc khởi động thủ công bằng:';
      offlineCmd.textContent = 'START_SERVER.bat';
  }

  if (state.serverErrorLog) {
    console.warn('[Native host]', state.serverErrorLog);
  }
}

async function checkServer() {
  try {
    const res = await fetch(`${API_URL}/api/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'installing') {
        setServerState('installing');
        return false;
      }
      setServerState('online');
      return true;
    }
  } catch (err) {}
  return false;
}

async function waitForServer() {
  setServerState('connecting');
  healthCheckAttempts = 0;

  while (healthCheckAttempts < MAX_HEALTH_RETRIES) {
    healthCheckAttempts++;
    const isOnline = await checkServer();
    if (isOnline) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }

  setServerState('offline');
  return false;
}

// === Detected URL ===

async function loadDetectedUrl() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { action: 'getVideoUrls' }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response && response.length > 0) {
          const mainUrl = response[0].url;
          detectedUrlText.textContent = mainUrl;
          detectedUrlWrapper.classList.remove('hidden');

          useDetectedUrlBtn.onclick = () => {
            urlInput.value = mainUrl;
            detectedUrlWrapper.classList.add('hidden');
            analyzeBtn.click();
          };
        }
      });
    }
  } catch (err) {}
}

// === Analyze ===

analyzeBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (!url) return;

  currentVideoUrl = url;

  const btnText = analyzeBtn.querySelector('.btn-text');
  const spinner = analyzeBtn.querySelector('.spinner');
  btnText.classList.add('hidden');
  spinner.classList.remove('hidden');
  analyzeBtn.disabled = true;

  try {
    if (!chrome.cookies) {
      throw new Error("⚠️ Vui lòng tải lại Extension (mũi tên xoay tròn) trong chrome://extensions/ để áp dụng bản cập nhật!");
    }

    const cookies = await chrome.cookies.getAll({ domain: '.youtube.com' });
    let cookieStr = '';
    if (cookies && cookies.length > 0) {
      cookieStr = '# Netscape HTTP Cookie File\n';
      cookies.forEach(c => {
        const includeSubdomains = c.domain.startsWith('.') ? 'TRUE' : 'FALSE';
        const secure = c.secure ? 'TRUE' : 'FALSE';
        const expiry = c.expirationDate ? Math.floor(c.expirationDate) : 0;
        cookieStr += `${c.domain}\t${includeSubdomains}\t${c.path}\t${secure}\t${expiry}\t${c.name}\t${c.value}\n`;
      });
    }

    const res = await fetch(`${API_URL}/api/formats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url, cookies: cookieStr })
    });
    
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || 'Không thể phân tích video do lỗi Server');
    }

    videoTitle.textContent = data.title || 'Video không tên';
    videoThumb.src = data.thumbnail || '';
    videoDuration.textContent = formatDuration(data.duration);
    videoPlatform.textContent = detectPlatform(url);
    currentProxyUrl = data.usedProxy || null;

    // Populate quality — hiển thị TẤT CẢ format có video
    qualitySelect.innerHTML = '<option value="best">⚡ Tốt nhất (tự chọn)</option>';
    if (data.formats) {
      const videoFormats = data.formats
        .filter((f) => {
          if (!f.resolution || f.resolution === 'audio only') return false;
          if (f.vcodec === 'none') return false;
          if (data.usedFallback) return true; // Hiển thị tất cả nếu dùng fallback
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

        // Label: resolution + codec + size + fps
        let label = '';
        if (f.height >= 2160) label = `4K ${f.height}p`;
        else if (f.height >= 1440) label = `2K ${f.height}p`;
        else if (f.height >= 1080) label = `FHD ${f.height}p`;
        else if (f.height >= 720) label = `HD ${f.height}p`;
        else label = `${f.height}p`;

        // Codec
        const codec = f.vcodec || '';
        if (codec.startsWith('avc') || codec.startsWith('h264')) label += ' • H.264';
        else if (codec.startsWith('hev') || codec.startsWith('h265') || codec.startsWith('hvc')) label += ' • H.265';
        else if (codec.startsWith('vp9') || codec.startsWith('vp09')) label += ' • VP9';
        else if (codec.startsWith('av01')) label += ' • AV1';
        else if (codec !== 'none') label += ` • ${codec.split('.')[0]}`;

        // FPS
        if (f.fps && f.fps > 30) label += ` • ${f.fps}fps`;

        // Ext
        if (f.ext) label += ` • .${f.ext}`;

        // Size
        if (f.filesize) {
          const mb = f.filesize / (1024 * 1024);
          label += mb >= 1024 ? ` • ${(mb / 1024).toFixed(1)} GB` : ` • ${mb.toFixed(0)} MB`;
        }

        opt.textContent = label;
        qualitySelect.appendChild(opt);
      });
    }

    videoInfoCard.classList.remove('hidden');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    btnText.classList.remove('hidden');
    spinner.classList.add('hidden');
    analyzeBtn.disabled = false;
  }
});

function detectPlatform(url) {
  if (/youtube\.com|youtu\.be/.test(url)) return 'YouTube';
  if (/tiktok\.com/.test(url)) return 'TikTok';
  if (/facebook\.com|fb\.watch/.test(url)) return 'Facebook';
  if (/instagram\.com/.test(url)) return 'Instagram';
  if (/twitter\.com|x\.com/.test(url)) return 'X (Twitter)';
  if (/vimeo\.com/.test(url)) return 'Vimeo';
  if (/dailymotion\.com/.test(url)) return 'Dailymotion';
  if (/bilibili\.com/.test(url)) return 'Bilibili';
  try { return new URL(url).hostname; } catch { return 'Video'; }
}

// === Download ===

downloadBtn.addEventListener('click', async () => {
  if (!currentVideoUrl) return;

  downloadBtn.disabled = true;
  downloadBtn.textContent = 'Đang bắt đầu...';

  try {
    const selectedVal = qualitySelect.value;
    const body = {
      url: currentVideoUrl,
      codec: formatSelect.value,
      keepOriginalRes: keepResToggle.checked,
      proxy: currentProxyUrl
    };

    // Nếu chọn format cụ thể → gửi formatId, nếu "best" → gửi quality
    if (selectedVal === 'best') {
      body.quality = 'best';
    } else {
      body.formatId = selectedVal;
    }

    const cookies = await chrome.cookies.getAll({ domain: '.youtube.com' });
    let cookieStr = '';
    if (cookies && cookies.length > 0) {
      cookieStr = '# Netscape HTTP Cookie File\n';
      cookies.forEach(c => {
        const includeSubdomains = c.domain.startsWith('.') ? 'TRUE' : 'FALSE';
        const secure = c.secure ? 'TRUE' : 'FALSE';
        const expiry = c.expirationDate ? Math.floor(c.expirationDate) : 0;
        cookieStr += `${c.domain}\t${includeSubdomains}\t${c.path}\t${secure}\t${expiry}\t${c.name}\t${c.value}\n`;
      });
    }
    body.cookies = cookieStr;

    const res = await fetch(`${API_URL}/api/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error('Lỗi tạo tác vụ');

    const data = await res.json();

    chrome.runtime.sendMessage({
      action: 'startSSE',
      taskId: data.taskId,
      title: videoTitle.textContent
    });

    videoInfoCard.classList.add('hidden');
    urlInput.value = '';
    currentVideoUrl = '';
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    downloadBtn.disabled = false;
    downloadBtn.textContent = 'Tải xuống & Chuyển đổi';
  }
});

// === UI Helpers ===

function formatDuration(seconds) {
  if (!seconds) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function showToast(message, type = 'info') {
  // Simple inline toast
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.style.cssText = `
    position: fixed; bottom: 16px; left: 16px; right: 16px;
    padding: 12px 16px; border-radius: 8px; font-size: 13px;
    z-index: 999; animation: fadeIn 0.2s ease;
    background: ${type === 'error' ? 'rgba(239,68,68,0.9)' : 'rgba(59,130,246,0.9)'};
    color: white; backdrop-filter: blur(8px);
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

pasteBtn.onclick = async () => {
  try {
    const text = await navigator.clipboard.readText();
    urlInput.value = text;
  } catch (e) {
    console.error('Failed to read clipboard', e);
  }
};

copyCmdBtn.onclick = () => {
  navigator.clipboard.writeText(offlineCmd.textContent);
  copyCmdBtn.textContent = 'Đã copy!';
  setTimeout(() => (copyCmdBtn.textContent = 'Copy'), 2000);
};

retryBtn.onclick = async () => {
  // Thử khởi động lại server qua native messaging
  chrome.runtime.sendMessage({ action: 'startServer' });
  await waitForServer();
  if (serverStatus.classList.contains('online')) {
    loadDetectedUrl();
  }
};

// === Render Tasks ===

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.activeTasks) {
    renderTasks(changes.activeTasks.newValue || {});
  }
});

function renderTasks(tasks) {
  const taskIds = Object.keys(tasks);
  if (taskIds.length === 0) {
    taskList.innerHTML = '<div class="empty-state">Chưa có tác vụ nào</div>';
    return;
  }

  // Xóa task không còn tồn tại
  taskList.querySelectorAll('.task-item').forEach((el) => {
    if (!tasks[el.dataset.taskId]) el.remove();
  });

  // Xóa empty state nếu có
  const emptyState = taskList.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  // Sắp xếp: mới nhất lên đầu
  taskIds.sort((a, b) => {
    const tA = tasks[a].createdAt || 0;
    const tB = tasks[b].createdAt || 0;
    return tB - tA;
  });

  taskIds.forEach((id, index) => {
    const t = tasks[id];
    const pct = Math.min(t.progress || 0, 100);
    const logs = t.logs || [];
    const lastLog = logs.length > 0 ? logs[logs.length - 1] : '';

    let stageText = 'Đang chờ...';
    let stageType = '';
    const fmt = t.format ? t.format.replace('.','').toUpperCase() : '';
    if (t.status === 'downloading') { stageText = 'Đang tải...'; stageType = 'downloading'; }
    else if (t.status === 'converting' && t.stage === 'remux') { stageText = '⚡ Đóng gói MP4 (siêu tốc)...'; stageType = 'converting'; }
    else if (t.status === 'converting') { stageText = fmt ? `Đang chuyển đổi ${fmt} → MP4...` : 'Đang chuyển đổi...'; stageType = 'converting'; }
    else if (t.status === 'done') { const outExt = t.outputPath ? t.outputPath.split('.').pop().toUpperCase() : 'MP4'; stageText = `✅ Hoàn tất (${outExt})`; stageType = 'done'; }
    else if (t.status === 'error') { stageText = '❌ Lỗi'; stageType = 'error'; }
    else if (t.status === 'paused') { stageText = '⏸️ Tạm dừng'; stageType = 'paused'; }

    // Tìm element đã có hoặc tạo mới
    let el = taskList.querySelector(`.task-item[data-task-id="${id}"]`);
    let isNew = false;

    if (!el) {
      isNew = true;
      el = document.createElement('div');
      el.className = 'task-item';
      el.dataset.taskId = id;
      el.innerHTML = `
        <div class="task-header">
          <div class="task-title" title="${escapeHtml(t.title || '')}">${escapeHtml(t.title || 'Video')}</div>
          <button class="task-action" data-id="${id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="task-meta">
          <span class="task-stage-el task-stage"></span>
          <span class="task-pct-el"></span>
        </div>
        <div class="progress-track">
          <div class="progress-fill"></div>
        </div>
        <div class="task-last-log"></div>
        <div class="task-error"></div>
        <details class="task-log-details">
          <summary></summary>
          <div class="task-log-content"></div>
        </details>
      `;

      const actionBtn = el.querySelector('.task-action');
      actionBtn.onclick = async () => {
        try {
          await fetch(`${API_URL}/api/cancel/${id}`, { method: 'DELETE' });
          chrome.runtime.sendMessage({ action: 'stopSSE', taskId: id });
        } catch (e) {}
      };

      // Chèn vào đúng vị trí (mới nhất lên đầu)
      const existingItems = taskList.querySelectorAll('.task-item');
      if (index < existingItems.length) {
        taskList.insertBefore(el, existingItems[index]);
      } else {
        taskList.appendChild(el);
      }
    }

    // === Update chỉ phần thay đổi (không rebuild DOM) ===

    // Progress bar
    const fill = el.querySelector('.progress-fill');
    fill.style.width = pct + '%';
    fill.className = 'progress-fill' + (stageType === 'converting' ? ' converting' : stageType === 'done' ? ' done' : stageType === 'error' ? ' error' : stageType === 'paused' ? ' paused' : '');

    // Percentage text
    const pctEl = el.querySelector('.task-pct-el');
    pctEl.textContent = pct.toFixed(1) + '%';

    // Stage text
    const stageEl = el.querySelector('.task-stage-el');
    stageEl.textContent = stageText;
    stageEl.className = 'task-stage-el task-stage' + (stageType ? ' ' + stageType : '');

    // Action button + Pause/Resume
    const actionBtn = el.querySelector('.task-action');

    // Thêm nút pause/resume nếu chưa có
    let pauseBtn = el.querySelector('.task-pause');
    if (!pauseBtn) {
      pauseBtn = document.createElement('button');
      pauseBtn.className = 'task-pause';
      actionBtn.parentElement.insertBefore(pauseBtn, actionBtn);
    }

    if (t.status === 'done') {
      pauseBtn.style.display = 'none';
      actionBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" width="16" height="16"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>';
      actionBtn.title = 'Mở thư mục';
      actionBtn.onclick = async () => {
        try { await fetch('http://localhost:3847/api/open-folder', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ path: t.outputPath }) }); } catch(e) {}
      };
    } else if (t.status === 'error') {
      pauseBtn.style.display = 'none';
      actionBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>';
      actionBtn.title = 'Thử lại';
      actionBtn.onclick = async () => {
        try { 
          await fetch(`http://localhost:3847/api/retry/${id}`, { method: 'POST' }); 
          chrome.runtime.sendMessage({ action: 'startSSE', taskId: id, title: t.title });
        } catch(e) {}
      };
    } else if (t.status === 'paused') {
      // Nút Resume (play)
      pauseBtn.style.display = '';
      pauseBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="#22c55e" width="16" height="16"><polygon points="5,3 19,12 5,21"/></svg>';
      pauseBtn.title = 'Tiếp tục';
      pauseBtn.onclick = async () => {
        try { 
          await fetch(`http://localhost:3847/api/resume/${id}`, { method: 'POST' }); 
          chrome.runtime.sendMessage({ action: 'startSSE', taskId: id, title: t.title });
        } catch(e) {}
      };
      // Nút Hủy
      actionBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>';
      actionBtn.title = 'Hủy';
      actionBtn.onclick = async () => {
        try {
          await fetch(`${API_URL}/api/cancel/${id}`, { method: 'DELETE' });
          chrome.runtime.sendMessage({ action: 'stopSSE', taskId: id });
        } catch (e) {}
      };
    } else {
      // Đang pending / downloading / converting -> Nút Pause + Hủy
      if (t.status === 'downloading' || t.status === 'converting') {
        pauseBtn.style.display = '';
        pauseBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="#f59e0b" width="16" height="16"><rect x="5" y="4" width="4" height="16"/><rect x="15" y="4" width="4" height="16"/></svg>';
        pauseBtn.title = 'Tạm dừng';
        pauseBtn.onclick = async () => {
          try { await fetch(`http://localhost:3847/api/pause/${id}`, { method: 'POST' }); } catch(e) {}
        };
      } else {
        pauseBtn.style.display = 'none';
      }
      actionBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>';
      actionBtn.title = 'Hủy';
      actionBtn.onclick = async () => {
        try {
          await fetch(`${API_URL}/api/cancel/${id}`, { method: 'DELETE' });
          chrome.runtime.sendMessage({ action: 'stopSSE', taskId: id });
        } catch (e) {}
      };
    }

    // Last log line
    const lastLogEl = el.querySelector('.task-last-log');
    if (lastLog) {
      lastLogEl.textContent = lastLog;
      lastLogEl.style.display = '';
    } else {
      lastLogEl.style.display = 'none';
    }

    // Error message
    const errorEl = el.querySelector('.task-error');
    if (t.status === 'error' && t.error) {
      errorEl.textContent = t.error;
      errorEl.style.display = '';
    } else {
      errorEl.style.display = 'none';
    }

    // Log details
    const details = el.querySelector('.task-log-details');
    if (logs.length > 1) {
      details.style.display = '';
      details.querySelector('summary').textContent = `Xem log (${logs.length})`;
      const logContent = details.querySelector('.task-log-content');
      logContent.innerHTML = logs.map((l) => `<div class="task-log-line">${escapeHtml(l)}</div>`).join('');
      logContent.scrollTop = logContent.scrollHeight;
    } else {
      details.style.display = 'none';
    }
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// === Tab Change Listener (Side Panel stays open, update detected URL on tab change) ===

chrome.tabs.onActivated.addListener(async () => {
  loadDetectedUrl();
});

// === Init ===

async function loadSettings() {
  if (!outputDirInput) return;
  try {
    const res = await fetch(`${API_URL}/api/settings`);
    if (res.ok) {
      const data = await res.json();
      if (data.outputDir) {
        outputDirInput.value = data.outputDir;
      }
    }
  } catch(e) {}
}

if (changeFolderBtn && outputDirInput) {
  changeFolderBtn.onclick = () => {
    if (outputDirInput.hasAttribute('readonly')) {
      // Bật chế độ chỉnh sửa
      outputDirInput.removeAttribute('readonly');
      outputDirInput.style.opacity = '1';
      outputDirInput.style.borderColor = 'var(--accent-blue)';
      outputDirInput.focus();
      outputDirInput.select();
      changeFolderBtn.textContent = '💾';
      changeFolderBtn.title = 'Lưu';
    } else {
      // Lưu
      saveOutputDir();
    }
  };

  const saveOutputDir = async () => {
    const val = outputDirInput.value.trim();
    if (!val) {
      showToast('Vui lòng nhập đường dẫn thư mục', 'error');
      return;
    }
    outputDirInput.setAttribute('readonly', 'true');
    outputDirInput.style.borderColor = '';
    changeFolderBtn.textContent = '✏️';
    changeFolderBtn.title = 'Thay đổi';
    try {
      const res = await fetch(`${API_URL}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outputDir: val })
      });
      if (res.ok) showToast('Đã đổi thư mục lưu', 'info');
      else showToast('Lỗi lưu thư mục', 'error');
    } catch(e) {
      showToast('Lỗi kết nối server', 'error');
    }
  };

  outputDirInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveOutputDir();
    if (e.key === 'Escape') {
      outputDirInput.setAttribute('readonly', 'true');
      outputDirInput.style.borderColor = '';
      changeFolderBtn.textContent = '✏️';
      loadSettings(); // Reset về giá trị cũ
    }
  });
}

async function runSetupCheck() {
  try {
    const res = await fetch(`${API_URL}/api/check-tools`);
    if (!res.ok) return;
    const data = await res.json();
    
    const tools = data.tools || (Array.isArray(data) ? data : []);
    const missingTools = tools.filter(t => !t.installed);
    
    if (missingTools.length === 0) {
      setupScreen.classList.add('hidden');
      loadSettings();
      return;
    }
    
    mainContent.classList.add('hidden');
    document.querySelector('.header').classList.add('hidden');
    setupScreen.classList.remove('hidden');
    
    toolsList.innerHTML = '';
    tools.forEach(tool => {
      const item = document.createElement('div');
      item.className = 'tool-item';
      item.innerHTML = `
        <div class="tool-name">${tool.name}</div>
        <div class="tool-status ${tool.installed ? 'installed' : 'missing'}">
          ${tool.installed ? '✅ ' + (tool.version || '') : '❌ Thiếu'}
        </div>
      `;
      toolsList.appendChild(item);
    });
    
    installAllBtn.classList.remove('hidden');
    installAllBtn.onclick = async () => {
      installAllBtn.disabled = true;
      installAllBtn.textContent = 'Đang cài đặt...';
      for (const tool of missingTools) {
        setupStatus.textContent = `Đang cài đặt ${tool.name}...`;
        try {
          await fetch(`${API_URL}/api/install-tool`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ tool: tool.name })
          });
        } catch(e) {}
      }
      setupStatus.textContent = 'Đã cài đặt xong.';
      setupScreen.classList.add('hidden');
      document.querySelector('.header').classList.remove('hidden');
      mainContent.classList.remove('hidden');
      loadSettings();
    };
  } catch (e) {
    console.error(e);
  }
}

(async () => {
  const isOnline = await checkServer();

  if (isOnline) {
    setServerState('online');
    await runSetupCheck();
    loadDetectedUrl();
  } else {
    // Server chưa sẵn sàng, đợi native host khởi động nó
    const serverReady = await waitForServer();
    if (serverReady) {
      await runSetupCheck();
      loadDetectedUrl();
    }
  }

  // Load existing tasks
  chrome.storage.local.get(['activeTasks'], (res) => {
    renderTasks(res.activeTasks || {});
  });
})();

document.getElementById('clearCompletedBtn')?.addEventListener('click', async () => {
  try {
    await fetch(`${API_URL}/api/clear-completed`, { method: 'DELETE' });
    
    // Xóa cả ở chrome.storage.local
    chrome.storage.local.get(['activeTasks'], (res) => {
      const tasks = res.activeTasks || {};
      const remaining = {};
      for (const [id, t] of Object.entries(tasks)) {
        if (t.status !== 'done') {
          remaining[id] = t;
        }
      }
      chrome.storage.local.set({ activeTasks: remaining }, () => {
        // Xóa DOM ngay lập tức
        const taskList = document.getElementById('taskList');
        taskList.querySelectorAll('.task-item').forEach((el) => {
          const tid = el.dataset.taskId;
          if (!remaining[tid]) el.remove();
        });
        if (taskList.children.length === 0) {
          taskList.innerHTML = '<div class="empty-state">Chưa có tác vụ nào</div>';
        }
      });
    });
  } catch (e) {
    console.error('Lỗi khi xóa tasks hoàn tất:', e);
  }
});

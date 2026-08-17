// background/service-worker.js

const API_URL = 'http://localhost:3847';
const NATIVE_HOST_NAME = 'com.video_downloader.server';
const WATCHDOG_ALARM = 'vd-server-watchdog';
const CONNECT_TIMEOUT_MS = 40000; // host.js chờ server tối đa ~30s ở lần chạy đầu

const sseConnections = new Map();
let nativePort = null;
let serverStarting = false;
let startingTimer = null;

// === Side Panel: mở khi click icon extension ===
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('sidePanel error:', err));

// === Native Messaging: tự khởi động server ===

function clearStartingFlag() {
  serverStarting = false;
  if (startingTimer !== null) {
    clearTimeout(startingTimer);
    startingTimer = null;
  }
}

function connectNativeHost() {
  if (nativePort || serverStarting) return;
  serverStarting = true;

  // Nếu native host treo mà không trả lời cũng không ngắt kết nối, cờ này phải
  // được gỡ ra, nếu không mọi lần thử sau đều bị chặn vĩnh viễn.
  startingTimer = setTimeout(() => {
    console.warn('[NativeHost] Qua han cho phan hoi, mo khoa de thu lai');
    serverStarting = false;
    startingTimer = null;
  }, CONNECT_TIMEOUT_MS);

  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);

    nativePort.onMessage.addListener((msg) => {
      console.log('[NativeHost]', msg);
      if (msg.type === 'status') {
        clearStartingFlag();
        chrome.storage.local.set({
          serverStatus: msg.status,
          serverErrorLog: msg.errorLog || '',
          serverMissingTools: msg.missingTools || [],
          serverCheckedAt: Date.now()
        });

        // Đã nhận kết quả thì thả native host ra cho nó thoát;
        // server chạy nền (detached) nên không chết theo.
        try { nativePort.disconnect(); } catch (e) {}
        nativePort = null;
      }
    });

    nativePort.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError;
      if (error) {
        console.warn('[NativeHost] Disconnected:', error.message);
        // Lỗi phổ biến: "Specified native messaging host not found"
        // => chưa chạy setup.bat trên máy này.
        chrome.storage.local.set({
          serverStatus: 'host_missing',
          serverErrorLog: error.message
        });
      }
      nativePort = null;
      clearStartingFlag();
    });

  } catch (err) {
    console.error('[NativeHost] Connection failed:', err);
    nativePort = null;
    clearStartingFlag();
  }
}

// === Watchdog: bảo đảm server luôn sống ===

async function isServerUp() {
  try {
    const res = await fetch(`${API_URL}/api/health`, {
      signal: AbortSignal.timeout(1500)
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.status === 'ok' || data.status === 'installing';
  } catch (e) {
    return false;
  }
}

/** Chỉ gọi native host khi server thực sự chưa chạy */
async function ensureServerRunning(reason) {
  if (await isServerUp()) {
    chrome.storage.local.set({ serverStatus: 'running', serverCheckedAt: Date.now() });
    return true;
  }
  console.log(`[Watchdog] Server chua chay (${reason}) -> goi native host`);
  connectNativeHost();
  return false;
}

async function installWatchdog() {
  // Alarm đánh thức service worker kể cả khi nó đã bị Chrome tắt (MV3),
  // nên server được kiểm tra đều đặn suốt phiên duyệt web.
  //
  // Phải kiểm tra trước khi tạo: alarms.create với cùng tên sẽ GHI ĐÈ alarm cũ
  // và đặt lại bộ đếm. Hàm này chạy mỗi lần service worker thức dậy, nên nếu
  // tạo vô điều kiện thì alarm bị dời liên tục và không bao giờ kêu.
  const existing = await chrome.alarms.get(WATCHDOG_ALARM);
  if (!existing) {
    chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 1, delayInMinutes: 1 });
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WATCHDOG_ALARM) {
    ensureServerRunning('watchdog');
  }
});

// Khởi động server khi trình duyệt mở
chrome.runtime.onStartup.addListener(() => {
  installWatchdog();
  ensureServerRunning('browser startup');
});

// Khi extension được cài / cập nhật / reload
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ activeTasks: {}, serverStatus: 'checking' });
  installWatchdog();
  ensureServerRunning('installed');
});

// Mỗi lần service worker được đánh thức (click icon, mở tab video, alarm...)
installWatchdog();
ensureServerRunning('service worker activate');

// === Message Handlers ===

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startSSE') {
    startListeningToTask(request.taskId, request.title);
    sendResponse({ success: true });
  } else if (request.action === 'stopSSE') {
    stopListeningToTask(request.taskId);
    sendResponse({ success: true });
  } else if (request.action === 'startServer') {
    ensureServerRunning('popup retry');
    sendResponse({ success: true });
  } else if (request.action === 'getActiveTasks') {
    chrome.storage.local.get(['activeTasks'], (res) => {
      sendResponse(res.activeTasks || {});
    });
    return true;

  // === Content Script: lấy danh sách formats ===
  } else if (request.action === 'fetchFormats') {
    if (!chrome.cookies) {
      sendResponse({ error: '⚠️ Vui lòng tải lại Extension (mũi tên xoay tròn) trong chrome://extensions/ để áp dụng bản cập nhật!' });
      return true;
    }

    chrome.cookies.getAll({ domain: '.youtube.com' }, (cookies) => {
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

      fetch(`${API_URL}/api/formats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: request.url, cookies: cookieStr })
      })
        .then((res) => {
          if (!res.ok) throw new Error('Server error');
          return res.json();
        })
        .then((data) => sendResponse(data))
        .catch((err) => sendResponse({ error: err.message }));
    });
    return true;

  // === Content Script: bắt đầu download ===
  } else if (request.action === 'startDownload') {
    if (!chrome.cookies) {
      sendResponse({ error: '⚠️ Vui lòng tải lại Extension (mũi tên xoay tròn) trong chrome://extensions/ để áp dụng bản cập nhật!' });
      return true;
    }

    const body = {
      url: request.url,
      codec: request.codec || 'h264',
      keepOriginalRes: request.keepOriginalRes !== false,
      proxy: request.proxy
    };

    if (request.formatId) {
      body.formatId = request.formatId;
    } else {
      const qualityMap = { '2160': 'best4k', '1440': 'best1440', '1080': 'best1080', '720': 'best1080', 'best': 'best' };
      body.quality = qualityMap[request.quality] || request.quality || 'best';
    }

    chrome.cookies.getAll({ domain: '.youtube.com' }, (cookies) => {
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

      fetch(`${API_URL}/api/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then((res) => {
          if (!res.ok) throw new Error('Server error');
          return res.json();
        })
        .then((data) => {
          if (data.taskId) {
            startListeningToTask(data.taskId, request.title || 'Video download');
          }
          sendResponse(data);
        })
        .catch((err) => sendResponse({ error: err.message }));
    });
    return true;
  }
  return true;
});

// === SSE Task Tracking ===

async function startListeningToTask(taskId, title) {
  if (sseConnections.has(taskId)) return;

  // Lưu task vào storage
  let { activeTasks } = await chrome.storage.local.get(['activeTasks']);
  if (!activeTasks) activeTasks = {};
  activeTasks[taskId] = { id: taskId, title, status: 'downloading', progress: 0, createdAt: Date.now() };
  await chrome.storage.local.set({ activeTasks });
  updateBadge();

  try {
    const abortController = new AbortController();
    sseConnections.set(taskId, abortController);

    const response = await fetch(`${API_URL}/api/status/${taskId}`, {
      signal: abortController.signal
    });

    if (!response.ok) throw new Error('Failed to connect to SSE');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.substring(6));
            await handleTaskUpdate(taskId, data);
          } catch (e) {
            console.error('Error parsing SSE data', e);
          }
        }
      }
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('SSE connection error:', error);
      await handleTaskUpdate(taskId, { status: 'error', error: 'Mất kết nối server' });
    }
  } finally {
    sseConnections.delete(taskId);
    updateBadge();
  }
}

function stopListeningToTask(taskId) {
  if (sseConnections.has(taskId)) {
    sseConnections.get(taskId).abort();
    sseConnections.delete(taskId);
  }
  chrome.storage.local.get(['activeTasks'], (res) => {
    const tasks = res.activeTasks || {};
    if (tasks[taskId]) {
      delete tasks[taskId];
      chrome.storage.local.set({ activeTasks: tasks });
      updateBadge();
    }
  });
}

async function handleTaskUpdate(taskId, data) {
  let { activeTasks } = await chrome.storage.local.get(['activeTasks']);
  if (!activeTasks) activeTasks = {};
  if (!activeTasks[taskId]) return;

  const task = activeTasks[taskId];

  if (data.status) task.status = data.status;
  if (data.progress !== undefined) task.progress = data.progress;
  if (data.stage) task.stage = data.stage;
  if (data.error) task.error = data.error;
  if (data.outputPath) task.outputPath = data.outputPath;
  if (data.logs) task.logs = data.logs;

  await chrome.storage.local.set({ activeTasks });
  updateBadge();

  if (task.status === 'done' || task.status === 'error') {
    sseConnections.get(taskId)?.abort();
    sseConnections.delete(taskId);

    if (task.status === 'done') {
      chrome.notifications.create(`done-${taskId}`, {
        type: 'basic',
        iconUrl: '../icons/icon128.png',
        title: '✅ Tải xuống hoàn tất',
        message: `Đã hoàn thành: ${task.title}`
      });
    } else {
      chrome.notifications.create(`error-${taskId}`, {
        type: 'basic',
        iconUrl: '../icons/icon128.png',
        title: '❌ Lỗi tải xuống',
        message: `${task.title}: ${task.error || 'Lỗi không xác định'}`
      });
    }
  }
}

async function updateBadge() {
  const { activeTasks } = await chrome.storage.local.get(['activeTasks']);
  if (!activeTasks) return;

  const activeCount = Object.values(activeTasks).filter(
    (t) => t.status === 'downloading' || t.status === 'converting'
  ).length;

  if (activeCount > 0) {
    chrome.action.setBadgeText({ text: activeCount.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// service-worker.js - VERSION 4.1 (WITH GOOGLE SHEETS INTEGRATION)

// ==================== CẤU HÌNH GOOGLE SHEETS ====================
const GOOGLE_CONFIG = {
  API_KEY: 'AIzaSyD757jS4SLR7-EzrPgrW9WrLQeD2DQExHw',
  SHEET_ID: '1Z59pDBu_tGwlYqUeS1-VJLpcHozp7LbxnC_-qhT3iHs',
  RANGE: 'Tu_Dien!A2:F',
  
  // Tự động tạo URL từ cấu hình
  get SHEETS_URL() {
    return `https://sheets.googleapis.com/v4/spreadsheets/${this.SHEET_ID}/values/${this.RANGE}?key=${this.API_KEY}`;
  },
  
  // Apps Script URL cho ghi dữ liệu
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbz9XYdorp6vsKFTCrqx2tUSJGecpOmCbrROqKfkHYSFn2WXieQtJXWCQvSJvxCk6yrs/exec'
};

// ==================== CẤU HÌNH CACHE ====================
const APP_VERSION = '4.1.0';
const CACHE_NAMES = {
  app: `tudien-xodang-v${APP_VERSION}`,
  fonts: 'fonts-v2',
  audio: 'audio-v2',
  data: 'sheets-data-v2'  // Cache riêng cho Google Sheets data
};


// ==================== FILE CẦN CACHE ====================
const STATIC_FILES = [
  './',
  './index.html',
  './game.html',
  './intro.html',
  './offline.html',
  './manifest.json',
  './favicon.png',
  './badge-72x72.png',
  
  // Tất cả icon bạn có
  './icon-48x48.png',
  './icon-72x72.png',
  './icon-96x96.png',
  './icon-128x128.png',
  './icon-144x144.png',
  './icon-152x152.png',
  './icon-192x192.png',
  './icon-256x256.png',
  './icon-384x384.png',
  './icon-512x512.png'
];

const FONT_FILES = [
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap'
];

// ==================== SERVICE WORKER LIFE CYCLE ====================

self.addEventListener('install', (event) => {
  console.log('📦 Service Worker installing v' + APP_VERSION);
  
  event.waitUntil(
    Promise.all([
      cacheStaticFiles(),
      cacheGoogleSheetsData()  // Cache data từ Google Sheets ngay khi install
    ]).then(() => {
      console.log('✅ Tất cả resources đã được cache');
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  console.log('🔄 Service Worker activating v' + APP_VERSION);
  
  event.waitUntil(
    Promise.all([
      cleanupOldCaches(),
      initIndexedDB(),
      self.clients.claim()
    ]).then(() => {
      console.log('✅ Service Worker ready');
      notifyClients('SW_ACTIVATED', { version: APP_VERSION });
    })
  );
});

// ==================== CACHE FUNCTIONS ====================

async function cacheStaticFiles() {
  const cache = await caches.open(CACHE_NAMES.app);
  
  return Promise.all(
    STATIC_FILES.map(url => 
      cache.add(url).catch(err => 
        console.log('⚠️ Không cache được:', url, err.message)
      )
    )
  );
}

// QUAN TRỌNG: Cache dữ liệu từ Google Sheets
async function cacheGoogleSheetsData() {
  try {
    const sheetsUrl = GOOGLE_CONFIG.SHEETS_URL;
    console.log('📊 Đang cache dữ liệu Google Sheets từ:', sheetsUrl);
    
    // Fetch dữ liệu từ Google Sheets API
    const response = await fetch(sheetsUrl);
    
    if (!response.ok) {
      throw new Error(`Google Sheets API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Mở cache cho dữ liệu
    const dataCache = await caches.open(CACHE_NAMES.data);
    
    // Tạo request object cho caching
    const request = new Request(sheetsUrl, {
      headers: new Headers({
        'Accept': 'application/json'
      })
    });
    
    // Tạo response với dữ liệu đã fetch
    const cacheResponse = new Response(JSON.stringify(data), {
      status: 200,
      statusText: 'OK',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'max-age=3600', // Cache 1 giờ
        'X-Cached-At': new Date().toISOString()
      }
    });
    
    // Lưu vào cache
    await dataCache.put(request, cacheResponse);
    
    console.log('✅ Đã cache dữ liệu Google Sheets:', data.values?.length || 0, 'dòng');
    
    // Đồng thời lưu vào IndexedDB để truy cập nhanh
    await saveToIndexedDB(data);
    
  } catch (error) {
    console.error('❌ Không thể cache Google Sheets data:', error);
    // Không throw error để không làm hỏng quá trình install
  }
}

// ==================== FETCH HANDLER ====================

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const request = event.request;
  
  // Bỏ qua non-GET
  if (request.method !== 'GET') return;
  
  // 1. Google Sheets API Request
  if (url.hostname === 'sheets.googleapis.com' && 
      url.pathname.includes(GOOGLE_CONFIG.SHEET_ID)) {
    event.respondWith(handleSheetsRequest(request));
    return;
  }
  
  // 2. Apps Script Request (ghi dữ liệu)
  if (url.hostname.includes('script.google.com')) {
    event.respondWith(handleAppsScriptRequest(request));
    return;
  }
  
  // 3. Navigation requests
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request));
    return;
  }
  
  // 4. Default: Cache First, Network Fallback
  event.respondWith(handleDefaultRequest(request));
});

// ==================== GOOGLE SHEETS REQUEST HANDLER ====================

async function handleSheetsRequest(request) {
  const url = new URL(request.url);
  const cacheKey = GOOGLE_CONFIG.SHEETS_URL; // Dùng URL đầy đủ làm cache key
  
  console.log('📊 Google Sheets request:', url.pathname);
  
  try {
    // Chiến lược: Stale-While-Revalidate
    // 1. Trả về cached data ngay lập tức (nếu có)
    // 2. Đồng thời fetch data mới và cập nhật cache
    
    const dataCache = await caches.open(CACHE_NAMES.data);
    
    // Kiểm tra cache
    const cachedResponse = await dataCache.match(cacheKey);
    
    if (cachedResponse) {
      console.log('📥 Trả về cached Google Sheets data');
      
      // Bắt đầu fetch dữ liệu mới ở background
      updateSheetsDataInBackground(cacheKey);
      
      return cachedResponse;
    }
    
    // Nếu không có cache, fetch từ network
    console.log('🌐 Fetching Google Sheets data từ network');
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      // Clone response để cache và trả về
      const responseToCache = networkResponse.clone();
      await dataCache.put(cacheKey, responseToCache);
      
      // Lưu vào IndexedDB
      const data = await networkResponse.json();
      await saveToIndexedDB(data);
      
      return networkResponse;
    } else {
      throw new Error(`Google Sheets fetch failed: ${networkResponse.status}`);
    }
    
  } catch (error) {
    console.error('❌ Google Sheets fetch error:', error);
    
    // Fallback: trả về empty data structure
    return new Response(
      JSON.stringify({
        error: 'offline',
        message: 'Dữ liệu không khả dụng offline',
        cached: true,
        values: []
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Cache': 'FALLBACK'
        }
      }
    );
  }
}

async function updateSheetsDataInBackground(cacheKey) {
  try {
    const response = await fetch(GOOGLE_CONFIG.SHEETS_URL);
    
    if (response.ok) {
      const dataCache = await caches.open(CACHE_NAMES.data);
      await dataCache.put(cacheKey, response.clone());
      
      const data = await response.json();
      await saveToIndexedDB(data);
      
      console.log('🔄 Đã cập nhật Google Sheets data trong background');
      
      // Thông báo cho clients về data mới
      notifyClients('DATA_UPDATED', { 
        count: data.values?.length || 0,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    // Không cần xử lý error trong background update
    console.log('⚠️ Background update failed (có thể đang offline)');
  }
}

// ==================== APPS SCRIPT REQUEST HANDLER ====================

async function handleAppsScriptRequest(request) {
  // Đây là request để ghi dữ liệu lên Google Sheets
  // Chiến lược: Network First, offline queue
  
  try {
    // Thử gửi request ngay
    const response = await fetch(request);
    
    if (response.ok) {
      console.log('✅ Apps Script request thành công');
      return response;
    } else {
      throw new Error(`Apps Script error: ${response.status}`);
    }
    
  } catch (error) {
    console.log('📴 Offline, lưu request vào queue');
    
    // Lưu request vào IndexedDB để sync sau
    await queueRequestForSync(request);
    
    return new Response(
      JSON.stringify({
        success: false,
        message: 'Đang offline, dữ liệu sẽ được đồng bộ khi có mạng',
        queued: true,
        timestamp: new Date().toISOString()
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Offline': 'true'
        }
      }
    );
  }
}

// ==================== INDEXEDDB FUNCTIONS ====================

async function initIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('TudienXoDangDB', 4);
    
    request.onerror = (event) => {
      console.error('❌ IndexedDB error:', event.target.error);
      resolve(); // Không reject để không làm hỏng activation
    };
    
    request.onsuccess = (event) => {
      console.log('✅ IndexedDB initialized');
      resolve(event.target.result);
    };
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Store cho từ điển
      if (!db.objectStoreNames.contains('vocabulary')) {
        const store = db.createObjectStore('vocabulary', {
          keyPath: 'id',
          autoIncrement: true
        });
        store.createIndex('word', 'word', { unique: true });
        store.createIndex('timestamp', 'timestamp');
      }
      
      // Store cho pending requests
      if (!db.objectStoreNames.contains('pendingRequests')) {
        const store = db.createObjectStore('pendingRequests', {
          keyPath: 'id',
          autoIncrement: true
        });
        store.createIndex('timestamp', 'timestamp');
      }
      
      // Store cho user progress
      if (!db.objectStoreNames.contains('progress')) {
        db.createObjectStore('progress', {
          keyPath: 'userId'
        });
      }
      
      console.log('🗃️ IndexedDB schema upgraded');
    };
  });
}

async function saveToIndexedDB(sheetsData) {
  try {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('TudienXoDangDB', 4);
      request.onsuccess = () => resolve(request.result);
      request.onerror = reject;
    });
    
    const tx = db.transaction('vocabulary', 'readwrite');
    const store = tx.objectStore('vocabulary');
    
    // Clear old data
    await store.clear();
    
    // Save new data từ Google Sheets
    if (sheetsData.values && sheetsData.values.length > 0) {
      const timestamp = Date.now();
      
      for (let i = 0; i < sheetsData.values.length; i++) {
        const row = sheetsData.values[i];
        if (row && row.length >= 2) { // Ít nhất có từ và nghĩa
          await store.put({
            word: row[0]?.toString().trim() || '',
            meaning: row[1]?.toString().trim() || '',
            pronunciation: row[2]?.toString().trim() || '',
            example: row[3]?.toString().trim() || '',
            category: row[4]?.toString().trim() || '',
            audioUrl: row[5]?.toString().trim() || '',
            timestamp: timestamp,
            id: i
          });
        }
      }
      
      console.log(`💾 Đã lưu ${sheetsData.values.length} từ vào IndexedDB`);
    }
    
    await tx.done;
    
  } catch (error) {
    console.error('❌ Lỗi lưu vào IndexedDB:', error);
  }
}

async function queueRequestForSync(request) {
  try {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('TudienXoDangDB', 4);
      request.onsuccess = () => resolve(request.result);
      request.onerror = reject;
    });
    
    const tx = db.transaction('pendingRequests', 'readwrite');
    const store = tx.objectStore('pendingRequests');
    
    // Lưu request details
    const requestData = {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body: request.method !== 'GET' ? await request.clone().text() : null,
      timestamp: Date.now(),
      retryCount: 0
    };
    
    await store.add(requestData);
    await tx.done;
    
    console.log('📤 Đã lưu request vào offline queue');
    
    // Đăng ký background sync
    if ('sync' in self.registration) {
      await self.registration.sync.register('sync-pending-requests');
    }
    
  } catch (error) {
    console.error('❌ Lỗi lưu request vào queue:', error);
  }
}

// ==================== OTHER HANDLERS (giữ nguyên) ====================

async function handleNavigationRequest(request) {
  try {
    const networkResponse = await fetch(request);
    const cache = await caches.open(CACHE_NAMES.app);
    await cache.put(request, networkResponse.clone());
    return networkResponse;
  } catch (error) {
    const cached = await caches.match('./offline.html');
    return cached || caches.match('./index.html');
  }
}

async function handleDefaultRequest(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAMES.app);
      await cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    return new Response('Resource not available offline', { status: 408 });
  }
}

// ==================== BACKGROUND SYNC ====================

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-pending-requests') {
    event.waitUntil(syncPendingRequests());
  }
});

async function syncPendingRequests() {
  try {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('TudienXoDangDB', 4);
      request.onsuccess = () => resolve(request.result);
      request.onerror = reject;
    });
    
    const tx = db.transaction('pendingRequests', 'readwrite');
    const store = tx.objectStore('pendingRequests');
    const pending = await store.getAll();
    await tx.done;
    
    console.log(`🔄 Syncing ${pending.length} pending requests`);
    
    for (const item of pending) {
      try {
        const response = await fetch(item.url, {
          method: item.method,
          headers: new Headers(item.headers),
          body: item.body
        });
        
        if (response.ok) {
          // Xóa sau khi sync thành công
          const deleteTx = db.transaction('pendingRequests', 'readwrite');
          await deleteTx.objectStore('pendingRequests').delete(item.id);
          await deleteTx.done;
          
          console.log(`✅ Synced request ${item.id}`);
          
          // Thông báo success cho client
          notifyClients('SYNC_SUCCESS', { requestId: item.id });
        }
      } catch (error) {
        console.error(`❌ Failed to sync request ${item.id}:`, error);
        
        // Tăng retry count
        const updateTx = db.transaction('pendingRequests', 'readwrite');
        const updateStore = updateTx.objectStore('pendingRequests');
        const record = await updateStore.get(item.id);
        
        if (record) {
          record.retryCount = (record.retryCount || 0) + 1;
          if (record.retryCount < 3) {
            await updateStore.put(record);
          } else {
            // Xóa nếu đã retry quá nhiều
            await updateStore.delete(item.id);
          }
        }
        
        await updateTx.done;
      }
    }
    
  } catch (error) {
    console.error('❌ Background sync failed:', error);
  }
}

// ==================== CLEANUP FUNCTIONS ====================

async function cleanupOldCaches() {
  const cacheNames = await caches.keys();
  const currentCaches = Object.values(CACHE_NAMES);
  
  return Promise.all(
    cacheNames.map(cacheName => {
      if (!currentCaches.includes(cacheName)) {
        console.log('🗑️ Deleting old cache:', cacheName);
        return caches.delete(cacheName);
      }
    })
  );
}

// ==================== HELPER FUNCTIONS ====================

function notifyClients(type, data) {
  self.clients.matchAll().then(clients => {
    clients.forEach(client => {
      client.postMessage({ type, data });
    });
  });
}

// ==================== MESSAGE HANDLER ====================

self.addEventListener('message', (event) => {
  const { type, data } = event.data || {};
  
  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
      
    case 'REFRESH_DATA':
      cacheGoogleSheetsData();
      break;
      
    case 'GET_DATA_INFO':
      sendDataInfo(event.source);
      break;
  }
});

async function sendDataInfo(client) {
  try {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('TudienXoDangDB', 4);
      request.onsuccess = () => resolve(request.result);
      request.onerror = reject;
    });
    
    const tx = db.transaction('vocabulary', 'readonly');
    const store = tx.objectStore('vocabulary');
    const count = await store.count();
    await tx.done;
    
    client.postMessage({
      type: 'DATA_INFO',
      data: {
        wordCount: count,
        lastUpdated: new Date().toISOString(),
        apiKeyConfigured: !!GOOGLE_CONFIG.API_KEY
      }
    });
    
  } catch (error) {
    client.postMessage({
      type: 'DATA_INFO',
      data: { error: 'Không thể lấy thông tin data' }
    });
  }
}

console.log('✅ Service Worker loaded với Google Sheets integration');

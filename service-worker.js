// service-worker.js - VERSION 4.4 (FIXED + CHAT DATA)

// ==================== CẤU HÌNH GOOGLE SHEETS ====================
const GOOGLE_CONFIG = {
  API_KEY: 'AIzaSyD757jS4SLR7-EzrPgrW9WrLQeD2DQExHw',
  SHEET_ID: '1Z59pDBu_tGwlYqUeS1-VJLpcHozp7LbxnC_-qhT3iHs',
  
  // Sheets configuration
  SHEETS: {
    VOCABULARY: {
      name: 'vocabulary',
      range: 'Tu_Dien!A2:F',
      get url() {
        return `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_CONFIG.SHEET_ID}/values/${this.range}?key=${GOOGLE_CONFIG.API_KEY}`;
      }
    },
    CHAT_DATA: {
      name: 'chat',
      range: 'Data_Chat!A2:B', // Giả sử có 4 cột A-D
      get url() {
        return `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_CONFIG.SHEET_ID}/values/${this.range}?key=${GOOGLE_CONFIG.API_KEY}`;
      }
    }
  },
  
  // Apps Script URL
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbz9XYdorp6vsKFTCrqx2tUSJGecpOmCbrROqKfkHYSFn2WXieQtJXWCQvSJvxCk6yrs/exec'
};

// ==================== CẤU HÌNH CACHE ====================
const APP_VERSION = '4.4.0';
const CACHE_NAMES = {
  app: `tudien-xodang-v${APP_VERSION}`,
  fonts: 'fonts-v2',
  audio: 'audio-v2',
  data: 'sheets-data-v3',
  chat: 'chat-data-v2'
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
  
  // Icons
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
      cacheGoogleSheetsData(),
      cacheChatData()
    ]).then(() => {
      console.log('✅ Tất cả resources đã được cache');
      return self.skipWaiting();
    }).catch(error => {
      console.error('❌ Install failed:', error);
      return self.skipWaiting(); // Vẫn skip waiting để không block
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
    }).catch(error => {
      console.error('❌ Activate failed:', error);
      self.clients.claim(); // Vẫn claim clients
    })
  );
});

// ==================== CACHE FUNCTIONS ====================

async function cacheStaticFiles() {
  try {
    const cache = await caches.open(CACHE_NAMES.app);
    
    // Cache từng file với error handling
    for (const url of STATIC_FILES) {
      try {
        await cache.add(url);
        console.log('✅ Cached:', url);
      } catch (err) {
        console.warn('⚠️ Không cache được:', url, err.message);
      }
    }
  } catch (error) {
    console.error('❌ cacheStaticFiles error:', error);
  }
}

async function cacheGoogleSheetsData() {
  try {
    console.log('📊 Đang cache dữ liệu từ điển...');
    
    const response = await fetch(GOOGLE_CONFIG.SHEETS.VOCABULARY.url);
    
    if (!response.ok) {
      throw new Error(`Google Sheets API error: ${response.status}`);
    }
    
    const data = await response.json();
    const cache = await caches.open(CACHE_NAMES.data);
    
    // Cache với headers đúng
    const cacheResponse = new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'X-Cached-At': new Date().toISOString()
      }
    });
    
    await cache.put(GOOGLE_CONFIG.SHEETS.VOCABULARY.url, cacheResponse);
    await saveToIndexedDB(data, 'vocabulary');
    
    console.log('✅ Đã cache từ điển:', data.values?.length || 0, 'từ');
    
  } catch (error) {
    console.error('❌ Không thể cache từ điển:', error);
  }
}

// THÊM HÀM CACHE CHAT DATA
async function cacheChatData() {
  try {
    console.log('🤖 Đang cache dữ liệu chatbot...');
    
    const response = await fetch(GOOGLE_CONFIG.SHEETS.CHAT_DATA.url);
    
    if (!response.ok) {
      throw new Error(`Chat Sheets API error: ${response.status}`);
    }
    
    const data = await response.json();
    const cache = await caches.open(CACHE_NAMES.chat);
    
    // Cache với headers đúng
    const cacheResponse = new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'X-Cached-At': new Date().toISOString()
      }
    });
    
    await cache.put(GOOGLE_CONFIG.SHEETS.CHAT_DATA.url, cacheResponse);
    await saveToIndexedDB(data, 'chat');
    
    console.log('✅ Đã cache chatbot data:', data.values?.length || 0, 'dòng');
    
  } catch (error) {
    console.error('❌ Không thể cache chatbot data:', error);
  }
}

// ==================== FETCH HANDLER - FIXED ====================

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const request = event.request;
  
  // Bỏ qua non-GET
  if (request.method !== 'GET') return;
  
  // 1. Google Sheets API Request - TỪ ĐIỂN
  if (url.href === GOOGLE_CONFIG.SHEETS.VOCABULARY.url) {
    event.respondWith(handleSheetsRequest(request, 'vocabulary'));
    return;
  }
  
  // 2. Google Sheets API Request - CHATBOT
  if (url.href === GOOGLE_CONFIG.SHEETS.CHAT_DATA.url) {
    event.respondWith(handleSheetsRequest(request, 'chat'));
    return;
  }
  
  // 3. Apps Script Request
  if (url.hostname.includes('script.google.com')) {
    event.respondWith(handleAppsScriptRequest(request));
    return;
  }
  
  // 4. Navigation requests
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequestFixed(request)); // SỬA LỖI
    return;
  }
  
  // 5. Default: Cache First, Network Fallback
  event.respondWith(handleDefaultRequestFixed(request)); // SỬA LỖI
});

// ==================== FIXED HANDLERS ====================

async function handleNavigationRequestFixed(request) {
  try {
    // Thử fetch từ network
    const networkResponse = await fetch(request);
    
    // Cache response nếu thành công
    if (networkResponse && networkResponse.ok) {
      const cache = await caches.open(CACHE_NAMES.app);
      await cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.log('🌐 Navigation offline, serving cached page');
    
    // QUAN TRỌNG: Luôn đảm bảo trả về Response object
    try {
      // Thử tìm offline.html
      const offlinePage = await caches.match('./offline.html');
      if (offlinePage) {
        return offlinePage;
      }
      
      // Thử tìm index.html
      const indexPage = await caches.match('./index.html');
      if (indexPage) {
        return indexPage;
      }
      
      // Fallback: tạo response HTML đơn giản
      return new Response(
        '<!DOCTYPE html><html><head><title>Offline</title></head><body><h1>Ứng dụng không khả dụng offline</h1></body></html>',
        {
          status: 200,
          headers: { 'Content-Type': 'text/html' }
        }
      );
    } catch (cacheError) {
      // Fallback cuối cùng
      return new Response(
        'Offline',
        {
          status: 200,
          headers: { 'Content-Type': 'text/plain' }
        }
      );
    }
  }
}

async function handleDefaultRequestFixed(request) {
  try {
    // Thử cache trước
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    
    // Thử network
    try {
      const networkResponse = await fetch(request);
      
      // Chỉ cache nếu thành công
      if (networkResponse && networkResponse.ok) {
        const cache = await caches.open(CACHE_NAMES.app);
        await cache.put(request, networkResponse.clone());
      }
      
      return networkResponse;
    } catch (networkError) {
      // Network failed
      console.log('📶 Network failed for:', request.url);
      
      // Trả về Response hợp lệ, không phải undefined
      if (request.destination === 'image') {
        return new Response(
          `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
            <rect width="100" height="100" fill="#f0f0f0"/>
            <text x="50" y="50" text-anchor="middle" font-size="12">No Image</text>
          </svg>`,
          { headers: { 'Content-Type': 'image/svg+xml' } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: 'offline', url: request.url }),
        {
          status: 408,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
  } catch (error) {
    console.error('handleDefaultRequest error:', error);
    
    // LUÔN trả về Response hợp lệ
    return new Response(
      'Service Error',
      {
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      }
    );
  }
}

// ==================== SHEETS REQUEST HANDLER (CHO CẢ 2 SHEETS) ====================

async function handleSheetsRequest(request, type) {
  const sheetConfig = type === 'chat' 
    ? GOOGLE_CONFIG.SHEETS.CHAT_DATA 
    : GOOGLE_CONFIG.SHEETS.VOCABULARY;
  
  const cacheName = type === 'chat' ? CACHE_NAMES.chat : CACHE_NAMES.data;
  
  console.log(`📊 ${type === 'chat' ? 'Chatbot' : 'Từ điển'} request`);
  
  try {
    // Chiến lược: Cache First với background update
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(sheetConfig.url);
    
    if (cachedResponse) {
      console.log(`📥 Trả về cached ${type} data`);
      
      // Background update
      updateSheetsDataInBackground(sheetConfig.url, type, cacheName);
      
      return cachedResponse;
    }
    
    // Fetch từ network nếu không có cache
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      // Cache response
      await cache.put(sheetConfig.url, networkResponse.clone());
      
      // Lưu vào IndexedDB
      const data = await networkResponse.json();
      await saveToIndexedDB(data, type);
      
      return networkResponse;
    }
    
    throw new Error(`Fetch failed: ${networkResponse.status}`);
    
  } catch (error) {
    console.error(`❌ ${type} fetch error:`, error);
    
    // Fallback response
    return new Response(
      JSON.stringify({
        error: 'offline',
        message: `Dữ liệu ${type === 'chat' ? 'chatbot' : 'từ điển'} không khả dụng offline`,
        values: []
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

async function updateSheetsDataInBackground(url, type, cacheName) {
  try {
    const response = await fetch(url);
    
    if (response.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(url, response.clone());
      
      const data = await response.json();
      await saveToIndexedDB(data, type);
      
      console.log(`🔄 Đã cập nhật ${type} data trong background`);
    }
  } catch (error) {
    // Silent fail - không hiển thị lỗi cho background update
  }
}

// ==================== APPS SCRIPT REQUEST HANDLER ====================

async function handleAppsScriptRequest(request) {
  try {
    const response = await fetch(request);
    
    if (response.ok) {
      return response;
    }
    
    throw new Error(`Apps Script error: ${response.status}`);
    
  } catch (error) {
    console.log('📴 Offline, saving to queue');
    
    await queueRequestForSync(request);
    
    return new Response(
      JSON.stringify({
        success: false,
        message: 'Đang offline, dữ liệu sẽ được đồng bộ khi có mạng',
        queued: true
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// ==================== INDEXEDDB FUNCTIONS (UPDATED) ====================

async function initIndexedDB() {
  return new Promise((resolve) => {
    const request = indexedDB.open('TudienXoDangDB', 5); // Tăng version lên 5
    
    request.onerror = () => {
      console.error('❌ IndexedDB error');
      resolve(null);
    };
    
    request.onsuccess = () => {
      console.log('✅ IndexedDB initialized');
      resolve(request.result);
    };
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Store cho từ điển
      if (!db.objectStoreNames.contains('vocabulary')) {
        const store = db.createObjectStore('vocabulary', {
          keyPath: 'id',
          autoIncrement: true
        });
        store.createIndex('word', 'word', { unique: false });
        store.createIndex('timestamp', 'timestamp');
      }
      
      // Store cho chat data (MỚI)
      if (!db.objectStoreNames.contains('chatData')) {
        const store = db.createObjectStore('chatData', {
          keyPath: 'id',
          autoIncrement: true
        });
        store.createIndex('question', 'question', { unique: false });
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
    };
  });
}

async function saveToIndexedDB(data, type) {
  try {
    const db = await new Promise((resolve) => {
      const request = indexedDB.open('TudienXoDangDB', 5);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    
    if (!db) return;
    
    const storeName = type === 'chat' ? 'chatData' : 'vocabulary';
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    
    // Clear old data
    await store.clear();
    
    // Save new data
    if (data.values && data.values.length > 0) {
      const timestamp = Date.now();
      
      for (let i = 0; i < data.values.length; i++) {
        const row = data.values[i];
        
        if (row && row.length > 0) {
          const item = { id: i, timestamp };
          
          if (type === 'chat') {
            // Format cho chat data (giả sử: question, answer, category, tags)
            item.question = row[0]?.toString().trim() || '';
            item.answer = row[1]?.toString().trim() || '';
            item.category = row[2]?.toString().trim() || '';
            item.tags = row[3]?.toString().trim() || '';
          } else {
            // Format cho vocabulary
            item.word = row[0]?.toString().trim() || '';
            item.meaning = row[1]?.toString().trim() || '';
            item.pronunciation = row[2]?.toString().trim() || '';
            item.example = row[3]?.toString().trim() || '';
            item.category = row[4]?.toString().trim() || '';
            item.audioUrl = row[5]?.toString().trim() || '';
          }
          
          await store.put(item);
        }
      }
      
      console.log(`💾 Đã lưu ${data.values.length} items vào ${storeName}`);
    }
    
    await tx.done;
  } catch (error) {
    console.error(`❌ Lỗi lưu ${type} vào IndexedDB:`, error);
  }
}

// ==================== CÁC HÀM KHÁC (giữ nguyên với error handling) ====================

async function cleanupOldCaches() {
  try {
    const cacheNames = await caches.keys();
    const currentCaches = Object.values(CACHE_NAMES);
    
    await Promise.all(
      cacheNames.map(cacheName => {
        if (!currentCaches.includes(cacheName)) {
          console.log('🗑️ Deleting old cache:', cacheName);
          return caches.delete(cacheName);
        }
      })
    );
  } catch (error) {
    console.error('❌ Cleanup error:', error);
  }
}

function notifyClients(type, data) {
  self.clients.matchAll().then(clients => {
    clients.forEach(client => {
      try {
        client.postMessage({ type, data });
      } catch (e) {
        console.log('Cannot post message to client');
      }
    });
  });
}

// ==================== BACKGROUND SYNC ====================

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-pending-requests') {
    event.waitUntil(syncPendingRequests());
  }
});

async function syncPendingRequests() {
  try {
    const db = await new Promise((resolve) => {
      const request = indexedDB.open('TudienXoDangDB', 5);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    
    if (!db) return;
    
    const tx = db.transaction('pendingRequests', 'readonly');
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
          const deleteTx = db.transaction('pendingRequests', 'readwrite');
          await deleteTx.objectStore('pendingRequests').delete(item.id);
          await deleteTx.done;
          
          console.log(`✅ Synced request ${item.id}`);
        }
      } catch (error) {
        console.log(`❌ Failed to sync request ${item.id}`);
      }
    }
  } catch (error) {
    console.error('❌ Background sync failed:', error);
  }
}

async function queueRequestForSync(request) {
  try {
    const db = await new Promise((resolve) => {
      const request = indexedDB.open('TudienXoDangDB', 5);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    
    if (!db) return;
    
    const tx = db.transaction('pendingRequests', 'readwrite');
    const store = tx.objectStore('pendingRequests');
    
    const requestData = {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body: request.method !== 'GET' ? await request.clone().text() : null,
      timestamp: Date.now()
    };
    
    await store.add(requestData);
    await tx.done;
    
    console.log('📤 Đã lưu request vào queue');
    
    if ('sync' in self.registration) {
      await self.registration.sync.register('sync-pending-requests');
    }
  } catch (error) {
    console.error('❌ Lỗi lưu request vào queue:', error);
  }
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
      
    case 'REFRESH_CHAT_DATA':
      cacheChatData();
      break;
      
    case 'GET_DATA_INFO':
      sendDataInfo(event.source);
      break;
  }
});

async function sendDataInfo(client) {
  try {
    const db = await new Promise((resolve) => {
      const request = indexedDB.open('TudienXoDangDB', 5);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    
    if (!db) return;
    
    // Lấy số lượng từ vựng
    const vocabTx = db.transaction('vocabulary', 'readonly');
    const vocabStore = vocabTx.objectStore('vocabulary');
    const vocabCount = await vocabStore.count();
    await vocabTx.done;
    
    // Lấy số lượng chat data
    const chatTx = db.transaction('chatData', 'readonly');
    const chatStore = chatTx.objectStore('chatData');
    const chatCount = await chatStore.count();
    await chatTx.done;
    
    client.postMessage({
      type: 'DATA_INFO',
      data: {
        vocabularyCount: vocabCount,
        chatDataCount: chatCount,
        lastUpdated: new Date().toISOString()
      }
    });
  } catch (error) {
    client.postMessage({
      type: 'DATA_INFO',
      data: { error: 'Không thể lấy thông tin data' }
    });
  }
}

console.log('✅ Service Worker loaded - Fixed navigation error + Chat data');

/* ============================================================
   赫綠設計學院 - Firebase 雲端同步模組 v4
   ------------------------------------------------------------
   同步範圍：
   1. localStorage 全部 key（自動分批）
   2. IndexedDB：SpaceBaseDB / waterfall_blob_store / castle_cards_sfx_db
   ============================================================ */

(function(){

// ★ iframe 內不啟動 Firebase 同步 — 由 parent 頁面統一處理
// 避免多個同步實例搶寫 localStorage 導致資料覆蓋遺失
try {
  if (window.parent !== window) {
    console.log('[FirebaseSync] iframe 內，跳過同步（由 parent 處理）');
    window.firebaseSync = { push: function(){}, pull: function(){} };
    return;
  }
} catch(e) {
  // cross-origin iframe：也跳過
  window.firebaseSync = { push: function(){}, pull: function(){} };
  return;
}

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDIJldvnAC50z4rNUO8I6tTNvXOKBwayx4",
  authDomain: "talent-map-e0c36.firebaseapp.com",
  projectId: "talent-map-e0c36",
  storageBucket: "talent-map-e0c36.firebasestorage.app",
  messagingSenderId: "784909396524",
  appId: "1:784909396524:web:c90bffd14fe7f2add8bf89",
  measurementId: "G-VTK71BX7YN"
};

// 需要同步的 IndexedDB 清單
const IDB_LIST = [
  { dbName: 'SpaceBaseDB',          dbVer: 1, stores: ['images', 'scores'] },
  { dbName: 'waterfall_blob_store',  dbVer: 1, stores: ['blobs'] },
  { dbName: 'castle_cards_sfx_db',   dbVer: 1, stores: ['blobs'] }
];

// === 徽章 ===========================================================
let badgeEl = null;
function ensureBadge(){
  if (badgeEl) return;
  const create = () => {
    if (badgeEl) return;
    badgeEl = document.createElement('div');
    badgeEl.id = 'firebase-sync-badge';
    badgeEl.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:2147483647;background:rgba(0,0,0,.7);color:#ffd700;font:11px/1.3 monospace;padding:4px 8px;border-radius:4px;border:1px solid rgba(255,215,0,.3);pointer-events:none;max-width:260px;white-space:pre-wrap;opacity:0.6;';
    badgeEl.textContent = '☁ 初始化中…';
    document.body.appendChild(badgeEl);
  };
  if (document.body) create();
  else document.addEventListener('DOMContentLoaded', create);
}
function setBadge(text, color){
  ensureBadge();
  const apply = () => {
    if (!badgeEl) return;
    badgeEl.textContent = text;
    badgeEl.style.color = color || '#ffd700';
    badgeEl.style.borderColor = color || '#ffd700';
    badgeEl.style.opacity = '1';
  };
  if (badgeEl) apply(); else document.addEventListener('DOMContentLoaded', apply);
}
ensureBadge();
setBadge('☁ 載入中…', '#ffd700');

// === 載入 SDK ========================================================
const SDK_BASE = 'https://www.gstatic.com/firebasejs/10.12.2/';
const SDK_FILES = [
  'firebase-app-compat.js',
  'firebase-auth-compat.js',
  'firebase-firestore-compat.js'
];
function loadScript(src, timeoutMs){
  timeoutMs = timeoutMs || 8000;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    var done = false;
    var timer = setTimeout(function(){
      if(!done){done=true; reject(new Error('載入逾時 ' + src));}
    }, timeoutMs);
    s.onload = function(){ if(!done){done=true; clearTimeout(timer); resolve();} };
    s.onerror = function(){ if(!done){done=true; clearTimeout(timer); reject(new Error('無法載入 ' + src));} };
    document.head.appendChild(s);
  });
}
// 帶重試的載入
async function loadScriptRetry(src, retries){
  retries = retries || 2;
  for(var i=0; i<=retries; i++){
    try{ await loadScript(src, 8000); return; }
    catch(e){
      if(i<retries){console.warn('[FirebaseSync] 重試載入 ('+( i+1)+'/'+retries+'):', src);}
      else throw e;
    }
  }
}

// === 參數 ===========================================================
const urlParams = new URLSearchParams(location.search);
const IS_ADMIN  = urlParams.get('admin') === '1';
const SYNC_DEBOUNCE_MS = 3000;
const SYNC_INTERVAL_MS = 15000;
const BATCH_LIMIT = 750 * 1024;

// 這些 key 是「本機專屬」設定，不應該被雲端覆蓋
const LOCAL_ONLY_KEYS = [
  'activeCharacterId',
  'activeCharacterName',
  'profileName',
  'profileImgData',
  'castle_flip_mode'
];

// 前綴型排除：以這些字串開頭的 localStorage key 不同步（避免大圖拖垮推送）
const LOCAL_ONLY_PREFIXES = [
  '_plaza_bak_',
  'appedu_',
  'hex_thumb_',
  'plaza_thumb_',
  '_roleSnap_',
  '_bak_'
];

let fsDb, auth;
let ready = false;
let syncTimer = null;

const _origSet    = localStorage.setItem.bind(localStorage);
const _origRemove = localStorage.removeItem.bind(localStorage);

// 判斷 key 是否為本機專屬（不同步到雲端）
function isLocalOnlyKey(k){
  if (LOCAL_ONLY_KEYS.includes(k)) return true;
  for (var i=0; i<LOCAL_ONLY_PREFIXES.length; i++){
    if (k.indexOf(LOCAL_ONLY_PREFIXES[i]) === 0) return true;
  }
  return false;
}

function getCharacterId(){
  let id = localStorage.getItem('activeCharacterId');
  if (id) return id;
  try {
    const cards = JSON.parse(localStorage.getItem('castle_cards_v1') || '[]');
    const c = cards.find(x => x && x.name && x.active !== false);
    if (c) return c.name;
  } catch(e){}
  return 'default';
}

// === IndexedDB 工具函式 ==============================================

// pushToCloud 用：只開啟已存在的 DB，不會自己建立空 DB
function idbOpen(dbName, dbVer, storeNames){
  return new Promise((resolve, reject) => {
    try {
      var wasCreated = false;
      var req = indexedDB.open(dbName);
      req.onupgradeneeded = function(){
        wasCreated = true;
      };
      req.onsuccess = function(){
        var theDb = req.result;
        if (wasCreated) {
          console.log('[FirebaseSync] DB 尚未初始化，跳過:', dbName);
          theDb.close();
          try { indexedDB.deleteDatabase(dbName); } catch(e){}
          reject(new Error('DB not initialized: ' + dbName));
          return;
        }
        if (storeNames && storeNames.length > 0) {
          var missing = storeNames.filter(function(s){ return !theDb.objectStoreNames.contains(s); });
          if (missing.length === storeNames.length) {
            console.log('[FirebaseSync] DB 缺少所有 store，跳過:', dbName, missing);
            theDb.close();
            try { indexedDB.deleteDatabase(dbName); } catch(e){}
            reject(new Error('DB missing stores: ' + dbName));
            return;
          }
        }
        resolve(theDb);
      };
      req.onerror = function(){ reject(req.error); };
    } catch(e){ reject(e); }
  });
}

// pullFromCloud 用：如果 DB 不存在就主動建立（含正確 schema）
// 這樣雲端的圖片/資料一定能寫入，不會因為 DB 還沒初始化就跳過
function idbOpenOrCreate(dbName, dbVer, storeNames){
  return new Promise((resolve, reject) => {
    try {
      // 已知各 DB 的 store schema
      var SCHEMAS = {
        'SpaceBaseDB': function(d){
          if(!d.objectStoreNames.contains('images')) d.createObjectStore('images');
          if(!d.objectStoreNames.contains('scores')) d.createObjectStore('scores',{keyPath:'id',autoIncrement:true});
        },
        'waterfall_blob_store': function(d){
          if(!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
        },
        'castle_cards_sfx_db': function(d){
          if(!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
        }
      };
      var req = indexedDB.open(dbName, dbVer);
      req.onupgradeneeded = function(e){
        var d = e.target.result;
        console.log('[FirebaseSync] 為雲端拉取建立 DB:', dbName);
        if (SCHEMAS[dbName]) {
          SCHEMAS[dbName](d);
        } else {
          // 未知 DB，嘗試建立 storeNames 中的 store
          if (storeNames) {
            for(var i=0;i<storeNames.length;i++){
              if(!d.objectStoreNames.contains(storeNames[i]))
                d.createObjectStore(storeNames[i]);
            }
          }
        }
      };
      req.onsuccess = function(){ resolve(req.result); };
      req.onerror = function(){ reject(req.error); };
    } catch(e){ reject(e); }
  });
}

function idbGetAllEntries(db, storeName){
  return new Promise((resolve, reject) => {
    try {
      if (!db.objectStoreNames.contains(storeName)) {
        console.log('[FirebaseSync] IDB store 不存在，跳過:', storeName);
        resolve({});
        return;
      }
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const entries = {};
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor){
          const val = cursor.value;
          const key = String(cursor.key);
          if (typeof val === 'string') entries[key] = val;
          else {
            try { entries[key] = JSON.stringify(val); }
            catch(e){ entries[key] = String(val); }
          }
          cursor.continue();
        } else {
          resolve(entries);
        }
      };
      cursorReq.onerror = () => { console.warn('[FirebaseSync] IDB read error', storeName); resolve({}); };
    } catch(e){ resolve({}); }
  });
}

// ★ 圖片 key 保護名單：這些 key 在 images store 中，如果本地已有有效資料就不覆蓋
var _IMG_PROTECT_PREFIXES = ['hex_', 'plaza_', 'mascot', 'profile'];
function _isProtectedImgKey(storeName, k){
  if (storeName !== 'images') return false;
  for (var i = 0; i < _IMG_PROTECT_PREFIXES.length; i++){
    if (k.indexOf(_IMG_PROTECT_PREFIXES[i]) === 0 || k === _IMG_PROTECT_PREFIXES[i]) return true;
  }
  return false;
}
function _isValidImgData(d){
  return d && typeof d === 'string' && d.indexOf('data:image/') === 0 && d.length > 500;
}

function idbPutEntries(db, storeName, entries){
  return new Promise((resolve, reject) => {
    try {
      if (!db.objectStoreNames.contains(storeName)) {
        console.log('[FirebaseSync] IDB store 不存在，跳過寫入:', storeName);
        resolve();
        return;
      }
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      // 檢查 store 是否有 keyPath（有的話不能用外部 key）
      const hasKeyPath = store.keyPath != null;
      var pendingChecks = 0;
      var allDone = false;
      for (const [k, v] of Object.entries(entries)){
        let val = v;
        try { const parsed = JSON.parse(v); if (typeof parsed === 'object') val = parsed; } catch(e){}
        // ★ 保護圖片 key：如果本地已有有效資料，不讓雲端覆蓋
        if (_isProtectedImgKey(storeName, k)) {
          pendingChecks++;
          (function(_k, _val){
            var getReq = store.get(_k);
            getReq.onsuccess = function(){
              var local = getReq.result;
              if (local && _isValidImgData(local)) {
                // ★ 本地已有好資料，雲端資料不覆蓋
                console.log('[FirebaseSync] 保護本地圖片不被覆蓋:', _k);
              } else if (_isValidImgData(_val)) {
                // 本地沒有或損壞，雲端資料有效 → 寫入
                store.put(_val, _k);
              } else {
                // 雲端資料也損壞 → 跳過
                console.warn('[FirebaseSync] 雲端圖片資料無效，跳過:', _k);
              }
              pendingChecks--;
            };
            getReq.onerror = function(){ pendingChecks--; };
          })(k, val);
          continue;
        }
        if (hasKeyPath) {
          // 有 keyPath 的 store（如 scores），值本身包含 key
          if (typeof val === 'object' && val !== null) store.put(val);
          // 非物件值無法放入有 keyPath 的 store，跳過
        } else {
          store.put(val, k);
        }
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => { console.warn('[FirebaseSync] IDB write error', storeName); resolve(); };
    } catch(e){ resolve(); }
  });
}

// === 分批寫入 Firestore 的工具 =======================================
async function writeDataToFirestore(collRef, dataMap){
  // dataMap: { key: value, ... }
  // 自動分批，每批 < BATCH_LIMIT
  const batches = [];
  let currentBatch = {};
  let currentSize = 0;
  const bigEntries = {};

  for (const [k, v] of Object.entries(dataMap)){
    const entrySize = k.length + (v ? v.length : 0);
    if (entrySize > BATCH_LIMIT){
      bigEntries[k] = v;
      continue;
    }
    if (currentSize + entrySize > BATCH_LIMIT && Object.keys(currentBatch).length > 0){
      batches.push(currentBatch);
      currentBatch = {};
      currentSize = 0;
    }
    currentBatch[k] = v;
    currentSize += entrySize;
  }
  if (Object.keys(currentBatch).length > 0) batches.push(currentBatch);

  // 主文件
  await collRef.doc('main').set({ totalBatches: batches.length, data: batches[0] || {} });

  // 其餘批次
  for (let i = 1; i < batches.length; i++){
    await collRef.doc('chunk_' + i).set({ data: batches[i] });
  }

  // 大 entry 分段存
  for (const [k, v] of Object.entries(bigEntries)){
    const safeK = encodeURIComponent(k).substring(0, 1400);
    if (v && v.length > 900 * 1024){
      const CS = 900 * 1024;
      const parts = Math.ceil(v.length / CS);
      for (let p = 0; p < parts; p++){
        await collRef.doc('big_' + safeK + '_p' + p).set({
          key: k, part: p, totalParts: parts,
          value: v.substring(p * CS, (p + 1) * CS)
        });
      }
    } else {
      await collRef.doc('big_' + safeK).set({ key: k, value: v || '' });
    }
  }

  return Object.keys(dataMap).length;
}

async function readDataFromFirestore(collRef){
  const snap = await collRef.get();
  const result = {};
  const bigParts = {};

  snap.forEach(docSnap => {
    const d = docSnap.data();
    if (!d) return;
    const id = docSnap.id;

    if (id === 'main' || id.startsWith('chunk_')){
      if (d.data) Object.assign(result, d.data);
    } else if (id.startsWith('big_')){
      if (d.totalParts && d.totalParts > 1){
        if (!bigParts[d.key]) bigParts[d.key] = { total: d.totalParts, pieces: {} };
        bigParts[d.key].pieces[d.part] = d.value || '';
      } else if (d.key){
        result[d.key] = d.value || '';
      }
    }
  });

  // 組合分段
  for (const [key, info] of Object.entries(bigParts)){
    let full = '';
    for (let p = 0; p < info.total; p++) full += (info.pieces[p] || '');
    if (full) result[key] = full;
  }
  return result;
}

// === 推送 ============================================================
async function pushToCloud(){
  if (!ready || IS_ADMIN) return;
  const charId = getCharacterId();
  try {
    setBadge('☁ 推送中…', '#ffd700');

    // 1. localStorage（排除本機專屬 key）
    const lsData = {};
    for (let i = 0; i < localStorage.length; i++){
      const k = localStorage.key(i);
      if (!k) continue;
      if (isLocalOnlyKey(k)) continue;
      lsData[k] = localStorage.getItem(k) || '';
    }
    const charRef = fsDb.collection('characters').doc(charId);
    const lsRef = charRef.collection('localStorage');
    const lsCount = await writeDataToFirestore(lsRef, lsData);

    // 2. IndexedDB
    let idbCount = 0;
    for (const idbInfo of IDB_LIST){
      try {
        // 不更新徽章文字，避免干擾
        const idb = await idbOpen(idbInfo.dbName, idbInfo.dbVer, idbInfo.stores);
        for (const storeName of idbInfo.stores){
          const entries = await idbGetAllEntries(idb, storeName);
          const storeRef = charRef.collection('idb_' + idbInfo.dbName + '_' + storeName);
          const n = await writeDataToFirestore(storeRef, entries);
          idbCount += n;
        }
        idb.close();
      } catch(e){
        console.warn('[FirebaseSync] IDB 推送跳過', idbInfo.dbName, e.message || e);
      }
    }

    // 更新 metadata
    await charRef.set({ updatedAt: Date.now(), charId: charId }, { merge: true });

    const msg = '✅ ' + lsCount + '+' + idbCount + ' 筆已同步';
    console.log('[FirebaseSync] 推送成功 localStorage:', lsCount, 'IndexedDB:', idbCount);
    setBadge(msg, '#00ff88');
    setTimeout(() => {
      setBadge('☁ 同步中', '#00ff88');
      setTimeout(() => { if (badgeEl) badgeEl.style.opacity = '0.3'; }, 1500);
    }, 3000);
  } catch(err){
    console.warn('[FirebaseSync] 推送失敗', err);
    var pushErrMsg = err.code || '';
    if (err.message) pushErrMsg += (pushErrMsg ? '\n' : '') + String(err.message).substring(0, 80);
    if (pushErrMsg.indexOf('permission') !== -1 || pushErrMsg.indexOf('PERMISSION') !== -1) {
      pushErrMsg = '權限不足 — Firestore 安全規則可能已過期';
    }
    setBadge('❌ 推送失敗\n' + pushErrMsg, '#ff6666');
  }
}

function schedulePush(){
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(pushToCloud, SYNC_DEBOUNCE_MS);
}

localStorage.setItem = function(k, v){ _origSet(k, v); if(!isLocalOnlyKey(k)) schedulePush(); };
localStorage.removeItem = function(k){ _origRemove(k); if(!isLocalOnlyKey(k)) schedulePush(); };

// === 拉取 ============================================================
async function pullFromCloud(){
  const allSnap = await fsDb.collection('characters').get();
  let totalLS = 0, totalIDB = 0;

  for (const charDoc of allSnap.docs){
    const charId = charDoc.id;
    const charRef = fsDb.collection('characters').doc(charId);

    // 1. localStorage（★ 核心原則：本地已有資料的 key 絕對不覆蓋）
    try {
      const lsData = await readDataFromFirestore(charRef.collection('localStorage'));
      for (const [k, v] of Object.entries(lsData)){
        if (isLocalOnlyKey(k)) continue;
        // ★★★ 防資料遺失：本地已有任何值就完全跳過，雲端不得覆蓋 ★★★
        var existingVal = localStorage.getItem(k);
        if (existingVal !== null && existingVal !== '') {
          console.log('[FirebaseSync] 跳過覆蓋（本地已有資料）:', k, '(' + existingVal.length + 'B)');
          continue;
        }
        // 本地沒有資料才從雲端補入
        try { _origSet(k, v); totalLS++; console.log('[FirebaseSync] 從雲端補入:', k); } catch(qe){
          console.warn('[FirebaseSync] LS 空間不足，跳過:', k, '('+((v||'').length/1024).toFixed(0)+'KB)');
        }
      }
    } catch(e){
      // 可能舊格式（v3），嘗試讀取舊結構
      const d = charDoc.data();
      if (d && d.data){
        for (const [k, v] of Object.entries(d.data)){
          if (isLocalOnlyKey(k)) continue;
          // ★★★ v3 fallback 同樣保護：本地已有就不覆蓋 ★★★
          var existingV3 = localStorage.getItem(k);
          if (existingV3 !== null && existingV3 !== '') {
            console.log('[FirebaseSync] v3 跳過覆蓋（本地已有）:', k);
            continue;
          }
          try { _origSet(k, v); totalLS++; } catch(qe){
            console.warn('[FirebaseSync] LS 空間不足，跳過:', k);
          }
        }
      }
    }

    // 2. IndexedDB — 用 idbOpenOrCreate 確保 DB 一定存在
    for (const idbInfo of IDB_LIST){
      for (const storeName of idbInfo.stores){
        try {
          const collName = 'idb_' + idbInfo.dbName + '_' + storeName;
          const entries = await readDataFromFirestore(charRef.collection(collName));
          if (Object.keys(entries).length === 0) continue;
          const idb = await idbOpenOrCreate(idbInfo.dbName, idbInfo.dbVer, idbInfo.stores);
          await idbPutEntries(idb, storeName, entries);
          totalIDB += Object.keys(entries).length;
          idb.close();
        } catch(e){
          console.warn('[FirebaseSync] IDB 拉取跳過', idbInfo.dbName, storeName, e.message || e);
        }
      }
    }
  }

  console.log('[FirebaseSync] 雲端載入 localStorage:', totalLS, ' IndexedDB:', totalIDB);
  window.dispatchEvent(new Event('firebase-sync-ready'));
}

// === 即時監聽（只監聽主角 metadata 變化）==============================
function setupRealtime(){
  fsDb.collection('characters').onSnapshot(snap => {
    snap.docChanges().forEach(ch => {
      if (ch.type === 'removed') return;
      console.log('[FirebaseSync] 偵測到雲端更新:', ch.doc.id);
    });
    window.dispatchEvent(new Event('firebase-sync-updated'));
  });
}

// === 啟動 ============================================================
// ★ 登入頁（index.html）未登入時延遲啟動，避免重型操作干擾密碼輸入
function _isLoginPage(){
  var p = decodeURIComponent(location.pathname);
  return p.endsWith('index.html') || p.endsWith('/');
}
function _hasAppSession(){
  try{
    var s = JSON.parse(sessionStorage.getItem('appedu_session'));
    if(s && s.user) return true;
    var r = JSON.parse(localStorage.getItem('appedu_remembered_session'));
    if(r && r.user) return true;
  }catch(e){}
  return false;
}

(async function init(){
  // ★ 登入頁 + 尚未登入 → 延遲到使用者登入後再啟動 Firebase 同步
  if(_isLoginPage() && !_hasAppSession()){
    console.log('[FirebaseSync] 登入頁未登入，等待登入後再啟動');
    setBadge('', 'transparent');
    // 監聽登入事件後再啟動
    window.addEventListener('storage', function _waitLogin(e){
      if(e.key==='appedu_login_event' || (e.key==='appedu_session')){
        window.removeEventListener('storage', _waitLogin);
        _doInit();
      }
    });
    // 也監聯同頁面登入（sessionStorage 寫入後觸發）
    window._firebaseSyncStart = _doInit;
    return;
  }
  _doInit();
})();

async function _doInit(){
  try {
    for (const f of SDK_FILES) await loadScriptRetry(SDK_BASE + f, 2);
    setBadge('☁ 連線中…', '#ffd700');

    if (!window.firebase){
      setBadge('❌ Firebase 物件未建立', '#ff6666');
      return;
    }
    firebase.initializeApp(FIREBASE_CONFIG);
    fsDb = firebase.firestore();
    auth = firebase.auth();

    setBadge('☁ 登入中…', '#ffd700');
    auth.onAuthStateChanged(async user => {
      if (!user){
        try { await auth.signInAnonymously(); }
        catch(e){
          console.error('[FirebaseSync] 登入失敗', e);
          setBadge('❌ 登入失敗\n' + (e.code||e.message), '#ff6666');
        }
        return;
      }
      console.log('[FirebaseSync] 已登入', user.uid, IS_ADMIN ? '(管理者)' : '');
      setBadge('☁ 拉取中…', '#00ff88');
      try {
        await pullFromCloud();
        ready = true;
        setupRealtime();
        if (!IS_ADMIN) setInterval(pushToCloud, SYNC_INTERVAL_MS);
        setBadge(IS_ADMIN ? '☁ 管理者' : '☁ 同步中', '#00ff88');
        setTimeout(() => { if (badgeEl) badgeEl.style.opacity = '0.3'; }, 2000);
        // 第一次推送延遲 5 秒，確保頁面自己的 IndexedDB 初始化完成
        if (!IS_ADMIN) setTimeout(pushToCloud, 5000);
      } catch(e){
        console.error('[FirebaseSync] 初始化失敗', e);
        var errMsg = e.code || '';
        if (e.message) errMsg += (errMsg ? ' ' : '') + e.message;
        if (errMsg.indexOf('permission') !== -1 || errMsg.indexOf('PERMISSION') !== -1) {
          errMsg = '權限不足\n請檢查 Firestore 安全規則\n（測試模式可能已過期）';
        }
        setBadge('❌ 同步失敗\n' + errMsg, '#ff6666');
      }
    });
  } catch(err){
    console.error('[FirebaseSync] SDK 載入失敗', err);
    setBadge('❌ SDK 載入失敗\n' + (err.message||err), '#ff6666');
  }
}

window.firebaseSync = { push: pushToCloud, pull: pullFromCloud };

// === 跨分頁主角切換同步 =============================================
// 當另一個分頁改了 activeCharacterId，自動重新整理目前頁面
// 但如果頁面已經透過 postMessage/直接呼叫處理了切換，就不需要 reload
window._characterSwitchHandled = false;
window.addEventListener('storage', function(e){
  if (e.key === 'activeCharacterId' && e.oldValue !== e.newValue) {
    console.log('[FirebaseSync] 偵測到主角切換：', e.oldValue, '→', e.newValue);
    // 如果是從 iframe 的直接通知（postMessage / parent.syncFromCastleCards）
    // 已經處理過，就不需要 reload
    if (window._characterSwitchHandled) {
      console.log('[FirebaseSync] 已由 iframe 通知處理，跳過 reload');
      window._characterSwitchHandled = false;
      return;
    }
    // 其他分頁/獨立頁面：延遲 500ms 重新整理
    setTimeout(function(){ location.reload(); }, 500);
  }
});

})();

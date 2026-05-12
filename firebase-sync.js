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
    // ★ 把 iframe 的 setItem proxy 到 parent.localStorage.setItem
    //   讓 parent 的 override（_recordLocalTs + schedulePush）能跑到 iframe 寫入
    //   不然 iframe 編輯只會等 parent 60s interval 才同步，且 LWW ts shadow 永遠是空的
    try {
      var _parentLS = window.parent.localStorage;
      if (_parentLS && typeof _parentLS.setItem === 'function') {
        var _origIframeSet = localStorage.setItem.bind(localStorage);
        localStorage.setItem = function(k, v) {
          try { _parentLS.setItem(k, v); }
          catch(_pe) { _origIframeSet(k, v); }
        };
      }
    } catch(_e) { /* cross-origin parent — fall back to native setItem */ }
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
// ★ 只同步真正重要的資料庫，音效 DB 不同步（音效會自動重新載入）
const IDB_LIST = [
  { dbName: 'SpaceBaseDB',          dbVer: 1, stores: ['images', 'scores'] },
  // ★ v3：motiv_archive 從 localStorage 搬到這裡（避免 5MB quota）
  //   每個月份是一個 entry（key = '2026-04'），便於增量同步
  { dbName: 'MotivArchiveDB',       dbVer: 1, stores: ['archive'] },
  // ★ v3：training_sales_v2 從 localStorage 搬到這裡（避免 5MB quota）
  //   每個主角的訓練資料是一個 entry（key = charId），同主角跨裝置同步
  { dbName: 'TrainingSalesDB',      dbVer: 1, stores: ['byCharacter'] }
];
// 拉取時也要能讀取舊的音效 collection（向下相容），但推送時不再寫入
const IDB_LIST_PULL_ONLY = [
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

// ★ 攔截 Firestore SDK 內部的 resource-exhausted 錯誤
//   這些是 WebChannel write stream 的無害重試訊息，資料已成功推送
//   攔截後不顯示在 console，徹底消除錯誤噪音
(function(){
  var _origError = console.error;
  var _origWarn = console.warn;
  function _isFirestoreNoise(args){
    for (var i = 0; i < args.length; i++){
      var s = String(args[i] || '');
      if (s.indexOf('resource-exhausted') !== -1 && s.indexOf('Write stream') !== -1) return true;
      if (s.indexOf('FIRESTORE') !== -1 && s.indexOf('resource-exhausted') !== -1) return true;
      if (s.indexOf('WebChannelConnection') !== -1 && s.indexOf('exhausted') !== -1) return true;
    }
    return false;
  }
  console.error = function(){
    if (_isFirestoreNoise(arguments)) return; // 靜音
    _origError.apply(console, arguments);
  };
  console.warn = function(){
    if (_isFirestoreNoise(arguments)) return; // 靜音
    _origWarn.apply(console, arguments);
  };
})();

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
const SYNC_DEBOUNCE_MS = 10000;  // 10秒防抖：連續改動只觸發一次推送
const SYNC_INTERVAL_MS = 60000;  // 60秒定時推送
const BATCH_LIMIT = 700 * 1024;  // 700KB（Firestore 文件上限 1MB；中文 UTF-8 約 3x string.length，需更多餘量）
// ★ 用 UTF-8 實際 byte 量測（中文字 1 char = 3 bytes），避免低估 batch size 導致超過 Firestore 1 MB 上限
function _utf8Bytes(s){
  if (s == null) return 0;
  try { return new TextEncoder().encode(String(s)).length; }
  catch(e){ return String(s).length * 2; /* fallback：保守估高 */ }
}
const WRITE_DELAY_MS = 500;      // 每筆寫入之間暫停 0.5 秒
const WRITE_LONG_PAUSE_MS = 3000; // 每 N 筆寫入後等伺服器消化
const WRITES_PER_PAUSE = 3;      // 每 3 筆寫入休息一次

// 這些 key 是「本機專屬」設定，不應該被雲端覆蓋
const LOCAL_ONLY_KEYS = [
  'activeCharacterId',
  'activeCharacterName',
  'profileName',
  'profileImgData',
  'castle_flip_mode',
  '_fs_lastModified',  // ★ LWW: 本地時間戳 shadow map，純本地不同步
  // ★ 純 UI 狀態 keys — 不該同步雲端（避免每次切 tab/重整都觸發備份 banner）
  'perf_last_tab',     // 業績數據中心最後使用的 tab
  'motiv_sel_year',    // 激勵年/月選單最後選的年
  'motiv_sel_month',   // 激勵年/月選單最後選的月
  'mp_data_v1_summary' // 月績效摘要（給 AI ctx 用，每次重算就好不用同步）
];

// 前綴型排除：以這些字串開頭的 localStorage key 不同步（避免大圖拖垮推送）
const LOCAL_ONLY_PREFIXES = [
  '_plaza_bak_',
  'appedu_',
  'hex_thumb_',
  'plaza_thumb_',
  '_roleSnap_',
  '_bak_',
  '_hexbk_',
  'firebase_sync_',
  'blob_',
  'bgm_'
];

// ★ 全公司共享的 LS keys（不按主角存）：
//   業績數據中心、各通路績效、每月講座成績、年度月/季比較 等
//   路徑：users/<tenant>/_global/localStorage/<key>
//   不再依主角分開儲存。任一裝置/主角更新後，所有人下次 pull 都拿到同一份。
const GLOBAL_LS_KEY_PATTERNS = [
  /^perf_compare_v1/,   // 業績數據中心（含 _channel_v1, _archives, _lec_v1, _channel_v1_archives 等所有子集）
  /^training_library_v1$/, // 訓練教材庫（全公司共享，每個主管都看得到同一份）
];
function isGlobalLsKey(k){
  if (!k) return false;
  for (var i = 0; i < GLOBAL_LS_KEY_PATTERNS.length; i++){
    if (GLOBAL_LS_KEY_PATTERNS[i].test(k)) return true;
  }
  return false;
}

// 單筆 localStorage value 超過這個大小且是圖片才壓縮（非圖片大型資料直接同步）
const LS_MAX_VALUE_SIZE = 800 * 1024; // 800KB

let fsDb, auth;
let ready = false;
let syncTimer = null;
let currentUserUid = null;
let currentUserEmail = null;
let _pushing = false; // ★ 推送鎖：防止多個推送同時進行
let _pullingFromCloud = false; // ★ 拉取進行中：阻擋 schedulePush 觸發，避免 push 把預設值蓋過雲端真資料

// ★ Dirty-tracking：記錄上次成功推送的每筆資料簽名（長度+前32字元）
//   下次推送時只送「真正有改變」的 key，大幅減少 Firestore 寫入量
let _lastPushedSig = {};  // { collectionPath: { key: signature } }

const _origSet    = localStorage.setItem.bind(localStorage);
const _origRemove = localStorage.removeItem.bind(localStorage);

// ★ 新裝置/無痕視窗初始化：完全空白時預設身份為「楊雅筑」（主帳號）
// 條件：沒有 activeCharacterId、沒有 castle_cards_v1、沒有 firebase_sync_code
// 這樣首次同步會直接以楊雅筑身份從雲端拉完整資料，不需要手動腳本
(function _initNewDevice(){
  try {
    if (localStorage.getItem('activeCharacterId')) return;
    if (localStorage.getItem('castle_cards_v1')) return;
    if (localStorage.getItem('firebase_sync_code')) return;
    console.log('[FirebaseSync] 偵測到新裝置/全新環境，預設身份：楊雅筑');
    _origSet('activeCharacterId', '楊雅筑');
    _origSet('activeCharacterName', '楊雅筑');
    _origSet('profileName', '楊雅筑');
  } catch(e){ /* 私密模式可能擋 LS，忽略 */ }
})();

// ★ 判斷 castle_cards_v1 的 raw value 是否為「空樣板」
//   定義：null / 太短 / 不是陣列 / 卡片數 < 5 / 全部都是 "角色N" 預設名
//   解析失敗也視為空樣板（保守側 — 寧可不推也別覆蓋雲端）
function _isEmptyCardsTemplate(val){
  if (!val || val.length < 50) return true;
  try {
    var arr = JSON.parse(val);
    if (!Array.isArray(arr) || arr.length < 5) return true;
    return arr.every(function(c){ return !c || !c.name || /^角色\s*\d+$/.test(c.name); });
  } catch(e){ return true; }
}
// ★ 判斷 castle_cards_v1 的 raw value 是否為「真實資料」
//   定義：可解析 + 至少有一個非「角色N」預設名的卡片
//   注意這不是 _isEmptyCardsTemplate 的反義 — 解析失敗在兩邊都視為「不安全」（false）
function _isRealCardsData(val){
  if (!val || val.length < 50) return false;
  try {
    var arr = JSON.parse(val);
    if (!Array.isArray(arr) || arr.length < 5) return false;
    return arr.some(function(c){ return c && c.name && !/^角色\s*\d+$/.test(c.name); });
  } catch(e){ return false; }
}

// 判斷 key 是否為本機專屬（不同步到雲端）
function isLocalOnlyKey(k){
  if (LOCAL_ONLY_KEYS.includes(k)) return true;
  for (var i=0; i<LOCAL_ONLY_PREFIXES.length; i++){
    if (k.indexOf(LOCAL_ONLY_PREFIXES[i]) === 0) return true;
  }
  // ★ 保護：castle_cards_v1 為空樣板時禁止推送（避免覆蓋雲端真實資料）
  if (k === 'castle_cards_v1' && _isEmptyCardsTemplate(localStorage.getItem('castle_cards_v1'))) {
    console.log('[FirebaseSync] castle_cards_v1 為空樣板，禁止推送');
    return true;
  }
  return false;
}

// === Last-write-wins (LWW) timestamp tracking =========================
// 每個 LS key 配一個本地「上次寫入時間」shadow map（_LS_TS_KEY），
// 雲端對應位置在 <charRef>/_meta/lsTs.ts 的 nested map。
// pull 時：cloudTs[k] > localTs[k] → 用雲端覆蓋本地；否則跳過。
//
// 關鍵：firebase-sync 還沒 ready（page init 階段）的寫入一律記 ts=0。
//   代表「不是真的編輯，只是頁面預設值」。新裝置 init 預設不會擋掉雲端真實資料。
//   ready=true 之後（pull 完成）的寫入才記 Date.now()，視為真的編輯。
const _LS_TS_KEY = '_fs_lastModified';
var _localTsMap = {};
try { _localTsMap = JSON.parse(localStorage.getItem(_LS_TS_KEY) || '{}') || {}; } catch(e) { _localTsMap = {}; }
var _tsSaveTimer = null;
function _saveLocalTsMap(){
  try { _origSet(_LS_TS_KEY, JSON.stringify(_localTsMap)); } catch(e){}
}
function _recordLocalTs(k){
  if (isLocalOnlyKey(k) || k === _LS_TS_KEY) return;
  _localTsMap[k] = ready ? Date.now() : 0;
  if (_tsSaveTimer) clearTimeout(_tsSaveTimer);
  _tsSaveTimer = setTimeout(_saveLocalTsMap, 500);
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
//
// ★ 保守策略（避免無端升級用戶現有 DB 版本）：
//   1. 先 probe 開啟（不指定版本）→ 看 DB 現況
//   2. 缺 store → 用 currentVersion+1 重開觸發 onupgradeneeded 補建
//   3. 全部 store 都在 → 直接回傳，不動版本號
//   這樣已正常的用戶不會被升級；只有真的缺 store 的裝置才升一版補建。
function idbOpenOrCreate(dbName, dbVer, storeNames){
  // 已知各 DB 的 store schema（建立或補建時用同一份）
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
  function _applySchema(d){
    if (SCHEMAS[dbName]) { SCHEMAS[dbName](d); return; }
    if (storeNames) {
      for (var i=0; i<storeNames.length; i++){
        if (!d.objectStoreNames.contains(storeNames[i])) d.createObjectStore(storeNames[i]);
      }
    }
  }
  return new Promise((resolve, reject) => {
    try {
      // 第一步：probe — 不指定版本開啟，看 DB 是否存在、是否有缺 store
      var probe = indexedDB.open(dbName);
      var wasCreated = false;
      probe.onupgradeneeded = function(e){
        // DB 不存在 → 建立並補完整 schema
        wasCreated = true;
        console.log('[FirebaseSync] 為雲端拉取建立 DB:', dbName);
        _applySchema(e.target.result);
      };
      probe.onsuccess = function(){
        var db = probe.result;
        var currentVer = db.version;
        var missing = (storeNames || []).filter(function(s){ return !db.objectStoreNames.contains(s); });
        if (wasCreated || missing.length === 0){
          // 剛建立 / 已有全部 store → 直接用
          resolve(db);
          return;
        }
        // DB 存在但缺 store → 升一個版本補建（保守做法，不撞固定版本號）
        console.log('[FirebaseSync] DB 缺 store，升版補建:', dbName, 'v' + currentVer + '→v' + (currentVer+1), missing);
        db.close();
        var upReq = indexedDB.open(dbName, currentVer + 1);
        upReq.onupgradeneeded = function(e){ _applySchema(e.target.result); };
        upReq.onsuccess = function(){ resolve(upReq.result); };
        upReq.onerror = function(){ reject(upReq.error); };
        upReq.onblocked = function(){
          // 其他分頁開著舊版本 → 沒辦法升級
          console.warn('[FirebaseSync] DB 升版被阻擋（其他分頁仍開啟舊版）:', dbName);
          reject(new Error('DB upgrade blocked: ' + dbName));
        };
      };
      probe.onerror = function(){ reject(probe.error); };
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
      cursorReq.onerror = () => { resolve({}); };
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
      var _imgProtectCount = 0, _imgWriteCount = 0;
      var _mpProtectCount = 0, _mpWriteCount = 0;
      for (const [k, v] of Object.entries(entries)){
        let val = v;
        try { const parsed = JSON.parse(v); if (typeof parsed === 'object') val = parsed; } catch(e){}
        // ★ 保護 mp_data_v1（業績數據中心月績效）：本地有資料就不讓雲端覆蓋
        //   原因：使用者匯入 1 月後，雲端可能還是舊版（沒有 1 月）；如果讓雲端覆蓋會把 1 月吃掉
        //   策略：本地有任何月份資料 → 跳過覆蓋；本地完全空才用雲端版本
        if (storeName === 'images' && k === 'mp_data_v1') {
          pendingChecks++;
          (function(_k, _val){
            var getReq = store.get(_k);
            getReq.onsuccess = function(){
              var local = getReq.result;
              var localHasMonths = false;
              try {
                var localObj = (typeof local === 'string') ? JSON.parse(local) : local;
                if (localObj && typeof localObj === 'object' && Object.keys(localObj).length > 0) {
                  localHasMonths = true;
                }
              } catch(e){}
              if (localHasMonths) {
                _mpProtectCount++;
              } else {
                // 本地空 → 用雲端版本補入（fresh device 第一次 pull 用）
                store.put(_val, _k);
                _mpWriteCount++;
              }
              pendingChecks--;
            };
            getReq.onerror = function(){ pendingChecks--; };
          })(k, val);
          continue;
        }
        // ★ 保護圖片 key：如果本地已有有效資料，不讓雲端覆蓋
        if (_isProtectedImgKey(storeName, k)) {
          pendingChecks++;
          (function(_k, _val){
            var getReq = store.get(_k);
            getReq.onsuccess = function(){
              var local = getReq.result;
              if (local && _isValidImgData(local)) {
                _imgProtectCount++;
              } else if (_isValidImgData(_val)) {
                store.put(_val, _k);
                _imgWriteCount++;
              }
              pendingChecks--;
            };
            getReq.onerror = function(){ pendingChecks--; };
          })(k, val);
          continue;
        }
        // ★ MotivArchiveDB.archive 保護：每個月份是一個 entry（key='2026-04'，value 含 archivedAt）
        //   雲端比本地舊 → 不覆蓋；雲端較新或本地沒有 → 寫入
        if (storeName === 'archive' && db.name === 'MotivArchiveDB') {
          pendingChecks++;
          (function(_k, _val){
            var getReq = store.get(_k);
            getReq.onsuccess = function(){
              var local = getReq.result;
              var localAt = (local && local.archivedAt) || '';
              var cloudAt = (_val && _val.archivedAt) || '';
              if (!local || (cloudAt && cloudAt > localAt)) {
                store.put(_val, _k);
              }
              // 本地較新或同時 → 跳過
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
      tx.oncomplete = () => {
        if (_imgWriteCount > 0) console.log('[FirebaseSync] 從雲端補入圖片:', _imgWriteCount, '筆');
        if (_mpProtectCount > 0) console.log('[FirebaseSync] 保護 mp_data_v1（本地較新），跳過雲端覆蓋');
        if (_mpWriteCount > 0) console.log('[FirebaseSync] mp_data_v1 本地空，從雲端補入');
        resolve();
      };
      tx.onerror = () => { resolve(); };
    } catch(e){ resolve(); }
  });
}

// === Dirty-tracking 簽名工具 ============================================
// 快速產生一個值的「指紋」：長度 + 前32字元 + 後32字元
// 用來比較兩次推送之間同一個 key 的值是否有變化
function _sig(v){
  if (!v) return '0:';
  var s = String(v);
  return s.length + ':' + s.substring(0, 32) + (s.length > 64 ? s.substring(s.length - 32) : '');
}

// 過濾出真正有改變的資料（跟上次推送相比）
function _filterChanged(collPath, dataMap, force){
  // ★ force escape hatch：繞過 dirty-tracking，所有 key 都當作變更
  //   仍由 pushToCloud 那邊呼叫 _recordSigs 更新簽名，下次正常 push 不會重複
  if (force === true){
    var forceCount = Object.keys(dataMap).length;
    if (forceCount > 0){
      console.log('[FirebaseSync] ' + collPath.split('/').pop() + ': ' + forceCount + ' 筆變更（force=true，全部推送）');
    }
    return Object.assign({}, dataMap);
  }
  var prev = _lastPushedSig[collPath] || {};
  var changed = {};
  var changedCount = 0, unchangedCount = 0;
  for (var k in dataMap){
    var sig = _sig(dataMap[k]);
    if (prev[k] === sig){
      unchangedCount++;
    } else {
      changed[k] = dataMap[k];
      changedCount++;
    }
  }
  if (changedCount === 0 && unchangedCount > 0){
    console.log('[FirebaseSync] ' + collPath.split('/').pop() + ': 無變更，跳過（' + unchangedCount + ' 筆未改變）');
  } else if (changedCount > 0){
    console.log('[FirebaseSync] ' + collPath.split('/').pop() + ': ' + changedCount + ' 筆變更，' + unchangedCount + ' 筆未改變');
  }
  return changed;
}

// 成功推送後，記住每筆資料的簽名
function _recordSigs(collPath, dataMap){
  var sigs = {};
  for (var k in dataMap) sigs[k] = _sig(dataMap[k]);
  _lastPushedSig[collPath] = sigs;
}

// === 延遲工具 ==========================================================
function delay(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

// === 圖片壓縮工具 ========================================================
// 將 base64 圖片壓縮到指定大小以內，確保大圖也能同步到雲端
function isBase64Image(str){
  return str && typeof str === 'string' && str.indexOf('data:image/') === 0;
}
function compressImage(dataUrl, maxBytes){
  return new Promise(function(resolve){
    try {
      var img = new Image();
      img.onload = function(){
        var canvas = document.createElement('canvas');
        var w = img.naturalWidth;
        var h = img.naturalHeight;
        // 如果原圖就很大，先縮小尺寸
        var maxDim = 800; // 最大邊長 800px（同步用途夠了）
        if (w > maxDim || h > maxDim){
          if (w > h){ h = Math.round(h * maxDim / w); w = maxDim; }
          else { w = Math.round(w * maxDim / h); h = maxDim; }
        }
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        // 嘗試不同品質，直到小於目標大小
        var quality = 0.7;
        var result = canvas.toDataURL('image/jpeg', quality);
        if (result.length > maxBytes && quality > 0.3){
          quality = 0.4;
          result = canvas.toDataURL('image/jpeg', quality);
        }
        if (result.length > maxBytes){
          // 進一步縮小尺寸
          var scale = 0.5;
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          result = canvas.toDataURL('image/jpeg', 0.5);
        }
        resolve(result);
      };
      img.onerror = function(){
        resolve(null); // 壓縮失敗就跳過
      };
      img.src = dataUrl;
    } catch(e){
      resolve(null);
    }
  });
}

// === 分批寫入 Firestore 的工具 =======================================
// ★ 用 WriteBatch 把多個 doc.set 合併成單一原子操作
//   → 在 Firestore write stream 裡只算「一次」寫入
//   → 徹底避免 resource-exhausted: Write stream exhausted
async function writeDataToFirestore(collRef, dataMap){
  const MAX_SINGLE_ENTRY = 500 * 1024;
  const CHUNK_SIZE = 900 * 1024; // 大型資料分段大小

  // ★ 第一步：預處理 — 壓縮超大圖片，非圖片大資料保留（走分段存）
  // ★ 用 UTF-8 實際 byte 量測（中文 1 char = 3 bytes，不是 1）
  var processedMap = {};
  var bigEntries = {};
  for (const [k, v] of Object.entries(dataMap)){
    const entrySize = _utf8Bytes(k) + _utf8Bytes(v);
    if (entrySize > MAX_SINGLE_ENTRY){
      if (isBase64Image(v)){
        var compressed = await compressImage(v, BATCH_LIMIT);
        if (compressed) processedMap[k] = compressed;
      } else {
        bigEntries[k] = v;
      }
      continue;
    }
    processedMap[k] = v;
  }

  // ★ 第二步：把 processedMap 分成多個 batch（每個 < BATCH_LIMIT，按 UTF-8 byte 算）
  var batches = [];
  var currentBatch = {};
  var currentSize = 0;
  for (const [k, v] of Object.entries(processedMap)){
    const entrySize = _utf8Bytes(k) + _utf8Bytes(v);
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

  // ★ 第三步：收集所有要寫的文件（docId → data）
  var allDocs = [];
  // 主文件 + chunk
  allDocs.push({ id: 'main', data: { totalBatches: batches.length, data: batches[0] || {} } });
  for (var i = 1; i < batches.length; i++){
    allDocs.push({ id: 'chunk_' + i, data: { data: batches[i] } });
  }
  // 大型資料分段
  for (const [k, v] of Object.entries(bigEntries)){
    var safeK = encodeURIComponent(k).substring(0, 1400);
    if (v && v.length > CHUNK_SIZE){
      var parts = Math.ceil(v.length / CHUNK_SIZE);
      for (var p = 0; p < parts; p++){
        allDocs.push({ id: 'big_' + safeK + '_p' + p, data: {
          key: k, part: p, totalParts: parts,
          value: v.substring(p * CHUNK_SIZE, (p + 1) * CHUNK_SIZE)
        }});
      }
    } else {
      allDocs.push({ id: 'big_' + safeK, data: { key: k, value: v || '' } });
    }
  }

  // ★ 第四步：用 WriteBatch 寫入，每個 batch 最多 WRITES_PER_PAUSE 個文件
  //   WriteBatch.commit() 是單一原子操作 → write stream 只算一次
  var totalWritten = 0;
  for (var bStart = 0; bStart < allDocs.length; bStart += WRITES_PER_PAUSE){
    var wb = fsDb.batch();
    var bEnd = Math.min(bStart + WRITES_PER_PAUSE, allDocs.length);
    for (var j = bStart; j < bEnd; j++){
      wb.set(collRef.doc(allDocs[j].id), allDocs[j].data);
    }
    await wb.commit();
    totalWritten += (bEnd - bStart);
    // ★ 等伺服器真正消化完，再送下一批
    try { await fsDb.waitForPendingWrites(); } catch(e){}
    if (bEnd < allDocs.length) await delay(WRITE_LONG_PAUSE_MS);
  }

  console.log('[FirebaseSync] collection 寫入完成，共', totalWritten, '筆（', Math.ceil(allDocs.length / WRITES_PER_PAUSE), '次 batch）');
  return Object.keys(processedMap).length;
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

// === 使用者路徑 ========================================================
function getUserCharRef(charId){
  if (!currentUserUid) return fsDb.collection('characters').doc(charId); // fallback
  return fsDb.collection('users').doc(currentUserUid).collection('characters').doc(charId);
}

// === Audit Log ========================================================
// 寫入 audit_logs collection，每次成功推送一筆紀錄
// 失敗不影響同步（只 console.warn）
async function _writeAuditLog(charId, lsCount, idbCount, changedKeys){
  try {
    var ua = navigator.userAgent || '';
    var browser = (ua.match(/Edg\/|Chrome\/|Safari\/|Firefox\/|OPR\//) || ['unknown'])[0].replace(/\/$/,'');
    var os = (ua.match(/Mac OS X|Windows NT|iPhone|iPad|Android|Linux/) || ['unknown'])[0];
    await fsDb.collection('audit_logs').add({
      ts: Date.now(),
      tsServer: firebase.firestore.FieldValue.serverTimestamp(),
      charId: charId || '',
      syncCode: currentUserUid || '',
      device: os + ' / ' + browser,
      page: (decodeURIComponent(location.pathname).split('/').pop() || 'index.html').replace(/\.html$/,''),
      action: 'sync_push',
      lsCount: lsCount || 0,
      idbCount: idbCount || 0,
      changedKeys: (changedKeys || []).slice(0, 50)  // 最多 50 個避免 doc 過大
    });
  } catch(e){
    console.warn('[FirebaseSync] audit log 寫入失敗（不影響同步）', e && (e.code || e.message));
  }
}

// === 推送 ============================================================
async function pushToCloud(opts){
  if (!ready || IS_ADMIN) return;
  // ★ 推送鎖：如果上一次推送還在進行中，跳過這次
  if (_pushing){
    console.log('[FirebaseSync] 上次推送尚未完成，跳過');
    return;
  }
  // ★ 拉取進行中：跳過推送（避免空殼覆蓋雲端真資料）
  if (_pullingFromCloud){
    console.log('[FirebaseSync] 拉取進行中，跳過推送');
    return;
  }
  const force = !!(opts && opts.force);
  if (force) console.log('[FirebaseSync] ★ force=true：繞過 dirty-tracking 強制推送（_isEmptyCardsTemplate 等 isLocalOnlyKey 保護仍生效）');
  _pushing = true;
  const charId = getCharacterId();
  var _changedKeysForLog = [];  // ★ 收集本次推送有變更的 key（給 audit log 用）
  try {
    setBadge('☁ 推送中…', '#ffd700');

    // 1. localStorage（排除本機專屬 key + 超大值）
    const lsData = {};
    let skippedCount = 0;
    for (let i = 0; i < localStorage.length; i++){
      const k = localStorage.key(i);
      if (!k) continue;
      if (isLocalOnlyKey(k)) continue;
      var val = localStorage.getItem(k) || '';
      if (val.length > LS_MAX_VALUE_SIZE){
        if (isBase64Image(val)){
          // 圖片 → 壓縮後上傳
          var cVal = await compressImage(val, LS_MAX_VALUE_SIZE);
          if (cVal){
            lsData[k] = cVal;
            console.log('[FirebaseSync] LS 圖片已壓縮:', k, Math.round(val.length/1024)+'KB → '+Math.round(cVal.length/1024)+'KB');
            continue;
          }
          skippedCount++;
          console.log('[FirebaseSync] LS 圖片壓縮失敗，跳過:', k);
          continue;
        }
        // 非圖片大型資料（對話記錄、案例庫等）→ 正常放行，由 writeDataToFirestore 分批處理
      }
      lsData[k] = val;
    }
    if (skippedCount) console.log('[FirebaseSync] 共跳過', skippedCount, '筆超大資料');

    // ★ 把 lsData 拆成兩份：global keys 走 _global 路徑，其餘走 character 路徑
    var lsDataChar = {};
    var lsDataGlobal = {};
    for (var _lk in lsData){
      if (isGlobalLsKey(_lk)) lsDataGlobal[_lk] = lsData[_lk];
      else lsDataChar[_lk] = lsData[_lk];
    }

    const charRef = getUserCharRef(charId);
    const lsRef = charRef.collection('localStorage');
    const lsPath = lsRef.path;

    // ★ Dirty-tracking：只推送真正有改變的資料（force=true 時繞過）
    var lsChanged = _filterChanged(lsPath, lsDataChar, force);
    var lsCount = 0;
    if (Object.keys(lsChanged).length > 0){
      _changedKeysForLog = _changedKeysForLog.concat(Object.keys(lsChanged));  // ★ for audit
      lsCount = await writeDataToFirestore(lsRef, lsChanged);
      // 成功後記住所有資料的簽名（包括沒改變的）
      _recordSigs(lsPath, lsDataChar);
      // ★ LWW: 把這批 changed keys 的時間戳推到 <charRef>/_meta/lsTs.ts
      try {
        var _tsUpdates = {};
        for (var _ck in lsChanged) {
          // dot-path 寫入 nested map（key 不含「.」才安全；本專案的 LS keys 沒在用點號）
          _tsUpdates['ts.' + _ck] = _localTsMap[_ck] || Date.now();
        }
        var _tsDocRef = charRef.collection('_meta').doc('lsTs');
        try {
          await _tsDocRef.update(_tsUpdates);
        } catch(_updErr) {
          // 文件不存在 → 用整個 _localTsMap seed（含本機所有已知 ts，避免後續 update 又找不到 field）
          // 注意：set merge 對 nested map 不會 deep-merge，會整個 replace ts；所以一定要 seed 完整。
          await _tsDocRef.set({ ts: Object.assign({}, _localTsMap) }, { merge: true });
        }
      } catch(_tsErr) {
        console.warn('[FirebaseSync] LWW ts 寫入失敗', _tsErr.message || _tsErr);
      }
      // ★ 等伺服器消化
      try { await fsDb.waitForPendingWrites(); } catch(e){}
      await delay(WRITE_LONG_PAUSE_MS);
    } else {
      // 無變更，記住簽名但不寫入
      _recordSigs(lsPath, lsDataChar);
    }

    // ★ ★ ★ 全公司共享 LS keys：推到 users/<tenant>/_global/localStorage（不依主角）
    //   v2 架構：每個 key 寫獨立 doc（不再 bundle 成 main doc）
    //   原因：bundle 寫入用 wb.set 會覆蓋整個 doc — 兩個裝置並行 push 時會互相覆蓋對方的 keys
    //   per-key docs 各自獨立，A 推 key1、B 推 key2 不會相互影響
    if (Object.keys(lsDataGlobal).length > 0 && currentUserUid){
      try {
        var globalRef = fsDb.collection('users').doc(currentUserUid).collection('_global').doc('shared').collection('localStorage');
        var globalPath = globalRef.path;
        var globalChanged = _filterChanged(globalPath, lsDataGlobal, force);
        if (Object.keys(globalChanged).length > 0){
          _changedKeysForLog = _changedKeysForLog.concat(Object.keys(globalChanged).map(function(k){ return 'global:'+k; }));
          // ★ 每個 key 一個 doc — docId 用 encodeURIComponent 確保合法
          //   Doc 結構：{ key: <原始 key>, value: <字串值>, ts: <時間戳> }
          var globalCount = 0;
          for (var _gck in globalChanged){
            var _gcv = globalChanged[_gck];
            var _gcTs = _localTsMap[_gck] || Date.now();
            var docId = encodeURIComponent(_gck).substring(0, 1400);
            try {
              await globalRef.doc(docId).set({
                key: _gck,
                value: _gcv,
                ts: _gcTs
              });
              globalCount++;
            } catch(_perKeyErr){
              console.warn('[FirebaseSync] global push 單 key 失敗', _gck, _perKeyErr.message || _perKeyErr);
            }
          }
          _recordSigs(globalPath, lsDataGlobal);
          console.log('[FirebaseSync] ★ 全公司共享（per-key）：推送', globalCount, '筆 global LS keys（', Object.keys(globalChanged).join(', '), '）');
          try { await fsDb.waitForPendingWrites(); } catch(e){}
          await delay(WRITE_LONG_PAUSE_MS);
        } else {
          _recordSigs(globalPath, lsDataGlobal);
        }
      } catch(_globalPushErr){
        console.warn('[FirebaseSync] global push 失敗', _globalPushErr.message || _globalPushErr);
      }
    }

    // 2. IndexedDB（只推送 IDB_LIST，不推送音效 DB）
    let idbCount = 0;
    for (const idbInfo of IDB_LIST){
      try {
        const idb = await idbOpen(idbInfo.dbName, idbInfo.dbVer, idbInfo.stores);
        for (const storeName of idbInfo.stores){
          var rawEntries = await idbGetAllEntries(idb, storeName);
          // ★ 過濾掉音效和 blob 資料（以 blob_ / bgm_ 開頭的 key）
          var entries = {};
          var _audioSkipCount = 0;
          for (var ek in rawEntries){
            if (ek.indexOf('blob_') === 0 || ek.indexOf('bgm_') === 0){
              _audioSkipCount++;
              continue;
            }
            entries[ek] = rawEntries[ek];
          }
          if (_audioSkipCount > 0) console.log('[FirebaseSync] 跳過音效資料:', _audioSkipCount, '筆');
          var entryCount = Object.keys(entries).length;
          if (entryCount === 0) continue;
          const storeRef = charRef.collection('idb_' + idbInfo.dbName + '_' + storeName);
          const idbPath = storeRef.path;
          // ★ Dirty-tracking：只推送有變更的 IDB 資料（force=true 時繞過）
          var idbChanged = _filterChanged(idbPath, entries, force);
          if (Object.keys(idbChanged).length === 0){
            _recordSigs(idbPath, entries);
            continue;
          }
          // ★ for audit：把 IDB 變更的 key 也記下來（前綴避免和 LS key 撞名）
          _changedKeysForLog = _changedKeysForLog.concat(
            Object.keys(idbChanged).map(function(k){ return 'idb:' + idbInfo.dbName + '/' + storeName + '/' + k; })
          );
          const n = await writeDataToFirestore(storeRef, idbChanged);
          _recordSigs(idbPath, entries);
          idbCount += n;
        }
        idb.close();
      } catch(e){
        console.log('[FirebaseSync] IDB 推送跳過', idbInfo.dbName, e.message || e);
      }
    }

    // ★ IDB 寫入後再等一次伺服器消化
    try { await fsDb.waitForPendingWrites(); } catch(e){}

    // 更新 metadata
    await charRef.set({ updatedAt: Date.now(), charId: charId, email: currentUserEmail || '' }, { merge: true });

    // ★ 寫 audit log（只在有實際變更時）
    if (lsCount > 0 || idbCount > 0) {
      _writeAuditLog(charId, lsCount, idbCount, _changedKeysForLog).catch(function(){});
    }

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
  } finally {
    _pushing = false;
  }
}

function schedulePush(){
  if (syncTimer) clearTimeout(syncTimer);
  // ★ 拉取進行中 → 不要立即排程 push，避免覆蓋雲端真資料
  //   等 pull 結束後第一次有人改 LS 才會 schedulePush
  if (_pullingFromCloud){
    return;
  }
  syncTimer = setTimeout(pushToCloud, SYNC_DEBOUNCE_MS);
}

localStorage.setItem = function(k, v){
  _origSet(k, v);
  if (!isLocalOnlyKey(k)) {
    _recordLocalTs(k);
    schedulePush();
  }
};
localStorage.removeItem = function(k){ _origRemove(k); if(!isLocalOnlyKey(k)) schedulePush(); };

// === 拉取 ============================================================
async function pullFromCloud(){
  _pullingFromCloud = true; // ★ 阻擋 push 在 pull 期間競賽（避免覆蓋雲端真資料）
  try {
  // 用 user-scoped 路徑拉取
  var baseRef = currentUserUid
    ? fsDb.collection('users').doc(currentUserUid).collection('characters')
    : fsDb.collection('characters');
  const allSnap = await baseRef.get();
  let totalLS = 0, totalIDB = 0;

  // ★ 一次 pull 內 cache IDB 連線：避免每個 character × store 都重開 + 被擋升版反覆重試
  //   先成功一次就重複用同一個連線；一旦升版被擋就標記失敗、後續 fail-fast 不再重試
  //   （否則 blocked 的 IDBOpenDBRequest 會卡住後續 open，導致整個 pull for-loop hang）
  const _idbCache = new Map();
  const _idbFailed = new Set();
  async function _getIDB(idbInfo){
    if (_idbFailed.has(idbInfo.dbName)) {
      throw new Error('IDB ' + idbInfo.dbName + ' 本輪已標記失敗（升版被擋），跳過');
    }
    var cached = _idbCache.get(idbInfo.dbName);
    if (cached) return cached;
    try {
      var db = await idbOpenOrCreate(idbInfo.dbName, idbInfo.dbVer, idbInfo.stores);
      _idbCache.set(idbInfo.dbName, db);
      return db;
    } catch(e) {
      _idbFailed.add(idbInfo.dbName);
      throw e;
    }
  }

  for (const charDoc of allSnap.docs){
    const charId = charDoc.id;
    const charRef = baseRef.doc(charId);

    // 1. localStorage（LWW：cloudTs > localTs 才覆蓋；C 段空樣板救援保留作為 fallback）
    try {
      const lsData = await readDataFromFirestore(charRef.collection('localStorage'));
      // ★ LWW: 抓雲端時間戳 map（沒有就視為空，每個 key 的雲端 ts=0）
      //   ★★ 必須 source:'server'：Firestore SDK 預設會吃 cache，會讓 pull 讀到舊版的
      //       _meta/lsTs（缺最近 push 進去的 keys），導致 LWW 比較時以為「雲端沒 ts =
      //       cTs=0」→ 全部走「本地較新」跳過。強制走 server 才能拿到真實時間戳。
      var cloudTs = {};
      try {
        var _tsSnap = await charRef.collection('_meta').doc('lsTs').get({ source: 'server' });
        if (_tsSnap.exists) cloudTs = (_tsSnap.data() && _tsSnap.data().ts) || {};
      } catch(_tsReadErr) { /* 沒 ts doc 或網路問題就用空 map */ }

      var _skipCount = 0, _quotaSkipCount = 0, _quotaSkipKeys = [];
      var _cardsRescueCount = 0, _overwriteCount = 0;
      for (const [k, v] of Object.entries(lsData)){
        // ★ 全公司共享 keys 不在這裡處理 —— 之後從 _global 統一拉
        //   即使該 char 的雲端路徑下仍有舊版資料（從 v3 之前累積），也跳過避免亂蓋
        if (isGlobalLsKey(k)) continue;

        var existingVal = localStorage.getItem(k);

        // ★ castle_cards_v1 特例（C 段救援，backwards compat fallback）：
        //   本地是空樣板 + 雲端是真實資料 → 用雲端覆蓋。
        //   必須在 isLocalOnlyKey 之前處理 — 因為 isLocalOnlyKey 在本地空樣板時回 true
        //   （那是 push 端的「禁推」語意），會讓這條雲端救援路徑永遠到不了。
        if (k === 'castle_cards_v1'
            && _isEmptyCardsTemplate(existingVal)
            && _isRealCardsData(v)){
          try {
            _origSet(k, v);
            _localTsMap[k] = cloudTs[k] || Date.now();
            totalLS++;
            _cardsRescueCount++;
            continue;
          } catch(qe){
            _quotaSkipCount++;
            _quotaSkipKeys.push(k + '(' + Math.round((v||'').length/1024) + 'KB)');
            continue;
          }
        }

        // ★★★ motiv_archive 特殊保護：MERGE 而非覆蓋（避免雲端舊版把本地新存的月份吃掉）
        //     雲端永遠只能「新增本地沒有的月份」，絕對不能刪除或覆蓋本地已有的月份
        //     涵蓋：新版全局 'motiv_archive' + 舊版 'char_<id>_motiv_archive'
        if (k === 'motiv_archive' || /^char_.+_motiv_archive$/.test(k)){
          try {
            var localObj = {};
            try { if (existingVal) localObj = JSON.parse(existingVal) || {}; } catch(e1){}
            var cloudObj = {};
            try { cloudObj = (typeof v === 'string') ? (JSON.parse(v) || {}) : (v || {}); } catch(e2){}
            // Merge：本地優先（本地有的月份保留），雲端只補本地沒有的
            var merged = {};
            // 先複製雲端的（補進可能缺的月份）
            Object.keys(cloudObj).forEach(function(mk){ merged[mk] = cloudObj[mk]; });
            // 再複製本地的（覆蓋雲端，本地永遠優先）
            var addedFromCloud = 0;
            Object.keys(localObj).forEach(function(mk){ merged[mk] = localObj[mk]; });
            // 計算雲端補了幾個本地沒有的月份
            Object.keys(cloudObj).forEach(function(mk){ if (!localObj[mk]) addedFromCloud++; });

            var localKeys = Object.keys(localObj).length;
            var mergedKeys = Object.keys(merged).length;

            if (mergedKeys > localKeys) {
              // 雲端有本地沒有的月份 → 寫回 merged 版本
              try {
                _origSet(k, JSON.stringify(merged));
                _localTsMap[k] = Date.now();
                console.log('[FirebaseSync] motiv_archive 合併：本地 '+localKeys+' 個月，雲端補 '+addedFromCloud+' 個月，合計 '+mergedKeys+' 個月');
                totalLS++;
              } catch(qe2){
                _quotaSkipCount++;
                _quotaSkipKeys.push(k + '(merge)');
              }
            } else {
              console.log('[FirebaseSync] motiv_archive 保護：本地已有全部 '+localKeys+' 個月份，跳過雲端覆蓋');
            }
            continue;
          } catch(eMerge){
            console.warn('[FirebaseSync] motiv_archive merge 失敗，跳過', eMerge);
            continue;
          }
        }

        if (isLocalOnlyKey(k)) continue;

        var cTs = cloudTs[k] || 0;
        var lTs = _localTsMap[k] || 0;
        var valSize = (v || '').length;

        // 本地有值 → LWW 比較
        if (existingVal !== null && existingVal !== '') {
          if (cTs > lTs) {
            // 雲端較新 → 覆蓋本地（保留原本的容量預檢）
            if (valSize > 200 * 1024) {
              try {
                var testKeyA = '__fs_space_test__';
                _origSet(testKeyA, v);
                _origRemove(testKeyA);
              } catch(spaceErr) {
                _quotaSkipCount++;
                _quotaSkipKeys.push(k + '(' + Math.round(valSize/1024) + 'KB)');
                continue;
              }
            }
            try {
              _origSet(k, v);
              _localTsMap[k] = cTs;
              totalLS++;
              _overwriteCount++;
            } catch(qe){
              _quotaSkipCount++;
              _quotaSkipKeys.push(k + '(' + Math.round(valSize/1024) + 'KB)');
            }
          } else {
            // 本地較新或同時 → 跳過
            _skipCount++;
          }
          continue;
        }

        // 本地空 → 從雲端補入（保留原本的容量預檢）
        if (valSize > 200 * 1024) {
          try {
            var testKeyB = '__fs_space_test__';
            _origSet(testKeyB, v);
            _origRemove(testKeyB);
          } catch(spaceErr) {
            _quotaSkipCount++;
            _quotaSkipKeys.push(k + '(' + Math.round(valSize/1024) + 'KB)');
            continue;
          }
        }
        try {
          _origSet(k, v);
          _localTsMap[k] = cTs || Date.now();
          totalLS++;
        } catch(qe){
          _quotaSkipCount++;
          _quotaSkipKeys.push(k + '(' + Math.round(valSize/1024) + 'KB)');
        }
      }
      if (_skipCount > 0) console.log('[FirebaseSync] [' + charId + '] 跳過覆蓋', _skipCount, '筆（本地較新）');
      if (_overwriteCount > 0) console.log('[FirebaseSync] [' + charId + '] LWW 雲端覆蓋本地', _overwriteCount, '筆（雲端較新）');
      if (_quotaSkipCount > 0) console.log('[FirebaseSync] [' + charId + '] LS 空間不足，跳過', _quotaSkipCount, '筆');
      if (_cardsRescueCount > 0) console.log('[FirebaseSync] [' + charId + '] castle_cards_v1 從雲端覆蓋本地空樣板');
      if (totalLS > 0) console.log('[FirebaseSync] [' + charId + '] 從雲端補入', totalLS, '筆');
    } catch(e){
      // 可能舊格式（v3），嘗試讀取舊結構
      const d = charDoc.data();
      if (d && d.data){
        var _v3Skip = 0;
        for (const [k, v] of Object.entries(d.data)){
          if (isLocalOnlyKey(k)) continue;
          var existingV3 = localStorage.getItem(k);
          if (existingV3 !== null && existingV3 !== '') {
            _v3Skip++;
            continue;
          }
          try { _origSet(k, v); totalLS++; } catch(qe){}
        }
        if (_v3Skip > 0) console.log('[FirebaseSync] [' + charId + '] v3 跳過覆蓋', _v3Skip, '筆');
      }
    }

    // 2. IndexedDB — 透過 _getIDB 取得（本輪 cache + fail-fast）
    for (const idbInfo of IDB_LIST){
      for (const storeName of idbInfo.stores){
        try {
          const collName = 'idb_' + idbInfo.dbName + '_' + storeName;
          const entries = await readDataFromFirestore(charRef.collection(collName));
          if (Object.keys(entries).length === 0) continue;
          const idb = await _getIDB(idbInfo);
          await idbPutEntries(idb, storeName, entries);
          totalIDB += Object.keys(entries).length;
          // ★ 不在這 close — 連線是本輪共用，pull 結束後統一關閉
        } catch(e){
          console.log('[FirebaseSync] IDB 拉取跳過', idbInfo.dbName, storeName, e.message || e);
        }
      }
    }
  }

  // ★ 關閉本輪 cache 起來的所有 IDB 連線
  for (const _db of _idbCache.values()) {
    try { _db.close(); } catch(_e){}
  }

  // ★ ★ ★ 全公司共享 LS keys：從 users/<tenant>/_global/shared/localStorage 拉
  //   v3 策略：「雲端比本地大才覆蓋」 — byte size 比較
  //   原因：雲端可能被 GH Pages 預設值寫亂（空殼），盲目 cloud-wins 會把 localhost 真資料蓋掉
  //   邏輯：cloud.length > local.length → 覆蓋（雲端含更多資料）
  //         cloud.length <= local.length → 跳過（雲端是空殼或同步狀態）
  //   保證：真資料一定不會被空殼蓋掉；同時雲端有新資料時也能補進來。
  if (currentUserUid){
    try {
      var globalRef = fsDb.collection('users').doc(currentUserUid).collection('_global').doc('shared').collection('localStorage');
      var globalSnap = await globalRef.get({ source: 'server' });
      var _globalLsCount = 0, _globalQuotaCount = 0, _globalSkippedCount = 0;
      var _globalKeysOverwritten = [], _globalKeysSkipped = [];
      globalSnap.forEach(function(docSnap){
        var d = docSnap.data();
        if (!d || typeof d.value !== 'string' || !d.key) {
          // 跳過 v1 的 main / chunk 舊格式（已淘汰）
          return;
        }
        var _gExisting = localStorage.getItem(d.key) || '';
        var localSize = _gExisting.length;
        var cloudSize = d.value.length;
        // ★ 防呆：雲端比本地小 → 不覆蓋（避免空殼蓋掉真資料）
        if (cloudSize <= localSize && localSize > 0){
          _globalSkippedCount++;
          _globalKeysSkipped.push(d.key + '(c:' + cloudSize + ' ≤ l:' + localSize + ')');
          return;
        }
        try {
          _origSet(d.key, d.value);
          _localTsMap[d.key] = d.ts || Date.now();
          totalLS++;
          _globalLsCount++;
          _globalKeysOverwritten.push(d.key);
        } catch(_qe){
          _globalQuotaCount++;
        }
      });
      if (_globalLsCount > 0 || _globalSkippedCount > 0 || _globalQuotaCount > 0){
        console.log('[FirebaseSync] ★ 全公司共享（size-aware）：覆蓋 ' + _globalLsCount + ' 筆 [' + _globalKeysOverwritten.join(', ') + ']，跳過 ' + _globalSkippedCount + ' 筆（雲端較小）[' + _globalKeysSkipped.join(', ') + ']，quota 失敗 ' + _globalQuotaCount + ' 筆');
      }
      // ★ 重要：把雲端值的簽名記到 _lastPushedSig，這樣下次 push 才不會把本地相同資料再推回去
      //   否則 dirty tracking 認為「都變了」→ 全推 → 空殼覆蓋雲端
      try {
        var _gSigMap = {};
        globalSnap.forEach(function(docSnap){
          var d = docSnap.data();
          if (d && typeof d.value === 'string' && d.key){
            _gSigMap[d.key] = d.value;
          }
        });
        _recordSigs(globalRef.path, _gSigMap);
      } catch(_e){}
    } catch(_globalPullErr){
      console.warn('[FirebaseSync] global pull 失敗', _globalPullErr.message || _globalPullErr);
    }
  }

  // ★ LWW: 把這輪 pull 中更新過的 _localTsMap 持久化到 LS（debounce 不適用，pull 結束直接寫）
  if (_tsSaveTimer) { clearTimeout(_tsSaveTimer); _tsSaveTimer = null; }
  _saveLocalTsMap();

  console.log('[FirebaseSync] 雲端載入 localStorage:', totalLS, ' IndexedDB:', totalIDB);
  window.dispatchEvent(new Event('firebase-sync-ready'));
  } finally {
    _pullingFromCloud = false; // ★ 拉取完成，解鎖 schedulePush
  }
}

// === 即時監聽（只監聽主角 metadata 變化）==============================
function setupRealtime(){
  var baseRef = currentUserUid
    ? fsDb.collection('users').doc(currentUserUid).collection('characters')
    : fsDb.collection('characters');
  baseRef.onSnapshot(snap => {
    var changes = [];
    snap.docChanges().forEach(ch => {
      if (ch.type === 'removed') return;
      changes.push(ch.doc.id);
    });
    if (changes.length > 0) console.log('[FirebaseSync] 偵測到雲端更新:', changes.length, '筆');
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

    // ★ 靜音 Firestore SDK 內部 log，避免 resource-exhausted 等
    //   SDK 的 WebChannel write stream 重試機制會產生無害但惱人的錯誤
    //   資料已成功推送，這些只是 SDK 內部重試的副作用
    try { firebase.firestore.setLogLevel('silent'); } catch(e){}

    // ★ 使用匿名登入 + 同步碼（syncCode）來識別身份
    // 同步碼存在 localStorage，所有裝置輸入同一組碼就能同步
    setBadge('☁ 登入中…', '#ffd700');
    auth.onAuthStateChanged(async user => {
      if (!user){
        try { await auth.signInAnonymously(); }
        catch(e){
          console.error('[FirebaseSync] 匿名登入失敗', e);
          setBadge('❌ 登入失敗\n' + (e.code||e.message), '#ff6666');
        }
        return;
      }
      // 已登入（匿名）
      console.log('[FirebaseSync] 已匿名登入', user.uid, IS_ADMIN ? '(管理者)' : '');

      // ★ 取得同步身份（重構後 v2 — 統一 tenant 模式）：
      //   全公司用同一個 tenant，所有人共用同一份雲端空間
      //   不同主角的資料在 character 層級分開（不在 tenant 層級）
      //
      //   優先順序：
      //   1. 已手動設過 firebase_sync_code → 沿用（向下相容老用戶）
      //   2. 否則 → 用 DEFAULT_TENANT
      //
      //   舊版的「auto-derive 'role_<charId>'」已移除，因為它造成
      //   「同主角不同瀏覽器看到不同資料」的問題（無痕視窗等）。
      //   現在不論在哪個瀏覽器、哪台裝置登入同一個主角，都會看到同一份資料。
      var DEFAULT_TENANT = 'applaud';  // 改用 applaud（你正常瀏覽器目前使用的 tenant，所有最新資料都在這）
      var syncCode = localStorage.getItem('firebase_sync_code') || DEFAULT_TENANT;
      var fromManual = !!localStorage.getItem('firebase_sync_code');
      console.log('[FirebaseSync] 使用 tenant:', syncCode, fromManual ? '(手動設定)' : '(預設)');
      currentUserUid = syncCode;
      currentUserEmail = syncCode;

      // 徽章用主角名顯示（更直覺，使用者只需要知道「我是誰」，不需要看到 tenant 內部識別碼）
      var badgeLabel = '☁ ' + (getCharacterId() || syncCode);
      setBadge(badgeLabel + '\n拉取中…', '#00ff88');
      try {
        // ★ 嘗試從舊路徑遷移
        try { await migrateFromAnonymous(); } catch(e){ console.warn('[FirebaseSync] 遷移跳過', e); }

        await pullFromCloud();
        ready = true;
        setupRealtime();
        if (!IS_ADMIN) setInterval(pushToCloud, SYNC_INTERVAL_MS);
        setBadge(IS_ADMIN ? '☁ 管理者' : badgeLabel, '#00ff88');
        setTimeout(() => { if (badgeEl) badgeEl.style.opacity = '0.3'; }, 2000);
        if (!IS_ADMIN) setTimeout(pushToCloud, 15000);
      } catch(e){
        console.error('[FirebaseSync] 初始化失敗', e);
        var errMsg = e.code || '';
        if (e.message) errMsg += (errMsg ? ' ' : '') + e.message;
        if (errMsg.indexOf('permission') !== -1 || errMsg.indexOf('PERMISSION') !== -1) {
          errMsg = '權限不足\n請檢查 Firestore 安全規則';
        }
        setBadge('❌ 同步失敗\n' + errMsg, '#ff6666');
      }
    });
  } catch(err){
    console.error('[FirebaseSync] SDK 載入失敗', err);
    setBadge('❌ SDK 載入失敗\n' + (err.message||err), '#ff6666');
  }
}

// === 同步碼 UI ==========================================================
function showSyncCodeBtn(){
  ensureBadge();
  var apply = function(){
    if (!badgeEl) return;
    badgeEl.style.pointerEvents = 'auto';
    badgeEl.style.cursor = 'pointer';
    badgeEl.style.opacity = '1';
    badgeEl.style.background = 'linear-gradient(135deg, rgba(66,133,244,.95), rgba(25,118,210,.95))';
    badgeEl.style.color = '#fff';
    badgeEl.style.borderColor = 'rgba(66,133,244,.8)';
    badgeEl.style.padding = '10px 16px';
    badgeEl.style.fontSize = '14px';
    badgeEl.style.borderRadius = '10px';
    badgeEl.style.fontWeight = '600';
    badgeEl.style.boxShadow = '0 2px 12px rgba(66,133,244,.4)';
    badgeEl.style.maxWidth = '300px';
    badgeEl.style.fontFamily = '-apple-system, sans-serif';
    badgeEl.innerHTML = '🔑 設定同步碼<br><span style="font-size:11px;font-weight:400;opacity:.85;">點此設定，多台裝置用同一組碼即可同步</span>';
    badgeEl.onclick = promptSyncCode;
  };
  if (badgeEl) apply(); else document.addEventListener('DOMContentLoaded', apply);
}

function promptSyncCode(){
  var existing = localStorage.getItem('firebase_sync_code') || '';
  var code = prompt(
    '🔑 設定同步碼\n\n'
    + '在所有裝置輸入同一組碼，資料就會自動同步。\n'
    + '建議用英文+數字，例如：ivan2026\n\n'
    + (existing ? '目前同步碼：' + existing + '\n' : '')
    + '請輸入你的同步碼：',
    existing || ''
  );
  if (code === null) return; // 取消
  code = code.trim();
  if (!code) { alert('同步碼不能是空的！'); return; }
  if (code.length < 4) { alert('同步碼至少要 4 個字元！'); return; }
  // 清理特殊字元（Firestore doc ID 不能有 /）
  code = code.replace(/[\/\\.\s]/g, '_');
  localStorage.setItem('firebase_sync_code', code);
  // 重新觸發同步流程
  currentUserUid = code;
  currentUserEmail = code;
  setBadge('☁ ' + code + '\n連線中…', '#ffd700');
  if (badgeEl) { badgeEl.style.pointerEvents = 'none'; badgeEl.onclick = null;
    badgeEl.style.background = 'rgba(0,0,0,.7)'; badgeEl.style.boxShadow = 'none';
    badgeEl.style.fontSize = '11px'; badgeEl.style.padding = '4px 8px'; }
  // 啟動同步
  startSyncAfterCode();
}

async function startSyncAfterCode(){
  try {
    try { await migrateFromAnonymous(); } catch(e){ console.warn('[FirebaseSync] 遷移跳過', e); }
    await pullFromCloud();
    ready = true;
    setupRealtime();
    if (!IS_ADMIN) setInterval(pushToCloud, SYNC_INTERVAL_MS);
    var code = localStorage.getItem('firebase_sync_code') || '';
    setBadge(IS_ADMIN ? '☁ 管理者' : '☁ ' + code, '#00ff88');
    setTimeout(() => { if (badgeEl) badgeEl.style.opacity = '0.3'; }, 2000);
    if (!IS_ADMIN) setTimeout(pushToCloud, 15000);
  } catch(e){
    console.error('[FirebaseSync] 同步失敗', e);
    setBadge('❌ 同步失敗\n' + (e.code || e.message || e), '#ff6666');
  }
}

function changeSyncCode(){
  promptSyncCode();
}

// === 從舊匿名路徑遷移資料 =============================================
async function migrateFromAnonymous(){
  if (!currentUserUid) return;
  // 檢查新路徑是否已有資料
  var newRef = fsDb.collection('users').doc(currentUserUid).collection('characters');
  var newSnap = await newRef.limit(1).get();
  if (!newSnap.empty) {
    console.log('[FirebaseSync] 新路徑已有資料，跳過遷移');
    return;
  }
  // 檢查舊路徑是否有資料
  var oldRef = fsDb.collection('characters');
  var oldSnap = await oldRef.get();
  if (oldSnap.empty) {
    console.log('[FirebaseSync] 舊路徑也沒資料，跳過遷移');
    return;
  }
  console.log('[FirebaseSync] 開始從舊路徑遷移資料...');
  setBadge('☁ 遷移資料中…', '#ffd700');
  // 把舊路徑的每個 character 複製到新路徑
  for (var cd of oldSnap.docs){
    var charId = cd.id;
    var charData = cd.data();
    // 複製主文件
    await newRef.doc(charId).set(charData);
    // 複製子 collection：localStorage, idb_*
    var subNames = ['localStorage'];
    IDB_LIST.concat(IDB_LIST_PULL_ONLY).forEach(function(info){
      info.stores.forEach(function(s){
        subNames.push('idb_' + info.dbName + '_' + s);
      });
    });
    for (var sn of subNames){
      try {
        var subSnap = await oldRef.doc(charId).collection(sn).get();
        for (var subDoc of subSnap.docs){
          await newRef.doc(charId).collection(sn).doc(subDoc.id).set(subDoc.data());
        }
      } catch(e){ /* 子集合不存在就跳過 */ }
    }
  }
  console.log('[FirebaseSync] 遷移完成！');
}

// ★ 給 iframe 內的頁面（例如 ai-advisor.html）寫 AI 對話紀錄用
//   每次 user 發訊 / AI 回覆都呼叫一次，寫一筆到 ai_chats collection
async function logAiChat(data){
  try {
    if (!fsDb || !ready) return;
    await fsDb.collection('ai_chats').add(Object.assign({
      ts: Date.now(),
      tsServer: firebase.firestore.FieldValue.serverTimestamp(),
      syncCode: currentUserUid || ''
    }, data || {}));
  } catch(e){
    console.warn('[FirebaseSync] AI chat log 寫入失敗（不影響聊天）', e && (e.code || e.message));
  }
}

window.firebaseSync = {
  push: pushToCloud,
  pull: pullFromCloud,
  changeSyncCode: changeSyncCode,
  logAiChat: logAiChat
};

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

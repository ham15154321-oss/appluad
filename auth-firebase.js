/* ============================================================
   赫綠設計學院 — 員工帳號登入模組 (auth-firebase.js)
   ------------------------------------------------------------
   - 與 firebase-sync.js 對齊：使用 compat SDK 10.12.2、相同 FIREBASE_CONFIG
   - 在 iframe 內不初始化（由 parent 統一處理）
   - 文件路徑：users/applaud/_global/accounts/{empNo}
   - 對外 API：
       window.authReady              Promise — Firebase + 匿名登入完成
       window.authLookup(empNo)      回傳 doc data 或 null
       window.authCreate({empNo,password,characterName})
       window.authVerify(empNo,password)
       window.authUpdateLastLogin(empNo)
       window.authListAll()          列出所有帳號（呼叫端自行驗證權限）
       window.authDeleteAccount(empNo)
       window.authResetPassword(empNo,newPassword)
   - 常數：
       window.ADMIN_USERS, window.SUPER_ADMIN
   ============================================================ */
(function(){
  // ★ iframe 內沿用 parent 的 API（如果就緒），不然 fall through 到自己初始化
  try {
    if (window.parent !== window) {
      try {
        if (window.parent.authReady) {
          window.authReady       = window.parent.authReady;
          window.authLookup      = window.parent.authLookup;
          window.authCreate      = window.parent.authCreate;
          window.authVerify      = window.parent.authVerify;
          window.authUpdateLastLogin = window.parent.authUpdateLastLogin;
          window.authListAll     = window.parent.authListAll;
          window.authDeleteAccount = window.parent.authDeleteAccount;
          window.authResetPassword = window.parent.authResetPassword;
          window.ADMIN_USERS     = window.parent.ADMIN_USERS;
          window.SUPER_ADMIN     = window.parent.SUPER_ADMIN;
          return;
        }
      } catch(_e){}
      // parent 沒就緒（或 cross-origin）→ 在 iframe 自己初始化（fall through）
    }
  } catch(e){}

  // ─── 常數 ───
  window.ADMIN_USERS = ['黃柏翰','許傑森','王志軒','楊雅晴','洪士德','黎禹歆','林昭宏','凃敏薰','蔡青倚'];
  window.SUPER_ADMIN = '黃柏翰';

  var FIREBASE_CONFIG = {
    apiKey: "AIzaSyDIJldvnAC50z4rNUO8I6tTNvXOKBwayx4",
    authDomain: "talent-map-e0c36.firebaseapp.com",
    projectId: "talent-map-e0c36",
    storageBucket: "talent-map-e0c36.firebasestorage.app",
    messagingSenderId: "784909396524",
    appId: "1:784909396524:web:c90bffd14fe7f2add8bf89",
    measurementId: "G-VTK71BX7YN"
  };

  var SDK_BASE = 'https://www.gstatic.com/firebasejs/10.12.2/';
  var SDK_FILES = [
    'firebase-app-compat.js',
    'firebase-auth-compat.js',
    'firebase-firestore-compat.js'
  ];
  var TENANT = 'applaud';

  function loadScript(src, timeoutMs){
    timeoutMs = timeoutMs || 10000;
    return new Promise(function(resolve, reject){
      // 如果 firebase-sync.js 已經載入過 SDK，跳過
      if (window.firebase && window.firebase.firestore && /firestore/.test(src)){ resolve(); return; }
      if (window.firebase && window.firebase.auth && /auth-compat/.test(src)){ resolve(); return; }
      if (window.firebase && /app-compat/.test(src)){ resolve(); return; }
      var s = document.createElement('script');
      s.src = src;
      var done = false;
      var timer = setTimeout(function(){
        if(!done){ done=true; reject(new Error('載入逾時 ' + src)); }
      }, timeoutMs);
      s.onload  = function(){ if(!done){ done=true; clearTimeout(timer); resolve(); } };
      s.onerror = function(){ if(!done){ done=true; clearTimeout(timer); reject(new Error('無法載入 ' + src)); } };
      document.head.appendChild(s);
    });
  }
  async function loadScripts(){
    for (var i=0; i<SDK_FILES.length; i++){
      await loadScript(SDK_BASE + SDK_FILES[i]);
    }
  }

  var _authApp = null;
  var _authDb  = null;
  var _authAuth = null;

  async function _init(){
    await loadScripts();
    if (!window.firebase) throw new Error('Firebase SDK 未載入');

    // 如果其它檔案（firebase-sync.js）已 initializeApp，沿用其 default app
    try {
      _authApp = firebase.app();
    } catch(_e){
      _authApp = firebase.initializeApp(FIREBASE_CONFIG);
    }
    _authDb   = firebase.firestore();
    _authAuth = firebase.auth();
    try { firebase.firestore.setLogLevel('silent'); } catch(_){}

    // 等待匿名登入完成
    await new Promise(function(resolve, reject){
      var settled = false;
      var unsub = _authAuth.onAuthStateChanged(async function(user){
        if (user){
          if (!settled){ settled = true; try{ unsub(); }catch(_){} resolve(); }
          return;
        }
        try {
          await _authAuth.signInAnonymously();
        } catch(e){
          if (!settled){ settled = true; try{ unsub(); }catch(_){} reject(e); }
        }
      });
      setTimeout(function(){
        if (!settled){ settled = true; try{ unsub(); }catch(_){} reject(new Error('Auth 連線逾時')); }
      }, 15000);
    });
  }

  // 啟動並把 Promise 暴露給外部
  window.authReady = _init().catch(function(err){
    console.error('[auth-firebase] init failed', err);
    throw err;
  });

  // ─── Firestore 路徑：
  //   users (col) / applaud (doc) / _global (col) / accounts (doc) / items (col) / {empNo}
  //   理由：Firestore 需偶數段 doc / 奇數段 collection，
  //         _global 是 collection、accounts 是 doc、items 是真正的 accounts collection
  function _accountsCol(){
    return _authDb.collection('users').doc(TENANT).collection('_global').doc('accounts').collection('items');
  }
  function _accountDocRef(empNo){
    return _accountsCol().doc(String(empNo).toLowerCase());
  }

  // ─── API ───
  window.authLookup = async function(empNo){
    if (!empNo) return null;
    await window.authReady;
    try {
      var snap = await _accountDocRef(empNo).get();
      if (!snap.exists) return null;
      return snap.data();
    } catch(e){
      console.error('[authLookup] error', e);
      throw e;
    }
  };

  window.authCreate = async function(opts){
    opts = opts || {};
    var empNo = String(opts.empNo || '').toLowerCase().trim();
    var password = String(opts.password || '');
    var characterName = String(opts.characterName || '').trim();
    if (!empNo) throw new Error('員工編號必填');
    if (!password) throw new Error('密碼必填');
    if (!characterName) throw new Error('角色名稱必填');
    await window.authReady;

    var isAdmin = (window.ADMIN_USERS || []).indexOf(characterName) !== -1;

    var docData = {
      empNo: empNo,
      password: password,
      characterName: characterName,
      isAdmin: isAdmin,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastLoginAt: firebase.firestore.FieldValue.serverTimestamp(),
      loginCount: 1
    };
    await _accountDocRef(empNo).set(docData);
    // 立即回讀（serverTimestamp 還是 null 也沒關係，前端只要拿到 isAdmin / characterName）
    return docData;
  };

  window.authVerify = async function(empNo, password){
    var data = await window.authLookup(empNo);
    if (!data) return null;
    if (String(data.password || '') !== String(password || '')) return false;
    return data;
  };

  window.authUpdateLastLogin = async function(empNo){
    if (!empNo) return;
    await window.authReady;
    try {
      await _accountDocRef(empNo).set({
        lastLoginAt: firebase.firestore.FieldValue.serverTimestamp(),
        loginCount: firebase.firestore.FieldValue.increment(1)
      }, { merge: true });
    } catch(e){
      console.warn('[authUpdateLastLogin] failed', e);
    }
  };

  window.authListAll = async function(){
    await window.authReady;
    try {
      var snap = await _accountsCol().get();
      var out = [];
      snap.forEach(function(d){
        var v = d.data();
        v._id = d.id;
        out.push(v);
      });
      // 依 empNo 排序
      out.sort(function(a,b){ return String(a.empNo||'').localeCompare(String(b.empNo||'')); });
      return out;
    } catch(e){
      console.error('[authListAll] error', e);
      throw e;
    }
  };

  window.authDeleteAccount = async function(empNo){
    if (!empNo) throw new Error('員工編號必填');
    await window.authReady;
    await _accountDocRef(empNo).delete();
    return true;
  };

  window.authResetPassword = async function(empNo, newPassword){
    if (!empNo) throw new Error('員工編號必填');
    if (!newPassword) throw new Error('新密碼必填');
    await window.authReady;
    await _accountDocRef(empNo).set({
      password: String(newPassword),
      passwordResetAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return true;
  };

})();

/* ═══════════ ★ ds146 AI 總帳（資料底座）═══════════
   10/29 Ivan：以前存檔找不到、紀錄會不見、token 花了對不了帳 → 每一筆 AI 產生的資料都要「有編號、存兩份、記花費、只加不刪」。
   做的事：
   1. 每一次 AI 呼叫（不管哪一頁）自動記一列到試算表「AI 用量總帳」：誰、哪一頁、型號、token、錄音秒數、約 NT$
   2. 所有要寫試算表的資料先放進「待送清單」（這台電腦的 IndexedDB：AiLedgerDB.outbox），送成功才拿掉；失敗自動重送
      每列帶編號，試算表 v2 照編號擋重複，所以重送不會變兩列
   3. 下載的 Word／Excel／備份檔，同時存一份到 Google 雲端硬碟「太空基地備份/YYYY-MM」，並記在「檔案目錄」
   4. AI 顧問的對話：每則全文寫進「AI 顧問對話」；瀏覽器裡被擠掉的舊對話先存進 AiLedgerDB.chatarch，不會再不見
   5. 寫進試算表前，手機號碼只留後 3 碼
   6. 每月 1 號（柏翰的電腦）自動把上個月的資料打包成一份備份檔存到雲端硬碟
   試算表網址、密語沿用面談檢核 ⚙ 設定（iv_checklist_v1.settings.sheetUrl / sheetKey）
*/
(function () {
  var W = window;
  if (W.LEDGER) return;
  var DEF_URL = 'https://script.google.com/macros/s/AKfycbwoAtxJSU3V533LGSyw9qpan9Bj5TawIQkV8XwB05R6b-UQyEb3n38KOAArIJlKnCYW/exec';
  var USD_TWD = 32, WHISPER_USD_HR = 0.111;
  var PRICE = { opus: [5, 25], sonnet: [3, 15], haiku: [1, 5] };
  var ADMIN = '黃柏翰';
  var HEAD = {
    'AI 用量總帳': ['時間', '誰', '頁面', '功能', '型號', '讀入 token', '寫出 token', '快取讀 token', '錄音秒數', '約 NT$', '參考編號', '列編號'],
    'AI 顧問對話': ['時間', '誰', '顧問', '話題編號', '誰說的', '字數', '內容（第 1 格）', '第 2 格', '第 3 格', '第 4 格', '訊息編號']
  };

  function ls() { try { return W.localStorage; } catch (e) { return null; } }
  function me() { try { return ls().getItem('activeCharacterId') || ''; } catch (e) { return ''; } }
  function cfg() {
    var o = {}; try { o = JSON.parse(ls().getItem('iv_checklist_v1') || '{}') || {}; } catch (e) {}
    var s = o.settings || {};
    return { url: s.sheetUrl === undefined ? DEF_URL : s.sheetUrl, key: s.sheetKey === undefined ? 'Ivan' : s.sheetKey };
  }
  function uid(p) { return (p || 'L') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function pad(n) { return ('0' + n).slice(-2); }
  function ts(t) { var d = new Date(t || Date.now()); return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function ym(t) { var d = new Date(t || Date.now()); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function hash(s) { s = String(s); var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  // 手機號碼只留後 3 碼：0912-345-678 → 0912-xxx-678
  function mask(s) { return String(s == null ? '' : s).replace(/(09\d{2})[\s-]?\d{3}[\s-]?(\d{3})(?!\d)/g, '$1-xxx-$2'); }
  function maskRow(r) { return (r || []).map(function (v) { return typeof v === 'string' ? mask(v) : v; }); }
  function split(s, n, k) { s = String(s || ''); var a = []; for (var i = 0; i < n; i++) a.push(s.slice(i * k, (i + 1) * k)); return a; }

  // ── IndexedDB：outbox（待送清單）、chatarch（被擠掉的舊對話）、meta ──
  var _dbp = null;
  function db() {
    if (_dbp) return _dbp;
    _dbp = new Promise(function (res, rej) {
      var r = indexedDB.open('AiLedgerDB', 1);
      r.onupgradeneeded = function (e) { var d = e.target.result; ['outbox', 'chatarch', 'meta'].forEach(function (s) { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); }); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { _dbp = null; rej(r.error); };
    });
    return _dbp;
  }
  function tx(store, mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(store, mode), st = t.objectStore(store), out = fn(st);
        t.oncomplete = function () { res((typeof IDBRequest !== 'undefined' && out instanceof IDBRequest) ? out.result : out); };
        t.onerror = function () { rej(t.error); }; t.onabort = function () { rej(t.error || new Error('寫入中止')); };
      });
    });
  }
  function put(store, k, v) { return tx(store, 'readwrite', function (st) { st.put(v, k); }); }
  function del(store, k) { return tx(store, 'readwrite', function (st) { st.delete(k); }); }
  function get(store, k) { return tx(store, 'readonly', function (st) { return st.get(k); }); }
  function all(store) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var out = [], c = d.transaction(store, 'readonly').objectStore(store).openCursor();
        c.onsuccess = function () { var cur = c.result; if (cur) { out.push({ k: cur.key, v: cur.value }); cur.continue(); } else res(out); };
        c.onerror = function () { rej(c.error); };
      });
    });
  }
  function meta(k, v) { if (v === undefined) return get('meta', k).catch(function () { return null; }); return put('meta', k, v).catch(function () {}); }

  // ── 待送清單 ──
  function enqueue(payload) {
    var id = uid('ob_');
    return put('outbox', id, { id: id, at: Date.now(), tries: 0, p: payload }).then(function () { soon(); return id; }, function (e) { console.warn('[ledger] 待送清單寫入失敗', e); });
  }
  var _t = null, _busy = false, _wait = 30000;
  function soon(ms) { clearTimeout(_t); _t = setTimeout(flush, ms == null ? 1500 : ms); }
  function post(payload) {
    var c = cfg(); if (!c.url) return Promise.reject(new Error('還沒設定試算表網址'));
    return fetch(c.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ key: c.key || '' }, payload)) })
      .then(function (r) { return r.text(); })
      .then(function (t) {
        var j = null; try { j = JSON.parse(t); } catch (e) {}
        if (j) { if (j.ok) return j; throw new Error(j.err || '試算表回錯誤'); }
        // 舊版（v1）試算表只會回 ok 文字：寫列算成功，其他動作要先更新試算表程式
        if (/^ok/.test(t) && (!payload.action || payload.action === 'rows')) return { ok: true, legacy: true };
        throw new Error(/^ok/.test(t) ? '試算表程式還是舊版，請照說明換成 v2' : String(t).slice(0, 80));
      });
  }
  function flush() {
    if (_busy) return Promise.resolve();
    try { var lk = +ls().getItem('ledger_flush_at') || 0; if (Date.now() - lk < 8000) { soon(9000); return Promise.resolve(); } ls().setItem('ledger_flush_at', String(Date.now())); } catch (e) {}
    _busy = true;
    return all('outbox').then(function (list) {
      list.sort(function (a, b) { return (a.v.at || 0) - (b.v.at || 0); });
      var i = 0;
      function next() {
        if (i >= list.length) return Promise.resolve();
        var it = list[i++].v;
        return post(it.p).then(function (r) {
          return del('outbox', it.id).then(function () { meta('lastOk', Date.now()); if (r && r.legacy) meta('legacy', Date.now()); }).then(next);
        }, function (e) {
          it.tries = (it.tries || 0) + 1; it.err = String(e && e.message || e); it.lastTry = Date.now();
          meta('lastErr', { at: Date.now(), msg: it.err });
          return put('outbox', it.id, it).then(function () { if (/Failed to fetch|NetworkError|Load failed|network/i.test(it.err)) return; return next(); });   // 斷網就先停，等等再送
        });
      }
      return next().then(function () {
        return all('outbox').then(function (rest) { _wait = rest.length ? Math.min(_wait * 2, 30 * 60000) : 30000; if (rest.length) soon(_wait); });
      });
    }).catch(function (e) { console.warn('[ledger] flush', e); soon(60000); })
      .then(function () { _busy = false; try { ls().removeItem('ledger_flush_at'); } catch (e) {} });
  }

  // ── 寫列（rids＝每列的編號，用來擋重複）──
  function rows(sheets, head, rids) {
    var s2 = {}; Object.keys(sheets || {}).forEach(function (k) { s2[k] = (sheets[k] || []).map(maskRow); });
    return enqueue({ action: 'rows', sheets: s2, head: head || {}, rids: rids || {} });
  }

  // ── AI 用量（每呼叫一次一列）──
  function pageName() {
    var f = (location.pathname.split('/').pop() || '').replace(/\?.*$/, '');
    try { f = decodeURIComponent(f); } catch (e) {}
    if (/interview-check/.test(f)) return (W.MODE === 'phone') ? '電話檢核' : '面談檢核';
    if (/meeting-track/.test(f)) return '會議作戰追蹤';
    if (/ai-advisor/.test(f)) return 'AI 顧問';
    if (/waterfall/.test(f)) return '瀑布（舊）';
    if (/人力發展|index/.test(f)) return '首頁';
    return f || '其他';
  }
  function feature() {
    try { if (W.curFeature && W.FEATURES && W.FEATURES[W.curFeature]) return W.FEATURES[W.curFeature].title || W.curFeature; } catch (e) {}
    return W.__aiFeature || '';
  }
  function ntd(model, inp, out, cacheW, cacheR, sec) {
    var k = /opus/.test(model) ? 'opus' : (/haiku/.test(model) ? 'haiku' : 'sonnet'), p = PRICE[k];
    var usd = (inp || 0) / 1e6 * p[0] + (cacheW || 0) / 1e6 * p[0] * 1.25 + (cacheR || 0) / 1e6 * p[0] * 0.1 + (out || 0) / 1e6 * p[1] + (sec || 0) / 3600 * WHISPER_USD_HR;
    return Math.round(usd * USD_TWD * 100) / 100;
  }
  function usage(o) {
    var rid = uid('u_'), sec = o.sec || 0, m = o.model || '';
    var money = /whisper/.test(m) ? Math.round(sec / 3600 * WHISPER_USD_HR * USD_TWD * 100) / 100 : ntd(m, o.in, o.out, o.cw, o.cr, 0);
    var row = [ts(), o.who || me(), o.page || pageName(), o.feature || feature(), m, (o.in || 0) + (o.cw || 0), o.out || 0, o.cr || 0, Math.round(sec), money, o.ref || W.__aiRef || '', rid];
    try { var m2 = JSON.parse(ls().getItem('ledger_month_v1') || '{}'); if (m2.ym !== ym()) m2 = { ym: ym(), ntd: 0, n: 0 }; m2.ntd += money; m2.n++; ls().setItem('ledger_month_v1', JSON.stringify(m2)); } catch (e) {}
    return rows({ 'AI 用量總帳': [row] }, { 'AI 用量總帳': HEAD['AI 用量總帳'] }, { 'AI 用量總帳': [rid] });
  }

  // ── 攔住所有 AI 呼叫，自動記用量（不改各頁原本的程式）──
  var _of = W.fetch;
  function wrap(base) {
    var wrapped = function (u, o) {
      var p = base.apply(this, arguments);
      try {
        var url = String((u && u.url) || u || '');
        if (/anthropic-proxy[^\/]*\/v1\/messages/.test(url)) {
          var model = ''; try { model = JSON.parse(o && o.body || '{}').model || ''; } catch (e) {}
          p.then(function (r) { if (!r || !r.ok) return; r.clone().json().then(function (d) { var x = (d && d.usage) || {};
            usage({ model: model || (d && d.model) || '', in: x.input_tokens || 0, out: x.output_tokens || 0, cw: x.cache_creation_input_tokens || 0, cr: x.cache_read_input_tokens || 0 }); }).catch(function () {}); }, function () {});
        } else if (/anthropic-proxy[^\/]*\/groq\/audio\/transcriptions/.test(url)) {
          p.then(function (r) { if (!r || !r.ok) return; r.clone().json().then(function (d) { usage({ model: 'whisper-large-v3', sec: (d && d.duration) || 0 }); }).catch(function () {}); }, function () {});
        }
      } catch (e) {}
      return p;
    };
    wrapped.__ledger = 1; return wrapped;
  }
  // 有別的程式後來又包了一層 fetch，就再包回來（前 2 分鐘每 3 秒看一次）
  function ensureWrap() { try { if (W.fetch && !W.fetch.__ledger) W.fetch = wrap(W.fetch); } catch (e) {} }
  ensureWrap(); var _ew = 0, _ewt = setInterval(function () { ensureWrap(); if (++_ew > 40) clearInterval(_ewt); }, 3000);

  // ── AI 顧問對話：每則全文一列 ──
  function chat(o) {
    var rid = o.id || ('m_' + hash((o.who || me()) + '|' + (o.feature || '') + '|' + (o.time || '') + '|' + o.role + '|' + String(o.text || '').slice(0, 200)));
    var t = mask(o.text || ''), parts = split(t, 4, 45000);
    var row = [o.time ? ts(o.time) : ts(), o.who || me(), o.featureTitle || o.feature || '', o.topic || '', o.role === 'user' ? '提問' : 'AI 回答', t.length].concat(parts).concat([rid]);
    return rows({ 'AI 顧問對話': [row] }, { 'AI 顧問對話': HEAD['AI 顧問對話'] }, { 'AI 顧問對話': [rid] });
  }
  // 被擠掉的舊對話：先存進這台電腦的長期資料庫（不刪）
  function archiveChat(key, msgs) {
    if (!msgs || !msgs.length) return Promise.resolve();
    return get('chatarch', key).catch(function () { return null; }).then(function (old) {
      var a = Array.isArray(old) ? old : [], seen = {};
      a.forEach(function (m) { seen[hash(JSON.stringify(m))] = 1; });
      msgs.forEach(function (m) { var h = hash(JSON.stringify(m)); if (!seen[h]) { seen[h] = 1; a.push(m); } });
      return put('chatarch', key, a);
    });
  }
  function chatArchive(key) { return get('chatarch', key).catch(function () { return null; }).then(function (a) { return Array.isArray(a) ? a : []; }); }

  // ── 檔案存雲端硬碟 ──
  function b64(buf) { var b = new Uint8Array(buf), s = '', CH = 0x8000; for (var i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH)); return btoa(s); }
  function file(o) {
    // o: {name, text | blob | b64, mime, kind, folder, rid}
    var base = { action: 'file', name: o.name, mime: o.mime || 'application/octet-stream', kind: o.kind || '', folder: o.folder || ym(), who: me(), rid: o.rid || ('f_' + hash(o.name + '|' + Date.now())) };
    if (o.b64) return enqueue(Object.assign(base, { b64: o.b64 }));
    if (o.blob) return o.blob.arrayBuffer().then(function (buf) { return enqueue(Object.assign(base, { b64: b64(buf) })); });
    return enqueue(Object.assign(base, { text: String(o.text || '') }));
  }

  // ── 作廢／還原／清空回收桶／容量 ──
  function voidRef(ref, why) { return enqueue({ action: 'void', ref: ref, why: why || '', who: me() }); }
  function restore(ref) { return enqueue({ action: 'restore', ref: ref, who: me() }); }
  function emptyTrash() { return post({ action: 'emptyTrash', who: me() }); }
  function stats() { return post({ action: 'stats' }); }
  function has(rids) { return post({ action: 'has', rids: rids }); }
  // 核對：給一串 {rid, build}，試算表沒有的才補送（只核對 v2 開始之後的）
  function reconcile(list) {
    if (!list || !list.length) return Promise.resolve({ sent: 0 });
    var ids = list.map(function (x) { return x.rid; });
    return has(ids).then(function (r) {
      var miss = {}; (r.missing || []).forEach(function (x) { miss[x] = 1; });
      var go = list.filter(function (x) { return miss[x.rid] && (!r.since || (x.at || 0) >= r.since); });
      go.forEach(function (x) { try { var b = x.build(); if (b) rows(b.sheets, b.head, b.rids); } catch (e) {} });
      meta('lastReconcile', Date.now());
      return { sent: go.length };
    });
  }

  // ── 每月自動備份（柏翰的電腦，每月一次，打包上個月以前的全部 AI 資料）──
  function readCases() {
    return new Promise(function (res) {
      try {
        var r = indexedDB.open('AiCasedbDB');
        r.onsuccess = function () { var d = r.result; if (!d.objectStoreNames.contains('cases')) { d.close(); res([]); return; }
          var g = d.transaction('cases', 'readonly').objectStore('cases').get('ai_casedb_v1'); g.onsuccess = function () { d.close(); res(Array.isArray(g.result) ? g.result : []); }; g.onerror = function () { d.close(); res([]); }; };
        r.onerror = function () { res([]); };
      } catch (e) { res([]); }
    });
  }
  function monthlyBackup(force) {
    if (me() !== ADMIN) return Promise.resolve(null);
    var cur = ym();
    return meta('autoBackupYm').then(function (done) {
      if (done === cur && !force) return null;
      return readCases().then(function (cases) {
        var chats = {}, l = ls();
        for (var i = 0; i < l.length; i++) { var k = l.key(i); if (/^char_.+_ai_chat_.+_v1$/.test(k) || /^ai_(pins|closed|timeline|rules|error_reports)_v1$/.test(k)) chats[k] = l.getItem(k); }
        return all('chatarch').then(function (arc) {
          var payload = { app: '太空基地 AI 資料備份', ver: 1, at: new Date().toISOString(), by: me(), cases: cases, localStorage: chats, chatArchive: arc };
          var d = new Date(); d.setDate(0); var prev = ym(d.getTime());
          return file({ name: '太空基地AI備份_' + prev + '.json', text: JSON.stringify(payload), mime: 'application/json', kind: '每月自動備份', folder: prev, rid: 'auto_' + prev })
            .then(function () { return meta('autoBackupYm', cur); }).then(function () { return meta('lastBackup', Date.now()); });
        });
      });
    }).catch(function (e) { console.warn('[ledger] 每月備份失敗', e); });
  }

  // ── AI 顧問舊對話一次補進試算表（每台電腦跑一次，編號由內容算，重複的試算表會擋掉）──
  function backfillChats() {
    return meta('chatBackfill').then(function (done) {
      if (done) return;
      // 試算表要先換成 v2（會擋重複）才補寫，舊版就等下次
      return stats().then(function () { return doBackfill(); }, function () {});
    });
  }
  function doBackfill() {
    return Promise.resolve().then(function () {
      var l = ls(), n = 0;
      for (var i = 0; i < l.length; i++) {
        var k = l.key(i), m = k && k.match(/^char_(.+)_ai_chat_(.+)_v1$/); if (!m) continue;
        var arr = []; try { arr = JSON.parse(l.getItem(k) || '[]') || []; } catch (e) {}
        arr.forEach(function (x) { if (!x || (x.type !== 'user' && x.type !== 'ai') || !x.text) return; chat({ who: m[1], feature: m[2], featureTitle: m[2], topic: x.topicId || '', role: x.type, text: x.text, time: x.time || 0 }); n++; });
      }
      // 以前被擠掉、存在長期資料庫裡的也一起補
      return all('chatarch').catch(function () { return []; }).then(function (arc) {
        arc.forEach(function (e) { var m = String(e.k).match(/^char_(.+)_ai_chat_(.+)_v1$/); if (!m || !Array.isArray(e.v)) return;
          e.v.forEach(function (x) { if (!x || (x.type !== 'user' && x.type !== 'ai') || !x.text) return; chat({ who: m[1], feature: m[2], featureTitle: m[2], topic: x.topicId || '', role: x.type, text: x.text, time: x.time || 0 }); n++; }); });
        return meta('chatBackfill', { at: Date.now(), n: n });
      });
    });
  }

  // ── 健康狀態 ──
  function health() {
    return Promise.all([all('outbox').catch(function () { return []; }), meta('lastOk'), meta('lastErr'), meta('lastBackup'), meta('legacy')]).then(function (r) {
      var mon = {}; try { mon = JSON.parse(ls().getItem('ledger_month_v1') || '{}'); } catch (e) {}
      return { pending: r[0].length, oldest: r[0].reduce(function (m, x) { return Math.min(m, x.v.at || m); }, Date.now()), lastOk: r[1] || 0, lastErr: r[2], lastBackup: r[3] || 0, legacy: r[4] || 0, month: mon.ym === ym() ? mon : { ym: ym(), ntd: 0, n: 0 } };
    });
  }
  function fmt(t) { if (!t) return '—'; var d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function light(ok, warn) { return '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;background:' + (ok ? '#2E9D5B' : (warn ? '#E8A33D' : '#E24B4A')) + '"></span>'; }
  // 畫在頁面自己的對話框裡（openDlg(title, body, foot)）
  function openHealth(openDlg) {
    openDlg('🩺 資料健康', '<p class="meta" style="margin-top:0">讀取中…</p>', '');
    Promise.all([health(), stats().catch(function (e) { return { ok: false, err: e.message }; })]).then(function (r) {
      var h = r[0], s = r[1], now = Date.now();
      var rowsH = [
        [h.pending === 0 || now - h.oldest < 3600e3, h.pending < 20, '待送清單', h.pending ? (h.pending + ' 筆還沒送到試算表（最早 ' + fmt(h.oldest) + '）') : '全部都送到了'],
        [now - h.lastOk < 86400e3, now - h.lastOk < 3 * 86400e3, '上次成功寫進試算表', fmt(h.lastOk)],
        [s.ok, false, '試算表程式', s.ok ? 'v2，正常' : ('還沒換成 v2：' + esc(s.err || ''))],
        [s.ok && s.pct < 70, s.ok && s.pct < 90, '試算表容量', s.ok ? (s.pct + '%（' + Math.round(s.cells / 10000) + ' 萬格／1000 萬格）') : '—'],
        [!h.lastBackup || now - h.lastBackup < 35 * 86400e3, false, '上次每月自動備份', h.lastBackup ? fmt(h.lastBackup) : '還沒有（每月 1 號後柏翰打開網站會自動做）'],
        [true, true, '這個月記到的 AI 花費', '約 NT$' + Math.round(h.month.ntd || 0) + '（' + (h.month.n || 0) + ' 次，只算這台電腦）']
      ];
      var b = '<table class="use" style="width:100%">' + rowsH.map(function (x) { return '<tr><td style="text-align:left">' + light(x[0], x[1]) + x[2] + '</td><td style="text-align:left">' + x[3] + '</td></tr>'; }).join('') + '</table>';
      if (h.lastErr && h.pending) b += '<p class="meta">最近一次失敗：' + fmt(h.lastErr.at) + '・' + esc(h.lastErr.msg) + '</p>';
      if (s.ok) b += '<p class="meta">回收桶：' + s.trash + ' 列（作廢超過 30 天的，柏翰按「清空回收桶」才會真的刪）' + (s.archived ? '；已封存年份：' + esc(s.archived) : '') + '</p>';
      var foot = '<button class="btn pri sm" onclick="LEDGER.flush().then(function(){LEDGER.openHealth(openDlg)})">立刻補送</button>'
        + (me() === ADMIN ? '<button class="btn sm" onclick="LEDGER.monthlyBackup(true).then(function(){LEDGER.flush();toast(\'已排入備份，送完會出現在雲端硬碟\')})">現在備份一次</button>'
          + '<button class="btn ghost sm" onclick="if(confirm(\'清掉回收桶裡作廢超過 30 天的列？這一步刪了就回不來（Google 版本記錄 30 天內還救得回）\'))LEDGER.emptyTrash().then(function(r){toast(\'清掉 \'+(r.removed||0)+\' 列\');LEDGER.openHealth(openDlg)},function(e){toast(e.message,true)})">清空回收桶</button>' : '');
      openDlg('🩺 資料健康', b, foot);
    });
  }

  // ── 下載的檔案（Word、Excel、備份、報告）自動存一份到雲端硬碟：攔 <a download> 的點擊，各頁不用改 ──
  var KIND = { doc: 'Word', docx: 'Word', xlsx: 'Excel', json: '備份檔', md: '報告', csv: '表格', pdf: 'PDF' };
  var _click = HTMLAnchorElement.prototype.click;
  if (!_click.__ledger) {
    var c2 = function () {
      try {
        var name = this.download, href = this.href || '';
        if (name && /^blob:/.test(href) && !this.__noCloud) {
          var ext = (name.split('.').pop() || '').toLowerCase();
          _of(href).then(function (r) { return r.blob(); }).then(function (b) { if (b.size > 30 * 1048576) return; file({ name: name, blob: b, mime: b.type, kind: KIND[ext] || ext }); }).catch(function () {});
        }
      } catch (e) {}
      return _click.apply(this, arguments);
    };
    c2.__ledger = 1; HTMLAnchorElement.prototype.click = c2;
  }

  W.LEDGER = { rows: rows, usage: usage, chat: chat, archiveChat: archiveChat, chatArchive: chatArchive, file: file, voidRef: voidRef, restore: restore, emptyTrash: emptyTrash,
    stats: stats, has: has, reconcile: reconcile, flush: flush, health: health, openHealth: openHealth, monthlyBackup: monthlyBackup, backfillChats: backfillChats,
    mask: mask, uid: uid, ts: ts, ym: ym, hash: hash, HEAD: HEAD, ADMIN: ADMIN };

  // 啟動：5 秒後送一次待送清單；連上網路時再送；柏翰的電腦 60 秒後檢查每月備份
  setTimeout(function () { flush(); }, 5000);
  W.addEventListener('online', function () { soon(1000); });
  setTimeout(function () { monthlyBackup(); }, 60000);
  setTimeout(function () { if (/ai-advisor/.test(location.pathname)) backfillChats().then(function () { soon(); }); }, 20000);
})();

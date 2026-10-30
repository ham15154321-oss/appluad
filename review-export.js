/* ═══════════════════════════════════════════════════════════════════
 * review-export.js  （2026-10-15 加 pay_prev）檢討會資料包匯出按鈕
 *
 * 做什麼：在業績數據中心上方分頁列（📝 成績單 右邊）加一顆「📤 檢討會資料包」。
 *        按下去 → 選「全部七家」或單一學院 → 下載一個 JSON，
 *        一位業務一包（本月績效、1–9 月績效、各月六條路、報到、三個月面談與入帳、編輯追蹤）。
 *        組長把 JSON 丟給 Claude，照「組長用_檢討會簡報指令」做作戰表。
 *
 * 安裝：performance-compare.html 的 firebase-sync.js 後面加一行
 *   <script defer src="./review-export.js?v=1"></script>
 *   推到 GitHub Pages 後 localhost 跟 GitHub 版都會有這顆鈕。
 *
 * 不動任何資料：只讀 localStorage／IndexedDB，不推送、不改。
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__reviewExportLoaded) return;
  window.__reviewExportLoaded = true;

  var ORGS = ['中壢學院', '中壢二部', '中壢三部', '台中學院', '台中二部', '台中三部', '高雄建國'];
  var NET = /FB|IG|部落格|Google|赫綵網站|億捷|席恩|網路|聯播/;
  var EVENT = /展|博覽|嘉年華|CWT|FF|PF|Cake|職涯|動漫/;

  function me() { try { return localStorage.getItem('activeCharacterId') || localStorage.getItem('appedu_logged_character') || ''; } catch (e) { return ''; } }
  function lsj(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function pick(suffix) { // 先找自己的，沒有就找所有人裡最新的那份
    var mine = lsj('char_' + me() + '_' + suffix); if (mine) return mine;
    var best = null;
    for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.endsWith('_' + suffix)) { var v = lsj(k); if (v) best = v; } }
    return best || lsj(suffix);
  }
  function idb(dbName, store, key) {
    return new Promise(function (res) {
      var q; try { q = indexedDB.open(dbName); } catch (e) { return res(null); }
      q.onerror = function () { res(null); };
      q.onsuccess = function () {
        var db = q.result; if (!db.objectStoreNames.contains(store)) { db.close(); return res(null); }
        var g = db.transaction(store).objectStore(store).get(key);
        g.onsuccess = function () { var v = g.result; db.close(); try { res(typeof v === 'string' ? JSON.parse(v) : v); } catch (e) { res(v); } };
        g.onerror = function () { db.close(); res(null); };
      };
    });
  }
  function idbKeys(dbName, store) {
    return new Promise(function (res) {
      var q; try { q = indexedDB.open(dbName); } catch (e) { return res([]); }
      q.onerror = function () { res([]); };
      q.onsuccess = function () { var db = q.result; if (!db.objectStoreNames.contains(store)) { db.close(); return res([]); } var g = db.transaction(store).objectStore(store).getAllKeys(); g.onsuccess = function () { db.close(); res(g.result || []); }; g.onerror = function () { db.close(); res([]); }; };
    });
  }
  async function idbPick(dbName, store, suffix) {
    var mine = await idb(dbName, store, 'char_' + me() + '_' + suffix); if (mine) return mine;
    var keys = await idbKeys(dbName, store); var best = null;
    for (var i = 0; i < keys.length; i++) { if (String(keys[i]).endsWith('_' + suffix)) { var v = await idb(dbName, store, keys[i]); if (v && (!best || JSON.stringify(v).length > JSON.stringify(best).length)) best = v; } }
    return best || await idb(dbName, store, suffix);
  }
  function daysAgo(d, today) { var t = new Date(String(d).replace(/-/g, '/')); if (isNaN(t)) return null; return Math.round((today - t) / 86400000); }
  function subType(sub, ym) {
    if (!sub) return '其他';
    if (sub === '學員加購') return '學員加購';
    if (sub === '學員介紹') return '學員介紹';
    if (NET.test(sub)) return '網際網路';
    if (EVENT.test(sub) || /^\d{4}_\d{2}/.test(sub)) return (sub.indexOf(ym) === 0) ? '當月展場' : '以前的展場';
    return '其他';
  }

  async function buildPack(orgFilter) {
    var now = new Date(); var ym = now.getFullYear() + '_' + String(now.getMonth() + 1).padStart(2, '0');
    var perfp = pick('motiv_perfp_v1') || { orgs: {} };
    var chk = pick('motiv_checkin_v1') || {};
    var ch = lsj('perf_compare_v1_channel_v1') || pick('perf_compare_v1_channel_v1') || {};
    var mp = await idb('SpaceBaseDB', 'images', 'mp_data_v1') || {};
    var fn = await idbPick('FunnelDB', 'kv', 'motiv_funnel_v1') || { orgs: {} };
    var ed = await idbPick('FunnelDB', 'kv', 'fn_edits_v1') || {};
    // 上個月每一筆入帳（月封存 fn_archive_v1[YYYY-MM].pay），給「標竿上個月 1–15 號」那頁切日期用
    var arch = await idbPick('FunnelDB', 'kv', 'fn_archive_v1') || {};
    var pd = new Date(now.getFullYear(), now.getMonth() - 1, 1); var pym = pd.getFullYear() + '-' + String(pd.getMonth() + 1).padStart(2, '0');
    var pa = arch[pym] || null; var prevPayByOrg = pa ? (pa.pay || (pa.funnel && pa.funnel.orgs ? Object.keys(pa.funnel.orgs).reduce(function (o, k) { o[k] = pa.funnel.orgs[k].pay || []; return o; }, {}) : {})) : {};
    var stamps = {};
    ['motiv', 'checkin', 'channel', 'funnel', 'edits'].forEach(function (s) { stamps[s] = localStorage.getItem('char_' + me() + '_motiv_synced_' + s) || ''; });
    var pack = { meta: { exportedAt: now.toLocaleString(), month: now.getMonth() + 1, exportedBy: me(), synced: stamps, edits: ed.meta || null, prevPay: { month: pym, savedAt: pa ? pa.savedAt : null }, note: '一位業務一包。數字來源：perfp＝當月績效（EIP 暫估）、months＝1–N 月每月績效、channel＝各月六條路業績、checkin＝報到、itv＝近三個月面談（含備註）、pay＝本月每一筆入帳、pay_prev＝上個月每一筆入帳（月封存）、edits＝編輯追蹤。追回請用規則：這位學生之前合計繳 2,000 元內、這個月繳的全算追回。' }, academies: {} };
    var edDays = Object.keys(ed.stats || {}).sort(); var last7 = edDays.slice(-7);
    var monKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

    ORGS.forEach(function (org) {
      if (orgFilter && orgFilter !== org) return;
      var people = {};
      (perfp.orgs[org] || []).forEach(function (p) {
        var n = p.employee_name; if (!n) return;
        people[n] = { 學院: org, 部門: p.hr_department_name, 職稱: p.hr_title_name,
          perfp: { 面談: +p.count1, 報名: +p.count2, 註冊A: +p.count3, 業績A: +p.new_perf, 註冊B: +p.count4, 合計業績: +p.business, 個人目標: +p.goal, 達成率: +p.rate4, 退費: +p.pay_back },
          months: {}, channel: {}, checkin: null, itv: [], pay: [], pay_prev: [], pay_by_channel: {}, edits: null };
      });
      // 1–N 月每月績效
      Object.keys(mp).forEach(function (m) {
        var s = JSON.stringify(mp[m]); var re = /\{[^{}]*"姓名":"([^"]+)"[^{}]*\}/g; var mt;
        while ((mt = re.exec(s))) { try { var row = JSON.parse(mt[0]); if (people[row['姓名']] && (!row['學院'] || row['學院'] === org || true)) { if (people[row['姓名']].months[m] === undefined) people[row['姓名']].months[m] = row; } } catch (e) {} }
      });
      // 各月六條路
      Object.keys(ch).forEach(function (m) { var mo = ch[m]; if (!mo || typeof mo !== 'object') return; Object.keys(mo).forEach(function (c) { var rk = mo[c] && mo[c].ranking; if (!Array.isArray(rk)) return; rk.forEach(function (x) { if (people[x.name]) { people[x.name].channel[m] = people[x.name].channel[m] || {}; people[x.name].channel[m][c] = x.value; } }); }); });
      // 報到
      Object.keys(people).forEach(function (n) { var key = org + '|' + n; var o = {}; ['formal', 'net', 'rs'].forEach(function (k) { var t = chk[k]; o[k] = t ? (t.byKey ? t.byKey[key] : t[key]) : null; }); people[n].checkin = { 正式報到: o.formal, 網路報到: o.net, 預約報到: o.rs }; });
      // 面談、入帳
      var fo = fn.orgs[org] || {};
      (fo.itv || []).forEach(function (x) { if (people[x.o]) people[x.o].itv.push({ 面談日: x.d, 學生: x.n, 通路: x.s, 想學: x.w, 報名: x.a, 註冊: x.r, 狀態: x.c, 備註: x.m, 金額: x.t }); });
      (fo.pay || []).forEach(function (x) { if (people[x.o]) { var p = people[x.o]; p.pay.push({ 日期: x.d, 學生: x.n, 狀態: x.st, 通路: x.sub, 課程: x.k, 金額: x.v }); var t = subType(x.sub, ym); p.pay_by_channel[t] = (p.pay_by_channel[t] || 0) + (x.v || 0); } });
      (prevPayByOrg[org] || []).forEach(function (x) { if (people[x.o]) people[x.o].pay_prev.push({ 日期: x.d, 學生: x.n, 狀態: x.st, 通路: x.sub, 課程: x.k, 金額: x.v }); });
      // 編輯追蹤
      var L = (ed.last || {})[org] || {};
      Object.keys(people).forEach(function (n) {
        var n7 = 0, e7 = 0, zero = 0; last7.forEach(function (d) { var s = ((ed.stats[d] || {})[org] || {})[n]; if (s) { n7 += s.n || 0; e7 += s.empty || 0; } else zero++; });
        var mon = ed.mon && ed.mon[monKey] && ed.mon[monKey][org] && ed.mon[monKey][org][n];
        var mine = Object.keys(L).filter(function (k) { return L[k].own === n; });
        var b = { '0-3天': 0, '4-7天': 0, '8-14天': 0, '15-30天': 0, '30天以上': 0 }; var old = [];
        mine.forEach(function (k) { var v = L[k]; var g = daysAgo(v.d, now); if (g === null) return; if (g <= 3) b['0-3天']++; else if (g <= 7) b['4-7天']++; else if (g <= 14) b['8-14天']++; else { if (g <= 30) b['15-30天']++; else b['30天以上']++; old.push({ 學生: k, 最後編輯: v.d, 誰編的: v.ed, 狀態: v.st, 備註: v.note }); } });
        old.sort(function (a, c) { return a.最後編輯 < c.最後編輯 ? -1 : 1; });
        people[n].edits = { 近7天編輯幾筆: n7, 近7天點開沒寫狀態幾筆: e7, 近7天幾天沒動: zero, 本月編輯幾筆: mon ? mon.n : null, 本月點開沒寫狀態幾筆: mon ? mon.empty : null, 手上幾位: mine.length, 多久沒人動: b, 超過15天沒編輯: old.length, 超過15天名單: old.slice(0, 30) };
      });
      pack.academies[org] = people;
    });
    return pack;
  }

  function download(obj, name) {
    var blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  async function onClick() {
    var choice = prompt('匯出哪一家？\n輸入 0＝全部七家（一個檔）\n1 中壢學院 2 中壢二部 3 中壢三部 4 台中學院 5 台中二部 6 台中三部 7 高雄建國', '0');
    if (choice === null) return;
    var idx = parseInt(choice, 10); var org = (idx >= 1 && idx <= 7) ? ORGS[idx - 1] : null;
    var btn = document.getElementById('reviewExportBtn'); if (btn) btn.textContent = '⏳ 整理中…';
    try {
      var pack = await buildPack(org);
      var d = new Date(); var tag = (d.getMonth() + 1) + '' + String(d.getDate()).padStart(2, '0');
      download(pack, '檢討會資料包_' + (org || '七家') + '_' + tag + '.json');
    } catch (e) { alert('匯出失敗：' + (e && e.message)); console.error(e); }
    if (btn) btn.textContent = '📤 檢討會資料包';
  }

  function inject() {
    if (document.getElementById('reviewExportBtn')) return true;
    var anchor = Array.prototype.find.call(document.querySelectorAll('button'), function (b) { return b.textContent.trim() === '📝 成績單'; });
    if (!anchor) return false;
    var btn = document.createElement('button'); btn.id = 'reviewExportBtn'; btn.type = 'button'; btn.textContent = '📤 檢討會資料包';
    btn.className = anchor.className; btn.style.cssText = 'margin-left:6px;background:#6633FF;color:#fff;border:0;border-radius:8px;padding:6px 12px;font-weight:700;cursor:pointer';
    btn.title = '匯出一位業務一包的 JSON，給組長做檢討會作戰表';
    btn.addEventListener('click', onClick);
    anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    return true;
  }
  var tries = 0; var t = setInterval(function () { if (inject() || ++tries > 40) clearInterval(t); }, 500);
  window.reviewExport = { buildPack: buildPack };
})();

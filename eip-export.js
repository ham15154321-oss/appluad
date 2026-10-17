/* ═══════════════════════════════════════════════════════════════════
 * eip-export.js（2026-10-15）EIP 課表包
 *
 * 在 EIP 任何一頁按書籤「📥 EIP 課表包」→ 讀三區（桃竹區、中區、南區）
 * 這個月（或＋前三個月）的開班查詢，每一班點進「登記狀況」讀名單，
 * 一次只讀一頁、每頁至少停 3 秒、EIP 變慢就停 30 秒（10/15 改：寧願慢也不要影響 EIP），
 * 下載成 EIP課表包_MMDD.json。給作戰表產生器（review-deck.html）用。
 *
 * 只讀：只用 GET 讀「開班查詢」和「登記狀況」兩種頁面，不按任何按鈕、不改資料。
 * 不帶電話：名單只留 正取／試聽、登記日期、姓名、隸屬學院、登記方式、承辦人、
 *           登記人員、前七天／前三天／當天確認、登記狀態、繳費狀態（課程進度）。
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var REGIONS = { '桃竹區': 17, '中區': 22, '南區': 26 };
  var BASE = '/class/class/';
  var MONTHS_BACK = 3;
  // 寧願慢也不要影響 EIP（10/15 柏翰定）：
  // 一次只讀一頁；每讀完一頁，停「這一頁花的時間 × 5」，最少 3 秒；
  // EIP 一變慢（一頁超過 3 秒）就停 30 秒再讀；讀不到就停 60 秒再試一次。
  // 前幾個月的名單讀過一次就存在這台電腦，下次不再讀。
  var MIN_GAP = 3000, SLOW_MS = 3000, SLOW_WAIT = 30000;
  var STOP = false;
  var CACHE_KEY = 'eipx_cache_v1';

  function txt(el) { return (el && el.innerText || el && el.textContent || '').replace(/\s+/g, ' ').trim(); }
  function parse(html) { return new DOMParser().parseFromString(html, 'text/html'); }
  async function get(url) {
    for (var tries = 0; tries < 2; tries++) {
      if (STOP) throw new Error('已停止');
      var t0 = Date.now();
      try {
        var r = await fetch(url, { credentials: 'include' }); var txt = await r.text(); var ms = Date.now() - t0;
        await sleep(ms > SLOW_MS ? SLOW_WAIT : Math.max(MIN_GAP, ms * 5));
        return txt;
      } catch (e) { await sleep(60000); }
    }
    throw new Error('EIP 讀不到');
  }
  function cacheGet() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch (e) { return {}; } }
  function cacheSet(c) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch (e) {} }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function monthsList(back) {
    var d = new Date(); var out = [];
    for (var i = back; i >= 0; i--) { var x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push({ y: x.getFullYear(), m: x.getMonth() + 1 }); }
    return out;
  }

  // 開班查詢：一個區、一個月的班級清單
  async function listClasses(q1, y, m) {
    var doc = parse(await get(BASE + 'register_class.php?q1=' + q1 + '&q7=&q8=&q2=&q3=&q4=&q5=' + y + '&q6=' + m + '&q14=&q15='));
    var t = Array.prototype.find.call(doc.querySelectorAll('table'), function (x) { return x.rows.length > 1 && /班級名稱/.test(txt(x.rows[0])) && /開班日期/.test(txt(x.rows[0])); });
    if (!t) return [];
    var head = Array.prototype.map.call(t.rows[0].cells, txt);
    var col = function (name) { return head.indexOf(name); };
    var out = [];
    for (var i = 1; i < t.rows.length; i++) {
      var c = t.rows[i].cells; if (c.length < 8) continue;
      var html = t.rows[i].innerHTML; var mm = html.match(/clickDetail\((\d+)\)/) || html.match(/classDetail\((\d+)\)/); if (!mm) continue;
      out.push({ cid: mm[1], 學院: txt(c[col('組織')]), 課程類型: txt(c[col('課程類型')]), 單科課程: txt(c[col('單科課程')]), 班級名稱: txt(c[col('班級名稱')]), 開班日期: txt(c[col('開班日期')]), 上課時段: txt(c[col('上課時段')]), 座位數: +txt(c[col('座位數')]) || 0, 已登記正取: +txt(c[col('已登記正取')]) || 0, 已登記試聽: +txt(c[col('已登記試聽')]) || 0, 已登記備取: +txt(c[col('已登記備取')]) || 0 });
    }
    return out;
  }

  // 登記狀況：一班的名單（不帶電話）
  async function roster(q1, y, m, cid) {
    var doc = parse(await get(BASE + 'register_class_detail.php?q1=' + q1 + '&q7=&q8=&q2=&q3=&q4=&q5=' + y + '&q6=' + m + '&q14=&q15=&cid=' + cid));
    var t = Array.prototype.find.call(doc.querySelectorAll('table'), function (x) { return x.rows.length > 0 && /登記人員/.test(txt(x.rows[0])) && /承辦人/.test(txt(x.rows[0])); });
    if (!t) return [];
    var head = Array.prototype.map.call(t.rows[0].cells, txt);
    var at = function (cells, name, nth) { var idx = -1, k = 0; for (var j = 0; j < head.length; j++) { if (head[j] === name) { if (k === (nth || 0)) { idx = j; break; } k++; } } return idx >= 0 && cells[idx] ? txt(cells[idx]) : ''; };
    var out = [];
    for (var i = 1; i < t.rows.length; i++) {
      var c = t.rows[i].cells; if (c.length < 10) continue;
      out.push({ 正取試聽: txt(c[1]), 登記日期: at(c, '登記日期'), 姓名: at(c, '姓名'), 隸屬學院: at(c, '隸屬學院'), 登記方式: at(c, '登記方式'), 承辦人: at(c, '承辦人'), 登記人員: at(c, '登記人員'), 前七天: at(c, '前七天'), 前三天: at(c, '前三天'), 當天: at(c, '當天'), 登記狀態: at(c, '登記狀態'), 繳費狀態: at(c, '繳費狀態').slice(0, 300) });
    }
    return out;
  }

  async function pool(items, n, fn) { var i = 0; var run = async function () { while (i < items.length) { var k = i++; await fn(items[k], k); } }; var ws = []; for (var j = 0; j < n; j++) ws.push(run()); await Promise.all(ws); }

  function overlay() {
    var o = document.getElementById('__eipx'); if (o) return o;
    o = document.createElement('div'); o.id = '__eipx';
    o.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99999;background:#6633FF;color:#fff;padding:12px 16px;border-radius:10px;font:14px/1.5 sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);max-width:340px';
    document.body.appendChild(o); return o;
  }

  async function build(onProgress, back) {
    var ms = monthsList(back === undefined ? MONTHS_BACK : back); var pack = { meta: { 匯出時間: new Date().toLocaleString(), 月份: ms.map(function (x) { return x.y + '/' + x.m; }), 說明: '開班查詢（照開班日期那個月）＋每班登記狀況。已安排＝承辦人或登記人員有一個是他。不含電話。' }, 區: {} };
    var jobs = []; var cache = cacheGet();
    for (var r in REGIONS) {
      pack.區[r] = {};
      for (var k = 0; k < ms.length; k++) {
        var key = ms[k].y + '-' + String(ms[k].m).padStart(2, '0');
        var isPast = k < ms.length - 1; var ck = r + '|' + key;
        if (isPast && cache[ck]) { pack.區[r][key] = cache[ck]; onProgress && onProgress('前幾個月：' + r + ' ' + key + ' 用上次存的，不再讀'); continue; }
        var cls = await listClasses(REGIONS[r], ms[k].y, ms[k].m);
        if (isPast) cls.__cacheKey = ck;
        pack.區[r][key] = cls;
        cls.forEach(function (c) { jobs.push({ q1: REGIONS[r], y: ms[k].y, m: ms[k].m, c: c }); });
        onProgress && onProgress('讀班級清單：' + r + ' ' + key + '（' + cls.length + ' 班）');
      }
    }
    var done = 0, miss = 0;
    for (var q = 0; q < jobs.length; q++) {
      var j = jobs[q]; if (STOP) break;
      try { j.c.名單 = await roster(j.q1, j.y, j.m, j.c.cid); } catch (e) { j.c.名單 = []; j.c.錯誤 = String(e); }
      // 頁面顯示有人登記、讀出來卻是 0 位：多半是 EIP 登出或連線斷了。停 60 秒再讀一次；連兩班都這樣就停下來，不下載不完整的檔
      var expect = (+j.c.已登記正取 || 0) + (+j.c.已登記試聽 || 0);
      if (expect > 0 && !(j.c.名單 || []).length && !STOP) {
        onProgress && onProgress('第 ' + (done + 1) + ' 班讀到 0 位，停 60 秒再讀一次…');
        await sleep(60000);
        try { j.c.名單 = await roster(j.q1, j.y, j.m, j.c.cid); } catch (e) { j.c.名單 = []; }
        if (!(j.c.名單 || []).length) { miss++; j.c.錯誤 = '頁面顯示 ' + expect + ' 位登記，名單讀不到'; if (miss >= 2) throw new Error('EIP 好像登出了（連兩班讀不到名單）。請重新登入 EIP，再按一次書籤；這次沒有下載。'); }
        else { miss = 0; delete j.c.錯誤; }
      } else if ((j.c.名單 || []).length) miss = 0;
      done++; onProgress && onProgress('讀名單 ' + done + ' / ' + jobs.length + '（約剩 ' + Math.ceil((jobs.length - done) * 4 / 60) + ' 分鐘）');
    }
    if (STOP) throw new Error('已停止，這次沒有下載');
    // 前幾個月讀完存起來（不存繳費狀態，省空間）
    for (var rr in pack.區) for (var kk in pack.區[rr]) { var arr = pack.區[rr][kk]; if (arr.__cacheKey) { cache[arr.__cacheKey] = arr.map(function (c) { var x = Object.assign({}, c); x.名單 = (c.名單 || []).map(function (m) { var y = Object.assign({}, m); delete y.繳費狀態; return y; }); return x; }); } }
    var keep = {}; ms.forEach(function (m) { for (var r2 in REGIONS) { var ck2 = r2 + '|' + m.y + '-' + String(m.m).padStart(2, '0'); if (cache[ck2]) keep[ck2] = cache[ck2]; } }); cacheSet(keep);
    pack.meta.班數 = jobs.length;
    pack.meta.讀不到名單 = jobs.filter(function (j) { return j.c.錯誤; }).map(function (j) { return j.c.班級名稱; });
    return pack;
  }

  function download(obj, name) {
    var blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  async function run() {
    if (!/eip\.appedu\.com\.tw/.test(location.host)) { alert('請在 EIP 的頁面上按這個書籤'); return; }
    var c = prompt('EIP 課表包要讀多少？\n1＝只讀這個月（約 3 分鐘）\n2＝這個月＋前三個月（第一次約 10 分鐘；之後前幾個月用存起來的，也是約 3 分鐘）\n\n為了不影響 EIP：一次只讀一頁，每頁至少停 3 秒；EIP 一變慢就自動停 30 秒。\n讀的時候可以去做別的事，這一頁不要關。', '1');
    if (c === null) return;
    var back = c.trim() === '2' ? MONTHS_BACK : 0;
    var o = overlay(); STOP = false;
    var stopBtn = document.createElement('button'); stopBtn.textContent = '停止'; stopBtn.style.cssText = 'margin-left:10px;background:#fff;color:#6633FF;border:0;border-radius:6px;padding:2px 10px;font-weight:700;cursor:pointer';
    stopBtn.onclick = function () { STOP = true; o.firstChild.textContent = '⏹ 停止中…'; };
    o.textContent = ''; o.appendChild(document.createTextNode('📥 EIP 課表包：開始讀…')); o.appendChild(stopBtn);
    try {
      var pack = await build(function (s) { o.firstChild.textContent = '📥 EIP 課表包：' + s; }, back);
      var d = new Date(); var tag = (d.getMonth() + 1) + String(d.getDate()).padStart(2, '0');
      download(pack, 'EIP課表包_' + tag + '.json');
      var bad = pack.meta.讀不到名單.length;
      o.textContent = (bad ? '⚠️ 下載了，但有 ' + bad + ' 班名單讀不到（' + pack.meta.讀不到名單.slice(0, 3).join('、') + (bad > 3 ? '…' : '') + '），建議重新登入 EIP 再按一次：' : '✅ 下載好了：') + 'EIP課表包_' + tag + '.json（' + pack.meta.班數 + ' 班）';
      if (!bad) setTimeout(function () { o.remove(); }, 6000);
    } catch (e) { o.textContent = '❌ 失敗：' + (e && e.message); }
  }

  window.eipExport = { build: build, run: run, listClasses: listClasses, roster: roster };
  if (!window.__eipExportNoAuto) run();
})();

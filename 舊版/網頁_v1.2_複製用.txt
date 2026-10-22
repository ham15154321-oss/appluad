/**
 * 13:40 網頁版｜v1.2｜2026-10-22
 * 版本史：v1（10/21）第一版｜v1.1（10/22）細查名單改用「登記人員」分組（不是業務才退回承辦人，兩個都不是業務就歸「客服登記」）；離職名單上的人不列｜v1.2（10/22）加速：資料先算好放快取（送班況時就算），&fmt=json 只交資料給 GitHub 上的 1340.html；送業績快照時只換報到排名
 * 網址：部署網址後面加 ?r=中區 或 ?r=建國（桃區預留：?r=桃區，等 Ivan 開口再開）
 *   可加 &d=2026-10-21 看那天的版本；網頁資料留 30 天
 * 資料：
 *   班況、出席細查、助理數據 ← 「13:40 日會議程」資料夾裡「網頁資料 YYYY-MM-DD.json」（業績數據中心 🏫 班況送過來時存的）
 *   議程文字 ← 「LINE 推播」資料夾裡「LINE日會 YYYY-MM-DD.txt」（9:30 排程產生；中區在前、<<<NEXT>>> 後面是高雄）
 *   報到排名 ← 快照表「數據」分頁
 */
var PG_PREFIX = '網頁資料 ';
var PG_KEEP_DAYS = 30;
var PG_REGIONS = { '中區': { 區: '中區', orgs: ['台一', '台二', '台三'], part: 0, label: '中區' },
                   '建國': { 區: '南區', orgs: ['建國'], part: 1, label: '高雄建國' } };
var PG_FULL = { '台中學院': '台一', '台中二部': '台二', '台中三部': '台三', '中壢學院': '壢一', '中壢二部': '壢二', '中壢三部': '壢三', '高雄建國': '建國' };

function pgDoGet_(e) {
  var r = String(e.parameter.r || ''), d = String(e.parameter.d || ''), json = e.parameter.fmt === 'json';
  if (!PG_REGIONS[r]) return json ? bkJson_({ ok: false, error: '網址後面要加 ?r=中區 或 ?r=建國' })
    : HtmlService.createHtmlOutput('<p style="font:16px system-ui;padding:24px">網址後面要加 ?r=中區 或 ?r=建國</p>');
  var txt = pgGetJson_(r, d);
  if (json) return ContentService.createTextOutput(txt).setMimeType(ContentService.MimeType.JSON);   // v1.2：給 GitHub 的 1340.html
  return HtmlService.createHtmlOutput(pgHtml_(JSON.parse(txt)))
    .setTitle(PG_REGIONS[r].label + ' 13:40')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ───────── v1.2 快取：資料先算好，打開網頁只拿現成的 ─────────
 * 一份資料切成好幾塊放 CacheService（一塊 3 萬字，最多放 6 小時）
 * 什麼時候重算：① 送班況（pgWarm_，兩區都算）② 送業績快照（pgRefreshRank_，只換報到排名）
 *              ③ 快取過期 ④ 那天的 LINE日會 議程後來才產生（10 分鐘查一次 Drive）           */
var PG_CACHE_SEC = 21600, PG_CHUNK = 30000;
function pgKey_(r, d) { return 'pg2|' + r + '|' + (d || 'latest'); }
function pgCacheGet_(key) {
  var c = CacheService.getScriptCache(), n = +(c.get(key + '|n') || 0);
  if (!n) return null;
  var ks = []; for (var i = 0; i < n; i++) ks.push(key + '|' + i);
  var m = c.getAll(ks), s = '';
  for (var j = 0; j < n; j++) { if (m[ks[j]] == null) return null; s += m[ks[j]]; }
  return s;
}
function pgCachePut_(key, s) {
  var c = CacheService.getScriptCache(), o = {}, n = Math.max(1, Math.ceil(s.length / PG_CHUNK));
  for (var i = 0; i < n; i++) o[key + '|' + i] = s.substr(i * PG_CHUNK, PG_CHUNK);
  c.putAll(o, PG_CACHE_SEC);
  c.put(key + '|n', String(n), PG_CACHE_SEC);   // 最後才放塊數：沒放完的不會被讀到
}
function pgGetJson_(r, d) {
  var key = pgKey_(r, d), s = null;
  try { s = pgCacheGet_(key); } catch (err) {}
  if (s && !d && pgAgendaLate_(s)) s = null;
  if (!s) { s = JSON.stringify(pgData_(r, d)); try { pgCachePut_(key, s); } catch (err) {} }
  return s;
}
// 快取裡的議程比班況舊（班況今天送了、議程 9:30 才產生）→ 10 分鐘查一次 Drive 有沒有那天的議程
function pgAgendaLate_(s) {
  var o; try { o = JSON.parse(s); } catch (err) { return true; }
  if (!o.date || o.agendaDate === o.date) return false;
  var c = CacheService.getScriptCache(), k = 'pg2|agchk|' + o.date;
  if (c.get(k)) return false;
  c.put(k, '1', 600);
  try { return DriveApp.getFolderById(BK_LINE_FOLDER).searchFiles("title contains 'LINE日會 " + o.date + "'").hasNext(); } catch (err) { return false; }
}
// 送班況時：兩區最新的資料先算好
function pgWarm_() {
  Object.keys(PG_REGIONS).forEach(function (r) { pgCachePut_(pgKey_(r, ''), JSON.stringify(pgData_(r, ''))); });
}
// 送業績快照時：報到排名會變，只換快取裡的排名（不用整份重算）
function pgRefreshRank_() {
  var sh = SpreadsheetApp.openById(BK_SHEET_ID).getSheetByName('數據'); if (!sh) return;
  var vals = null;
  Object.keys(PG_REGIONS).forEach(function (r) {
    var key = pgKey_(r, ''), s = pgCacheGet_(key); if (!s) return;
    if (!vals) { var n = sh.getLastRow(), from = Math.max(2, n - 1500); vals = sh.getRange(from, 1, n - from + 1, 4).getDisplayValues(); }
    var o = JSON.parse(s);
    o.rank = pgRankCalc_(vals, r, o.date ? o.date.replace(/-/g, '/') : '9999/99/99');
    pgCachePut_(key, JSON.stringify(o));
  });
}

// 送班況時存一份當天網頁資料（中區＋南區；同一天覆蓋），超過 30 天的丟垃圾桶
function pgSaveSnap_(body, asstRes, todayS) {
  var keep = (body.rows || []).filter(function (r) { return r.區 === '中區' || r.區 === '南區'; });
  var snap = { at: body.at || '', today: todayS, rows: keep, asst: body.asst || null, done: asstRes ? asstRes.done : {}, base: asstRes ? asstRes.baseS : '' };
  var name = PG_PREFIX + todayS.replace(/\//g, '-') + '.json', folder = DriveApp.getFolderById(BK_CSV_FOLDER);
  var it = folder.getFilesByName(name), txt = JSON.stringify(snap);
  if (it.hasNext()) it.next().setContent(txt); else folder.createFile(name, txt, MimeType.PLAIN_TEXT);
  var all = folder.getFiles(), t = bkDay_(todayS);
  while (all.hasNext()) {
    var f = all.next(), m = f.getName().match(/^網頁資料 (\d{4})-(\d{2})-(\d{2})\.json$/);
    if (m && t - bkDay_(m[1] + '/' + m[2] + '/' + m[3]) > PG_KEEP_DAYS) f.setTrashed(true);
  }
}

function pgData_(r, d) {
  var R = PG_REGIONS[r], folder = DriveApp.getFolderById(BK_CSV_FOLDER), files = folder.getFiles(), snaps = {};
  while (files.hasNext()) { var f = files.next(), m = f.getName().match(/^網頁資料 (\d{4}-\d{2}-\d{2})\.json$/); if (m) snaps[m[1]] = f; }
  var dates = Object.keys(snaps).sort().reverse().slice(0, PG_KEEP_DAYS);
  var date = (d && snaps[d]) ? d : dates[0];
  var snap = null; try { snap = date ? JSON.parse(snaps[date].getBlob().getDataAsString()) : null; } catch (err) {}
  // 議程：那天（或之前最近一份）的 LINE日會
  var ag = pgAgenda_(date || Utilities.formatDate(new Date(), BK_TZ, 'yyyy-MM-dd'), R.part);
  var rank = pgRank_(r, date), ppl = pgPeople_();
  return pgBuild_(r, snap, ag, rank, dates, date, ScriptApp.getService().getUrl(), ppl);
}

// 誰是業務（快照表「業務」分頁出現過的人）、誰離職了（「離職名單」分頁）
function pgPeople_() {
  try {
    var ss = SpreadsheetApp.openById(BK_SHEET_ID), sales = {}, sh = ss.getSheetByName('業務');
    if (sh) { var n = sh.getLastRow(), from = Math.max(2, n - 2000); sh.getRange(from, 4, n - from + 1, 1).getDisplayValues().forEach(function (v) { if (v[0]) sales[String(v[0]).trim()] = 1; }); }
    return { sales: Object.keys(sales), left: bkLeft_(ss) };
  } catch (err) { return { sales: [], left: [] }; }
}
// 細查的負責人：登記人員是業務 → 用登記人員；不是 → 承辦人是業務就用承辦人；兩個都不是（客服幫忙登的）→「客服登記」
function pgOwner_(s, ppl) {
  var isSales = function (n) { n = String(n || '').trim(); return !!n && ppl.sales.indexOf(n) >= 0 && !bkIsLeft_(ppl.left, n); };
  if (!ppl.sales.length) return s.登記人員 || s.承辦 || '';   // 讀不到業務名單 → 照登記人員
  if (isSales(s.登記人員)) return s.登記人員;
  if (isSales(s.承辦)) return s.承辦;
  return '客服登記';
}

function pgAgenda_(date, part) {
  var lf = DriveApp.getFolderById(BK_LINE_FOLDER), it = lf.searchFiles("title contains 'LINE日會 '"), best = null, bestD = '';
  while (it.hasNext()) {
    var f = it.next(), m = f.getName().match(/LINE日會 (\d{4}-\d{2}-\d{2})/);
    if (m && m[1] <= date && m[1] > bestD) { best = f; bestD = m[1]; }
  }
  if (!best) return { text: '', date: '' };
  var parts = best.getBlob().getDataAsString().split(/\n?<<<NEXT>>>\n?/);
  return { text: (parts[part] || '').trim(), date: bestD };
}

// 報到排名：快照表「數據」分頁，資料日期 ≤ 那天的最新一筆；跟前一個資料日期比增減
function pgRank_(r, date) {
  try {
    var sh = SpreadsheetApp.openById(BK_SHEET_ID).getSheetByName('數據'); if (!sh) return null;
    var n = sh.getLastRow(), from = Math.max(2, n - 1500), vals = sh.getRange(from, 1, n - from + 1, 4).getDisplayValues();
    return pgRankCalc_(vals, r, date ? date.replace(/-/g, '/') : '9999/99/99');
  } catch (err) { return null; }
}
function pgRankCalc_(vals, r, dateS) {
  var byDay = {};   // 資料日期 → 學院 → [寫入時間, 報到]
  vals.forEach(function (v) {
    var dd = String(v[1]).replace(/-/g, '/'), org = PG_FULL[v[2]] || v[2], n = parseInt(String(v[3]).replace(/,/g, ''), 10);
    if (!dd || dd > dateS || isNaN(n)) return;
    var o = byDay[dd] || (byDay[dd] = {});
    if (!o[org] || String(v[0]) > o[org][0]) o[org] = [String(v[0]), n];
  });
  var days = Object.keys(byDay).sort(); if (!days.length) return null;
  var cur = byDay[days[days.length - 1]], prev = days.length > 1 ? byDay[days[days.length - 2]] : null;
  var all = Object.keys(cur).map(function (o) { return { 院: o, n: cur[o][1], diff: prev && prev[o] ? cur[o][1] - prev[o][1] : null }; }).sort(function (a, b) { return b.n - a.n; });
  all.forEach(function (x, i) { x.rank = i + 1; });
  var mine = all.filter(function (x) { return PG_REGIONS[r].orgs.indexOf(x.院) >= 0; });
  var top3 = all.slice(0, 3).map(function (x) { return '<b>' + x.院 + ' ' + x.n + '</b>'; }).join('、');
  var note = '全省前三：' + top3 + '。' + mine.map(function (x) { return x.院 + '全省第 ' + x.rank; }).join('、') + '。'
    + (prev ? '增減是跟 ' + bkMD_(days[days.length - 2]) + ' 比。' : '') + '（' + bkMD_(days[days.length - 1]) + ' 資料）';
  return { rows: mine, note: note };
}

// 純計算：組出網頁要的資料（node 也能測）
function pgBuild_(r, snap, ag, rank, dates, date, baseUrl, ppl) {
  var R = PG_REGIONS[r], todayS = snap ? snap.today : '';
  ppl = ppl || { sales: [], left: [] };
  var rows = snap ? snap.rows.filter(function (x) { return x.區 === R.區 && (R.orgs.indexOf(x.院) >= 0); }) : [];
  var classes = rows.map(function (x) {
    var c = bkCalc_(x, todayS), f = c.f || null, l = c.l || null;
    return { cid: x.cid, code: c.code, name: x.班名, type: x.類型, phase: c.phase, toOpen: c.toOpen, dayN: c.dayN, toEnd: c.toEnd,
      seat: +x.座位 || 0, reg: +x.正取 || 0, trial: +x.試聽 || 0, wait: +x.備取 || 0, th: c.th, ok: /^✅/.test(c.st), stTxt: c.stTxt || c.st,
      openMD: bkMD_(x.開班日), endMD: bkMD_(x.結業日), done: +x.已上 || 0, total: +x.堂數 || 0,
      first: f ? { 應到: f.應到, 實到: f.實到, 請假: f.請假, 曠課: f.曠課 } : null,
      last: l ? { 應到: l.應到, 實到: l.實到, md: bkMD_(l.日期) } : null, lRate: c.lRate,
      細查: x.細查 ? Object.assign({}, x.細查, { 學生: (x.細查.學生 || []).map(function (s) { return Object.assign({}, s, { 負責: pgOwner_(s, ppl) }); }) }) : null };
  }).sort(function (a, b) { return (a.toOpen === '' ? 999 : a.toOpen) - (b.toOpen === '' ? 999 : b.toOpen); });
  var asst = null;
  if (snap && snap.asst) {
    var A = snap.asst;
    asst = { 月: A.月, 漏斗同步: A.漏斗同步, base: snap.base || '', done: snap.done || {},
      unc: (A.註冊未消耗 || []).filter(function (x) { return R.orgs.indexOf(x.院) >= 0; }).map(function (x) { return bkIsLeft_(ppl.left, x.承辦) ? Object.assign({}, x, { 承辦: x.承辦, 離職: true }) : x; }),
      fun: (A.走到哪一關 || []).filter(function (x) { return R.orgs.indexOf(x.院) >= 0 && !bkIsLeft_(ppl.left, x.業務); }) };
  }
  var label = '';
  if (date) { var m = date.match(/(\d{4})-(\d{2})-(\d{2})/); label = (+m[2]) + '/' + (+m[3]) + '（' + bkWk_(m[1] + '/' + m[2] + '/' + m[3]) + '）'; }
  return { r: r, date: date || '', dateLabel: label, dates: dates, syncAt: snap ? snap.at : '', classes: classes, asst: asst, rank: rank,
    agenda: ag.text, agendaDate: ag.date, baseUrl: baseUrl };
}

function pgHtml_(data) {
  var json = JSON.stringify(data).replace(/</g, '\\u003c').split(String.fromCharCode(8232)).join('\\u2028').split(String.fromCharCode(8233)).join('\\u2029');
  return '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><style>' + PG_CSS + '</style></head><body>'
    + PG_BODY.replace('<script>', '<script>window.DATA=' + json + ';') + '</body></html>';
}

/* ───────── 版面（從 13:40 示意 v11 搬過來） ───────── */
var PG_CSS = `
  /* ── Apple 2026 系統色（iOS 26 Liquid Glass 世代）── 每一種顏色只代表一件事 */
  :root{
    --bg0:#F5F5F7; --bg1:#EDEFF4;
    --glass:rgba(255,255,255,.72); --card:#FFFFFF; --edge:rgba(255,255,255,.9);
    --label:#1D1D1F; --label2:#6E6E73; --label3:#A1A1A6; --sep:rgba(60,60,67,.14); --fill:rgba(120,120,128,.12);
    --blue:#0A7AFF; --blueBg:rgba(10,122,255,.10);     /* 人名、可點的班別 */
    --orange:#FF8D00; --orangeBg:rgba(255,141,0,.12);  /* 缺口：差幾個、連幾天沒動、未到 */
    --red:#E0172D; --redBg:rgba(224,23,45,.10);        /* 達標、過門檻（台股紅） */
    --ink:#1D1D1F; --inkOn:#FFF;
    --shadow:0 10px 30px rgba(0,0,0,.07),0 1px 1px rgba(0,0,0,.04);
    --c-today:#1D1D1F; --c-asst:#AF52DE; --c-cs:#30B0C7; --c-lead:#5856D6; --c-focus:#34C759; --c-biz:#FFB800; --c-week:#A2845E;
  }
  @media (prefers-color-scheme:dark){ :root{ --bg0:#000; --bg1:#0B0B0F; --glass:rgba(28,28,30,.72); --card:#1C1C1E; --edge:rgba(255,255,255,.08);
    --label:#F5F5F7; --label2:#98989D; --label3:#636366; --sep:rgba(84,84,88,.5); --fill:rgba(120,120,128,.24);
    --blue:#409CFF; --blueBg:rgba(64,156,255,.16); --orange:#FFA03D; --orangeBg:rgba(255,160,61,.16); --red:#FF5A6A; --redBg:rgba(255,90,106,.16);
    --ink:#F5F5F7; --inkOn:#000; --shadow:0 10px 30px rgba(0,0,0,.5); } }
  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
  html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
  body{margin:0;color:var(--label);background:linear-gradient(180deg,var(--bg0),var(--bg1));min-height:100vh;
    font:100%/1.5 -apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",system-ui,sans-serif;overscroll-behavior-y:none}
  body.lock{overflow:hidden}
  .num{font-variant-numeric:tabular-nums}

  /* 頂欄 ＋ 章節索引（都是玻璃） */
  .top{position:sticky;top:0;z-index:10;isolation:isolate;transform:translateZ(0);background:var(--glass);-webkit-backdrop-filter:blur(22px) saturate(180%);backdrop-filter:blur(22px) saturate(180%);border-bottom:.5px solid var(--sep)}
  .top .t{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;padding:calc(env(safe-area-inset-top) + 10px) 16px 8px}
  .top h1{margin:0;font-size:1.5rem;line-height:1.1;letter-spacing:-.022em;font-weight:700}
  .top .sub{font-size:.8125rem;color:var(--label2);margin-top:3px}
  .top .tb{display:flex;gap:6px;align-items:center}
  .top .ic{border:0;background:var(--fill);color:var(--label);font:inherit;font-size:1rem;font-weight:600;width:34px;height:32px;border-radius:999px;transition:transform 100ms ease-out}
  .top .ic:active{transform:scale(.94)}
  .top .day{flex:none;border:0;background:var(--fill);color:var(--label);font:inherit;font-size:.875rem;font-weight:600;border-radius:999px;padding:6px 12px;transition:transform 100ms ease-out}
  .top .day:active{transform:scale(.96)}
  .idx{display:flex;gap:6px;padding:0 16px 10px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}
  .idx::-webkit-scrollbar{display:none}
  .idx a{flex:none;text-decoration:none;color:var(--label2);font-size:.875rem;font-weight:600;padding:8px 13px;border-radius:999px;background:var(--fill);transition:transform 100ms ease-out,background 200ms,color 200ms}
  .idx a:active{transform:scale(.95)}
  .idx a.on{background:var(--pc,var(--ink));color:#fff}
  .idx a[href='#s-today'].on{background:var(--c-today);color:var(--inkOn)}
  .idx a[href='#s-biz'].on{color:#1D1D1F}   /* 黃底用深字，對比才夠 */

  main{position:relative;z-index:0;padding:10px 0 calc(env(safe-area-inset-bottom) + 48px)}
  section{scroll-margin-top:124px;padding:4px 16px 22px;margin:0 0 6px;border-radius:0;position:relative;background:color-mix(in srgb,var(--sc) 7%,transparent)}
  section::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--sc);border-radius:0 3px 3px 0}
  #s-today{--sc:var(--c-today);background:none} #s-today::before{display:none}
  #s-asst{--sc:var(--c-asst)} #s-cs{--sc:var(--c-cs)} #s-lead{--sc:var(--c-lead)} #s-focus{--sc:var(--c-focus)} #s-biz{--sc:var(--c-biz)} #s-week{--sc:var(--c-week)}
  @media (prefers-color-scheme:dark){ .seg i{background:rgba(255,255,255,.2)} section{background:color-mix(in srgb,var(--sc) 12%,transparent)} }

  /* 卡片：玻璃、同心圓角 */
  .card{background:var(--card);border:.5px solid var(--edge);border-radius:22px;box-shadow:var(--shadow)}
  .card.flat{box-shadow:0 1px 2px rgba(0,0,0,.04)}

  /* 章節標題：一律同一套 */
  h2.sec{display:flex;align-items:baseline;gap:8px;margin:26px 2px 10px;font-size:1.375rem;letter-spacing:-.022em;font-weight:700;line-height:1.15;color:var(--sc)}
  h2.sec::before{content:'';flex:none;width:10px;height:10px;border-radius:50%;background:var(--sc);align-self:center}
  h2.sec small{font-size:.8125rem;font-weight:500;color:var(--label2);letter-spacing:0;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  h2.sec>span.tt{flex:none;white-space:nowrap}
  h2.sec .n{margin-left:auto;font-size:.8125rem;font-weight:600;color:var(--label3)}
  h2.sec .cp{margin-left:auto;border:0;background:none;color:var(--label3);font:inherit;font-size:.8125rem;font-weight:600;padding:8px 10px;margin-right:-6px;border-radius:10px;transition:transform 100ms ease-out,color 200ms}
  h2.sec .cp:active{transform:scale(.94);color:var(--blue)}
  h2.sec .cp.done{color:var(--red)}

  /* 今天 */
  .hero{padding:18px 18px 6px;margin-top:6px}
  .hero h2{margin:0 0 10px;font-size:1.5rem;line-height:1.25;letter-spacing:-.025em;font-weight:700}
  .hero h2 b{color:var(--orange)}
  .move{display:flex;align-items:center;gap:12px;padding:13px 0;border-top:.5px solid var(--sep);cursor:pointer;transition:opacity 100ms}
  .move:active{opacity:.55}
  .move .k{flex:none;width:28px;height:28px;border-radius:50%;background:var(--ink);color:var(--inkOn);font-size:.875rem;font-weight:700;display:grid;place-items:center}
  .move .mv{flex:1;min-width:0}
  .move .t{font-size:1.0625rem;font-weight:600;line-height:1.3;letter-spacing:-.012em}
  .move .t em{font-style:normal;color:var(--orange)}
  .move .d{font-size:.875rem;color:var(--label2);margin-top:2px}
  .chev{flex:none;color:var(--label3);font-size:1.25rem;line-height:1}

  /* 助理：排名 */
  .rank{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
  .rank div{padding:12px 12px 10px}
  .rank b{display:block;font-size:1.75rem;line-height:1;letter-spacing:-.03em;font-weight:700;position:relative;z-index:0}
  .rank b.top{color:var(--red)}
  .rank span{display:block;font-size:.75rem;color:var(--label2);margin-top:5px}
  .rank i{font-style:normal;font-size:.75rem;color:var(--label2);margin-left:4px}
  .rank i.up{color:var(--red)}
  .people{display:flex;flex-wrap:wrap;gap:6px;padding:12px 14px 14px}
  .pp{display:inline-flex;align-items:center;gap:6px;padding:5px 10px 5px 8px;border-radius:999px;background:var(--fill);font-size:.875rem}
  .pp b{color:var(--blue);font-weight:600}
  .pp.low{background:var(--orangeBg)}
  .pp.low i{font-style:normal;color:var(--orange);font-weight:700}
  .ask{padding:12px 14px;font-size:.9375rem;color:var(--label2);line-height:1.5}
  .ask b{color:var(--label);font-weight:600}
  /* 助理：註冊未消耗（一人一行，卡最久在上）＋ 最差那一院的漏斗 */
  .ch{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px;padding:14px 16px 6px}
  .ch b{font-size:1.0625rem;font-weight:700;letter-spacing:-.012em}
  .ch .mo{flex:none;align-self:center;font-style:normal;font-size:.9375rem;font-weight:700;letter-spacing:-.01em;color:#fff;background:var(--c-asst);border-radius:8px;padding:3px 9px 3px;line-height:1.3}
  .ch b em{font-style:normal;color:var(--orange);font-size:1.5rem;letter-spacing:-.03em;margin-right:2px}
  .ch span{flex-basis:100%;font-size:.8125rem;color:var(--label2)}
  .unc{padding:0 16px 6px}
  .ur{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:.5px solid var(--sep)}
  .ur .l{flex:1;min-width:0}
  .ur .st{font-size:1.0625rem;font-weight:600;color:var(--blue);letter-spacing:-.01em}
  .ur .st .sn{font-size:1rem;font-weight:500;color:var(--label);margin-left:8px;letter-spacing:0}
  .ur .cr{font-size:.875rem;color:var(--label2);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ur .dy{flex:none;text-align:right;font-size:.75rem;color:var(--orange);font-weight:600;line-height:1.15}
  .ur .dy b{display:block;font-size:1.375rem;font-weight:700;letter-spacing:-.03em;line-height:1;margin-bottom:2px}
  .ur .dy b small{font-size:.8125rem;font-weight:600;letter-spacing:0;margin-left:1px}
  .cf{display:flex;align-items:center;gap:8px;padding:10px 16px 14px;border-top:.5px solid var(--sep);font-size:.875rem;color:var(--label2)}
  .cf b{color:var(--red);font-weight:700}
  .fun{padding:0 0 4px}
  .fr{display:grid;grid-template-columns:1fr repeat(4,44px) 18px;align-items:center;gap:4px;padding:9px 16px;border-top:.5px solid var(--sep)}
  .fr.hd{border-top:0;padding:2px 16px 4px;font-size:.6875rem;color:var(--label2);font-weight:600;letter-spacing:.02em}
  .fr.hd span{text-align:right}
  .fr.hd span:nth-child(-n+4)::after{content:'›';margin-left:3px;color:var(--label3)}
  .fr.hd.u span::after{content:''}
  .fr .nm{font-weight:600;color:var(--blue);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .fr .v{text-align:right;font-size:1.0625rem;font-weight:600;letter-spacing:-.02em}
  .fr .v.z,.ar .v.z{color:var(--label3);font-weight:500}
  .fr .v.gap,.ar .v.gap{color:var(--orange);font-weight:700}
  .fr.sum{border-top:1.5px solid var(--sep);margin-top:2px}
  .fr.sum .nm{color:var(--label);font-weight:700}
  .fr.sum .v{font-weight:700}
  /* 手風琴：一家一列，按下即回應，拉開用高度動畫（可中途反轉） */
  .acc .unc{padding:0 16px 4px}
  .acc .unc .ur:first-child{border-top:0}
  .acc .fun .fr:first-child{border-top:0}
  .ai{border-top:.5px solid var(--sep)}
  .ar{display:grid;grid-template-columns:1fr repeat(4,44px) 18px;align-items:center;gap:4px;width:100%;border:0;background:none;font:inherit;color:inherit;text-align:left;padding:12px 16px;cursor:pointer;transition:background 120ms ease-out}
  .ar:active{background:var(--fill)}
  .ar .nm{display:flex;align-items:center;gap:6px;font-size:1.0625rem;font-weight:700;letter-spacing:-.012em;white-space:nowrap}
  .ar .v{text-align:right;font-size:1.125rem;font-weight:600;letter-spacing:-.02em}
  .ar .v.ok{color:var(--red);font-weight:700}
  .ar .v.d{font-weight:600}
  .ar .v.d.gap{color:var(--orange);font-weight:700}
  .ar .v small{font-size:.75rem;font-weight:600;margin-left:1px}
  .ar .dc{text-align:right;color:var(--label3);font-size:1.25rem;line-height:1;transition:transform 360ms cubic-bezier(.2,.9,.25,1)}
  .ai.open .ar .dc{transform:rotate(90deg)}
  .ar.u{grid-template-columns:1fr 44px 52px 60px 18px}
  #accF .fr,#accF .ar{grid-template-columns:1fr 40px 40px 40px 64px 18px}
  #accF .fr.hd span{white-space:nowrap}
  .fr.hd.u{grid-template-columns:1fr 44px 52px 60px 18px}
  .tag{font-style:normal;font-size:.6875rem;font-weight:700;border-radius:999px;padding:2px 7px;letter-spacing:0}
  .tag.worst{color:#fff;background:var(--orange)}
  .tag.best{color:var(--red);background:var(--redBg)}
  .ab{display:grid;grid-template-rows:0fr;transition:grid-template-rows 420ms cubic-bezier(.2,.9,.25,1)}
  .ab>div{min-height:0;overflow:hidden;opacity:0;transform:translateY(-4px);transition:opacity 220ms ease 60ms,transform 380ms cubic-bezier(.2,.9,.25,1)}
  .ai.open .ab{grid-template-rows:1fr}
  .ai.open .ab>div{opacity:1;transform:none}
  .acc .ab .ur,.acc .ab .fr{background:color-mix(in srgb,var(--sc) 5%,transparent)}
  .acc .ab .unc,.acc .ab .fun{background:color-mix(in srgb,var(--sc) 5%,transparent);padding-top:2px}

  /* 主管：四條，各自一種視覺 */
  .lead{overflow:hidden}
  .lead .it{padding:14px 16px;border-top:.5px solid var(--sep)}
  .lead .it:first-child{border-top:0}
  .lead h3{display:flex;align-items:center;gap:10px;margin:0 0 10px;font-size:1.0625rem;font-weight:700;letter-spacing:-.012em;flex-wrap:wrap}
  .lead h3 .tt{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .lead h3 .k{flex:none;width:24px;height:24px;border-radius:7px;background:var(--ink);color:var(--inkOn);font-size:.8125rem;display:grid;place-items:center}
  .lead h3 .say{flex-basis:100%;margin-left:34px;margin-top:-4px;font-size:.8125rem;font-weight:500;color:var(--label2);white-space:normal}
  .call{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
  .call div{background:var(--orangeBg);border-radius:14px;padding:10px 10px 8px}
  .call b{display:block;color:var(--blue);font-size:1.0625rem;font-weight:700}
  .call span{display:block;font-size:.8125rem;color:var(--label2);margin-top:2px}
  .call span i{font-style:normal;color:var(--orange);font-weight:700}
  .call em{display:block;font-style:normal;font-size:.75rem;color:var(--label2);margin-top:6px}
  .lead .q{margin-top:10px;font-size:.9375rem;color:var(--label2)}
  .lead .q b{color:var(--label);font-weight:600}
  .acad{display:flex;align-items:center;gap:12px;padding:8px 0}
  .acad .nm{flex:none;width:52px;font-weight:700;color:var(--blue)}
  .acad .big{flex:none;font-size:1.375rem;font-weight:700;letter-spacing:-.02em;line-height:1}
  .acad .big small{font-size:.75rem;font-weight:500;color:var(--label2);margin-left:2px}
  .acad .tag{font-size:.6875rem;font-weight:700;color:var(--orange);background:var(--orangeBg);border-radius:999px;padding:2px 7px;white-space:nowrap}
  .acad .gap{margin-left:auto;text-align:right;font-size:.8125rem;color:var(--label2);line-height:1.3;white-space:nowrap}
  .acad .gap b{display:block;color:var(--orange);font-size:1.0625rem}
  .acad .gap b.ok{color:var(--red)}
  .acad .gap b.ok::after{content:'';}
  .hbar{height:6px;border-radius:3px;background:var(--fill);margin:4px 0 2px;overflow:hidden}
  .hbar i{display:block;height:100%;border-radius:3px;background:var(--ink);transform-origin:left;animation:grow 600ms cubic-bezier(.2,.9,.25,1) both}
  .hbar i.top{background:var(--red)}
  @keyframes grow{from{transform:scaleX(0)}}
  .trend{font-size:.8125rem;color:var(--label2);margin-top:6px}
  .trend b{color:var(--label);font-weight:600}
  .urgent{display:flex;gap:10px;padding:10px 0;border-top:.5px solid var(--sep)}
  .urgent:first-of-type{border-top:0}
  .urgent .dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--orange);margin-top:8px}
  .urgent p{margin:0;font-size:.9375rem;line-height:1.5}
  .urgent p a,.ln{color:var(--blue);text-decoration:none;font-weight:600}
  .urgent p b{font-weight:700}
  .urgent p i{font-style:normal;color:var(--orange);font-weight:700}

  /* 班況・客服 */
  .todo{padding:12px 14px}
  .todo h4{margin:0 0 6px;font-size:.8125rem;font-weight:600;color:var(--label2)}
  .todo ul{margin:0;padding:0;list-style:none}
  .todo li{display:flex;gap:10px;padding:6px 0;font-size:.9375rem;line-height:1.45}
  .todo li::before{content:'';flex:none;width:18px;height:18px;border-radius:6px;border:1.5px solid var(--label3);margin-top:3px}
  .grp{margin:16px 6px 6px;font-size:.8125rem;font-weight:600;color:var(--label2);letter-spacing:.02em}
  .cls{display:block;padding:14px 16px 14px;margin-bottom:8px;position:relative;cursor:pointer;transition:transform 120ms ease-out}
  .cls:active{transform:scale(.985)}
  .cls.need::before{content:'';position:absolute;left:0;top:16px;bottom:16px;width:3px;border-radius:0 2px 2px 0;background:var(--orange)}
  .cls .b{flex:1;min-width:0}
  .cls .l1{display:flex;align-items:center;gap:6px;font-size:.75rem;color:var(--label2)}
  .cls .l1 .sp{flex:1}
  .cls .ft{position:absolute;right:14px;bottom:12px}
  .cls .l1 .code{font-weight:600;color:var(--blue);background:var(--blueBg);border-radius:6px;padding:1px 6px;white-space:nowrap}
  .cls .l1>span:not(.code):not(.sp):not(.pill){white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cls .nm{margin-top:5px;font-size:1.0625rem;font-weight:600;line-height:1.3;letter-spacing:-.012em}
  .cls .mt{margin-top:4px;font-size:.875rem;color:var(--label2)}
  .cls .mt b{color:var(--label);font-weight:600}
  .cls .mt i{font-style:normal;color:var(--orange);font-weight:600}
  .cls .cs{margin-top:8px;padding:8px 10px;border-radius:10px;background:var(--fill);font-size:.8125rem;line-height:1.45;color:var(--label2)}
  .cls .cs b{color:var(--label);font-weight:600}
  .cls .cs::before{content:'客服 ';font-weight:700;color:var(--label3)}
  .bar{position:relative;height:5px;margin-top:9px;border-radius:3px;background:var(--fill)}
  .bar i{position:absolute;inset:0 auto 0 0;border-radius:3px;background:var(--ink);transform-origin:left;animation:grow 600ms cubic-bezier(.2,.9,.25,1) both}
  .bar i.ok{background:var(--red)}
  .bar u{position:absolute;top:-5px;width:0;height:0;border:4px solid transparent;border-top:5px solid var(--label3);transform:translateX(-4px)}
    .pill{font-size:.8125rem;font-weight:700;border-radius:999px;padding:4px 10px;white-space:nowrap}
  .pill.ok{color:var(--red);background:var(--redBg)}
  .pill.need{color:var(--inkOn);background:var(--orange)}
  .pill.mute{color:var(--label2);background:var(--fill)}

  /* 本日重點／驗收／業務 */
  .list{padding:4px 16px}
  .list .li{display:flex;gap:12px;padding:12px 0;border-top:.5px solid var(--sep)}
  .list .li:first-child{border-top:0}
  .list .k{flex:none;width:24px;height:24px;border-radius:7px;background:var(--fill);font-size:.8125rem;font-weight:700;display:grid;place-items:center}
  .list p{margin:0;font-size:.9375rem;line-height:1.5}
  .list p b{font-weight:700}
  .list p i{font-style:normal;color:var(--orange);font-weight:700}
  .goal{padding:16px;display:flex;gap:14px;align-items:center}
  .goal .big{flex:none;font-size:2rem;font-weight:700;letter-spacing:-.03em;line-height:1;color:var(--label)}
  .goal .big small{display:block;font-size:.75rem;color:var(--label2);font-weight:500;letter-spacing:0;margin-top:4px}
  .goal p{margin:0;font-size:.9375rem;line-height:1.5}
  .goal p b{font-weight:700}

  /* 時間表 */
  .wk{padding:4px 16px}
  .wk .d{display:flex;gap:12px;padding:12px 0;border-top:.5px solid var(--sep)}
  .wk .d:first-child{border-top:0}
  .wk .dd{flex:none;width:52px}
  .wk .dd b{display:block;font-size:1.125rem;line-height:1;letter-spacing:-.02em}
  .wk .dd span{font-size:.75rem;color:var(--label2)}
  .wk .dd.today b{color:var(--red)}
  .wk ul{list-style:none;margin:0;padding:0;flex:1;font-size:.9375rem;line-height:1.5}
  .wk li{display:flex;gap:8px}
  .wk li time{flex:none;width:44px;color:var(--label2);font-size:.875rem;padding-top:1px}
  .wk li.hi span{font-weight:600}
  /* 抽屜：標題列（大字 12 班）→ 露出一張 → 其餘用高度動畫拉開 */
  .drawer{margin-top:10px;padding:0 0 8px;overflow:hidden}
  .peek{padding-top:10px}
  .dh{display:flex;align-items:center;gap:12px;width:100%;border:0;background:var(--sc);padding:14px 16px;font:inherit;color:#fff;text-align:left;cursor:pointer;transition:filter 150ms}
  .dh:active{filter:brightness(.92)}
  .dh .big{flex:none;font-size:2.25rem;font-weight:700;letter-spacing:-.03em;line-height:1}
  .dh .big small{font-size:1rem;font-weight:600;letter-spacing:0;margin-left:2px}
  .dh .dt{flex:1;min-width:0}
  .dh .dt b{display:block;font-size:1.0625rem;font-weight:600;letter-spacing:-.01em}
  .dh .dt span{display:block;font-size:.8125rem;color:rgba(255,255,255,.85);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .dh .dc{flex:none;color:rgba(255,255,255,.85);font-size:1.375rem;line-height:1;transition:transform 360ms cubic-bezier(.2,.9,.25,1)}
  .drawer.open .dh .dc{transform:rotate(90deg)}
  .peek{padding:0 10px}
  .peek .cls{margin-bottom:0;box-shadow:none;border:.5px solid var(--sep)}
  .dbody{display:grid;grid-template-rows:0fr;transition:grid-template-rows 480ms cubic-bezier(.2,.9,.25,1)}
  .drawer.open .dbody{grid-template-rows:1fr}
  .dinner{min-height:0;overflow:hidden;padding:0 10px;opacity:0;transform:translateY(-6px);transition:opacity 260ms ease 80ms,transform 420ms cubic-bezier(.2,.9,.25,1)}
  .drawer.open .dinner{opacity:1;transform:none}
  .dinner .grp{margin:14px 6px 6px}
  .dinner .cls{box-shadow:none;border:.5px solid var(--sep)}
  .dinner .cls.top1{display:none}
  .wk.fold .d:nth-child(n+4){display:none}
  .more{display:block;width:100%;margin-top:8px;border:.5px solid var(--edge);background:var(--card);border-radius:16px;padding:14px;font:inherit;font-size:1rem;font-weight:600;color:var(--blue);transition:transform 100ms ease-out}
  .more:active{transform:scale(.985)}
  .wk:not(.fold)+.more{display:none}
  .foot{margin:28px 6px 0;font-size:.75rem;line-height:1.6;color:var(--label3)}
  .legend{display:flex;flex-wrap:wrap;gap:10px;margin:10px 6px 0;font-size:.75rem;color:var(--label2)}
  .legend i{display:inline-block;width:10px;height:10px;border-radius:50%;vertical-align:-1px;margin-right:4px}

  /* 底部面板 */
  #dim{position:fixed;inset:0;background:rgba(0,0,0,.32);opacity:0;pointer-events:none;transition:opacity 260ms ease;z-index:20}
  #dim.on{opacity:1;pointer-events:auto}
  #sheet{position:fixed;left:0;right:0;bottom:0;z-index:21;background:var(--glass);-webkit-backdrop-filter:blur(30px) saturate(180%);backdrop-filter:blur(30px) saturate(180%);border-radius:26px 26px 0 0;max-height:88vh;overflow:auto;
    transform:translateY(100%);box-shadow:0 -8px 30px rgba(0,0,0,.18);will-change:transform;padding-bottom:calc(env(safe-area-inset-bottom) + 20px);touch-action:pan-y}
  #sheet .grip{position:sticky;top:0;padding:10px 0 6px;text-align:center}
  #sheet .grip i{display:inline-block;width:36px;height:5px;border-radius:3px;background:var(--label3);opacity:.5}
  #sheet .in{padding:4px 20px 0}
  #sheet h4{margin:0;font-size:1.375rem;letter-spacing:-.022em;font-weight:700;line-height:1.2}
  #sheet .s{margin:4px 0 14px;color:var(--label2);font-size:.875rem}
  #sheet .g4{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:16px}
  #sheet .g4 div{background:var(--fill);border-radius:12px;padding:10px 8px}
  #sheet .g4 b{display:block;font-size:1.375rem;line-height:1;letter-spacing:-.02em}
  #sheet .g4 span{display:block;font-size:.6875rem;color:var(--label2);margin-top:4px}
  /* ── 細查面板（第 3 步）── 承辦分組：誰的學生沒到、沒達標，一眼看出誰要處理 */
  .seg{position:sticky;top:21px;z-index:2;display:flex;margin:0 -4px 12px;padding:3px;border-radius:12px;background:var(--fill);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px)}
  .seg button{position:relative;z-index:1;flex:1;border:0;background:none;font:inherit;font-size:.875rem;font-weight:600;color:var(--label);padding:7px 4px;border-radius:9px;transition:transform 100ms ease-out}
  .seg button:active{transform:scale(.96)}
  .seg button b{font-weight:600;color:var(--label2);margin-left:3px}
  .seg i{position:absolute;z-index:0;top:3px;bottom:3px;left:3px;border-radius:9px;background:var(--card);box-shadow:0 2px 6px rgba(0,0,0,.12);transition:transform 320ms cubic-bezier(.2,.9,.25,1)}
  .rule{margin:-4px 2px 12px;font-size:.8125rem;color:var(--label2);line-height:1.45}
  .rule b{color:var(--label);font-weight:600}
  .sg{margin-bottom:10px;border-radius:16px;background:var(--card);overflow:hidden;border:.5px solid var(--sep)}
  .sg.hide{display:none}
  .sgh{display:flex;align-items:baseline;gap:8px;padding:11px 14px 7px}
  .sgh b{font-size:1.0625rem;font-weight:700;color:var(--blue);letter-spacing:-.012em}
  .sgh span{font-size:.8125rem;color:var(--label2)}
  .sgh em{margin-left:auto;font-style:normal;font-size:.8125rem;font-weight:700;color:var(--orange)}
  .sgh em.ok{color:var(--red)}
  .sr{display:grid;grid-template-columns:1fr auto 56px;align-items:center;gap:12px;padding:10px 14px;border-top:.5px solid var(--sep)}
  .sr.hide{display:none}
  .sr .n{font-size:1rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sr .n small{font-size:.75rem;color:var(--label2);margin-left:6px}
  .ck{display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;min-width:26px;height:22px;padding:0 6px;border-radius:7px;font-size:.75rem;font-weight:700;background:var(--fill);color:var(--label2)}
  .ck.a{background:var(--fill);color:var(--label)}            /* 出 */
  .ck.l{background:var(--orangeBg);color:var(--orange)}       /* 假 */
  .ck.x{background:var(--orange);color:#fff}                  /* 曠 */
  .ck.y{background:var(--redBg);color:var(--red)}             /* 確認 */
  .ck.n{background:var(--orangeBg);color:var(--orange)}       /* 未接 */
  .cks{display:flex;gap:4px}
  .sr.up{grid-template-columns:1fr auto}
  .cks .ck{min-width:60px;justify-content:flex-start;padding:0 8px}
  .ck s{text-decoration:none;font-weight:600;font-size:.625rem;opacity:.7;margin-right:3px}
  .tot{text-align:right;line-height:1.1}
  .tot b{display:block;font-size:1.0625rem;font-weight:700;letter-spacing:-.02em}
  .tot b small{font-size:.75rem;font-weight:500;color:var(--label2);margin-left:1px}
  .tot b.ok{color:var(--red)} .tot b.bh{color:var(--orange)}
  .tot span{font-size:.6875rem;font-weight:600;color:var(--orange)}
  .tot span.ok{color:var(--red)}
  .mini{height:4px;border-radius:2px;background:var(--fill);margin-top:3px;overflow:hidden}
  .mini i{display:block;height:100%;background:var(--label3);border-radius:2px}
  .mini i.bh{background:var(--orange)}
  .mini i.ok{background:var(--red)}
  .demo{margin:4px 2px 0;font-size:.75rem;color:var(--label3)}
  #sheet .stub{border:1px dashed var(--sep);border-radius:12px;padding:18px 14px;color:var(--label2);font-size:.9375rem;line-height:1.5;text-align:center}

  @media (prefers-reduced-motion:reduce){ .seg i{transition:none} html{scroll-behavior:auto} .bar i,.hbar i{animation:none} #dim{transition:none} .ab,.ab>div,.ar .dc{transition:none} }
  @media (prefers-reduced-transparency:reduce){ .top,.card,#sheet{background:var(--bg0);backdrop-filter:none;-webkit-backdrop-filter:none} }

  /* ── 真資料網頁（4-2）：議程原文排版、日期選單、空狀態 ── */
  .top select.day{-webkit-appearance:none;appearance:none;padding:6px 12px;cursor:pointer}
  .agt{padding:12px 16px 10px;font-size:.9375rem;line-height:1.55}
  .agt p{margin:0 0 6px}
  .agt p b{font-weight:700;color:var(--label)}
  .agt .pin{margin:4px 0 8px;padding-left:12px;border-left:3px solid color-mix(in srgb,var(--sc) 45%,transparent)}
  .agt .hd{display:flex;align-items:baseline;gap:10px;margin:14px 0 8px;font-size:1.0625rem;font-weight:700;letter-spacing:-.012em}
  .agt .hd:first-child,.agt .li2:first-child{margin-top:2px}
  .agt .li2{display:flex;gap:10px;margin:8px 0 10px}
  .agt .li2 .k{flex:none;margin-top:1px;width:24px;height:24px;border-radius:7px;background:var(--fill);font-size:.8125rem;font-weight:700;display:grid;place-items:center}
  .agt .hd .k{flex:none;align-self:center;width:24px;height:24px;border-radius:7px;background:var(--ink);color:var(--inkOn);font-size:.8125rem;display:grid;place-items:center}
  .agt i.nm{font-style:normal;color:var(--blue);font-weight:600}
  .agt i.gp{font-style:normal;color:var(--orange);font-weight:700}
  .agt .lab{margin-top:8px;font-size:.8125rem;font-weight:700;color:var(--sc);letter-spacing:.02em}
  .agt .itm{padding-left:2px}
  .agt .tip{margin-top:4px}
  .agt .gap{height:8px}
  .none{margin:0;padding:12px 2px;color:var(--label2);font-size:.9375rem}
  #s-asst .agt{margin-top:8px}
  details.raw{margin-top:8px;overflow:hidden}
  details.raw summary{list-style:none;cursor:pointer;padding:13px 16px;font-size:.9375rem;font-weight:600;color:var(--label2);display:flex;align-items:center;gap:8px}
  details.raw summary::-webkit-details-marker{display:none}
  details.raw summary::after{content:'›';margin-left:auto;color:var(--label3);font-size:1.25rem;transition:transform 300ms cubic-bezier(.2,.9,.25,1)}
  details.raw[open] summary::after{transform:rotate(90deg)}
  details.raw .agt{border-top:.5px solid var(--sep)}

  .ur .st small.left{font-size:.6875rem;font-weight:700;color:var(--label2);background:var(--fill);border-radius:6px;padding:1px 6px;margin-left:6px}
  .sg.cs .sgh b{color:var(--label2)}
  .sgh .why{font-size:.75rem;color:var(--label3)}
  .ar.u{grid-template-columns:1fr 44px 70px 60px 18px} .fr.hd.u{grid-template-columns:1fr 44px 70px 60px 18px}
`;

var PG_BODY = `<header class="top">
  <div class="t"><div><h1 id="hTitle">13:40</h1><div class="sub" id="hSub"></div></div><div class="tb"><button class="ic" type="button" id="copyAll" title="複製整份 LINE 文字">⧉</button><select class="day" id="daySel" aria-label="選日期"></select></div></div>
  <nav class="idx" id="idx"><a href="#s-today" class="on">今天</a><a href="#s-asst" style="--pc:var(--c-asst)">助理</a><a href="#s-cs" style="--pc:var(--c-cs)">客服</a><a href="#s-lead" style="--pc:var(--c-lead)">主管</a><a href="#s-focus" style="--pc:var(--c-focus)">本日重點</a><a href="#s-biz" style="--pc:var(--c-biz)">業務</a></nav>
</header>

<main>
<section id="s-today"><div class="card hero" id="hero"></div></section>

<section id="s-asst">
  <h2 class="sec"><span class="tt">助理</span><small id="asstSub">排名・註冊未消耗・走到哪一關</small><button class="cp" type="button" data-k="📋">複製</button></h2>
  <div class="rank" id="rank"></div>
  <div class="ask" style="padding:8px 6px 0" id="rankNote"></div>
  <div id="asstCards"></div>
  <details class="raw card flat"><summary>助理報告原文（議程）</summary><div class="agt" id="ag-📋"></div></details>
</section>

<section id="s-cs">
  <h2 class="sec"><span class="tt">客服</span><small>EIP 班況・點一班看名單</small><button class="cp" type="button" data-k="🎧">複製</button></h2>
  <div class="drawer card flat" id="drawer">
    <button class="dh" type="button" id="dhBtn" aria-expanded="false">
      <span class="big" id="dhN">0 <small>班</small></span><span class="dt"><b>點一班看名單</b><span id="dhSub"></span></span><span class="dc">›</span>
    </button>
    <div class="peek" id="peek"></div>
    <div class="dbody" id="dbody"><div class="dinner" id="classes"></div></div>
  </div>
  <details class="raw card flat"><summary>客服報告原文（議程）</summary><div class="agt" id="ag-🎧"></div></details>
</section>

<section id="s-lead">
  <h2 class="sec"><span class="tt">主管</span><small>看完數字，當場點名</small><button class="cp" type="button" data-k="🧑">複製</button></h2>
  <div class="card flat agt" id="ag-🧑"></div>
</section>

<section id="s-focus">
  <h2 class="sec"><span class="tt">本日重點</span><small>衝班、宣導、佈達</small><button class="cp" type="button" data-k="🎤">複製</button></h2>
  <div class="card flat agt" id="ag-🎤"></div>
  <h2 class="sec" style="margin-top:22px" id="vh"><span class="tt">驗收</span><small>上一次的交辦</small><button class="cp" type="button" data-k="⚔️">複製</button></h2>
  <div class="card flat agt" id="ag-⚔️"></div>
</section>

<section id="s-biz">
  <h2 class="sec"><span class="tt">業務</span><small>業績節點</small><button class="cp" type="button" data-k="💼">複製</button></h2>
  <div class="card flat agt" id="ag-💼"></div>
  <div class="legend"><span><i style="background:var(--blue)"></i>人名、班別（可點）</span><span><i style="background:var(--orange)"></i>缺口、沒動、未到</span><span><i style="background:var(--red)"></i>達標、過門檻</span></div>
  <p class="foot" id="foot"></p>
</section>
</main>

<div id="dim"></div>
<div id="sheet" aria-hidden="true"><div class="grip"><i></i></div><div class="in" id="sheetIn"></div></div>
<textarea id="cpBuf" aria-hidden="true" style="position:fixed;left:-9999px;top:0;opacity:0"></textarea>

<script>
var D = window.DATA || {};
function esc(t){ return String(t == null ? '' : t).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function short(n){ n = String(n || ''); return n.length === 3 ? n.slice(1) : n; }
var REGION = D.r === '建國' ? '高雄建國' : D.r;
document.title = REGION + ' 13:40';
document.getElementById('hTitle').textContent = REGION + ' 13:40';
var _sa = String(D.syncAt || ''), _sd = _sa.slice(0, 10).replace(/-/g, '/'), _dd = String(D.date || '').replace(/-/g, '/');
document.getElementById('hSub').textContent = (D.dateLabel || D.date || '') + (_sa ? '・班況 ' + (_sd === _dd ? _sa.slice(11, 16) : _sa.replace(/^\\d{4}\\//, '').slice(0, 11)) + ' 同步' : '・班況還沒同步');

/* 日期選單：留 30 天 */
var sel = document.getElementById('daySel');
(D.dates || []).forEach(function(d, i){ var o = document.createElement('option'); o.value = d; o.textContent = i === 0 ? '最新 ' + d.slice(5) : d.slice(5); if (d === D.date) o.selected = true; sel.appendChild(o); });
sel.addEventListener('change', function(){ var u = (D.baseUrl || '') + '?r=' + encodeURIComponent(D.r) + (sel.selectedIndex ? '&d=' + sel.value : ''); try { window.top.location.href = u; } catch(e){ location.href = u; } });

/* ── 議程原文（LINE 版）切段 ── */
var LINE_TXT = D.agenda || '';
var SEC_KEYS = ['📋', '🎧', '🧑', '🎤', '⚔️', '💼'];
function secText(k){
  var lines = LINE_TXT.split('\\n'), out = [], on = false;
  for (var i = 0; i < lines.length; i++){ var l = lines[i], head = SEC_KEYS.filter(function(x){ return l.indexOf(x) === 0; })[0];
    if (head){ if (on) break; if (head === k) on = true; }
    if (on) out.push(l); }
  return out.join('\\n').replace(/\\n+$/, '');
}
/* 原文排版：標題列拿掉、📌/📊 當小標、①②③ 與 1. 當條目，數字加粗 */
/* 人名、學院藍色；「差 N 個」橘色；其他數字加粗 */
var NAMES = (function(){ var o = {}; ((D.asst && D.asst.fun) || []).forEach(function(x){ var n = short(x.業務); if (n.length >= 2) o[n] = 1; }); ((D.asst && D.asst.unc) || []).forEach(function(x){ var n = short(x.承辦); if (n.length >= 2) o[n] = 1; });
  (D.classes || []).forEach(function(c){ ((c.細查 && c.細查.學生) || []).forEach(function(x){ var n = short(x.承辦); if (n.length >= 2) o[n] = 1; }); });
  ['台一','台二','台三','建國','壢一','壢二','壢三'].forEach(function(n){ o[n] = 1; }); return Object.keys(o).sort(function(a, b){ return b.length - a.length; }); })();
var TOK_RE = new RegExp('(差\\\\s?\\\\d+(?:\\\\.\\\\d+)?\\\\s?(?:個|位|萬|筆|人|組)?)|(\\\\d+(?:\\\\.\\\\d+)?\\\\s?(?:%|萬|位|個|筆|班|天|堂|組|人))' + (NAMES.length ? '|(' + NAMES.join('|') + ')(?![\\\\d一二三四五六七八九十])' : ''), 'g');
function fmtLine(l){
  return esc(l).replace(TOK_RE, function(m, gap, num, nm){ return gap ? '<i class="gp">' + gap + '</i>' : (num ? '<b>' + num + '</b>' : '<i class="nm">' + nm + '</i>'); });
}
function renderSec(k){
  var el = document.getElementById('ag-' + k); if (!el) return;
  var t = secText(k);
  if (!t){ el.innerHTML = '<p class="none">今天議程沒有這一段' + (LINE_TXT ? '' : '（今天的議程檔還沒產生）') + '。</p>'; return; }
  var lines = t.split('\\n').slice(1), h = '';
  var isNum = function(x){ return /^\\d+\\.\\s?/.test(x) || /^[1-9]️⃣/.test(x); };
  lines.forEach(function(l, i){
    var s = l.trim(); if (!s){ h += '<div class="gap"></div>'; return; }
    var next = ''; for (var j = i + 1; j < lines.length; j++){ if (lines[j].trim()){ next = lines[j].trim(); break; } }
    if (/^📌/.test(s)) h += '<p class="pin">' + fmtLine(s.replace(/^📌\\s*/, '')) + '</p>';
    else if (isNum(s)){ var k = (s.match(/^\\d+/) || ['•'])[0], body = s.replace(/^\\d+\\.\\s?/, '').replace(/^[1-9]️⃣\\s?/, '');
      // 底下還有子項 → 當小標；沒有 → 一般條目（數字方塊＋正常字重）
      h += (next && !isNum(next) && !/^[🎯🔥✅🚫⏱🔁]/.test(next) ? '<p class="hd">' : '<p class="li2">') + '<span class="k">' + k + '</span><span>' + fmtLine(body) + '</span></p>'; }
    else if (/^📊/.test(s)) h += '<p class="lab">' + fmtLine(s.replace(/^📊\\s*/, '')) + '</p>';
    else if (/^[①②③④⑤⑥⑦⑧⑨]/.test(s)) h += '<p class="itm">' + fmtLine(s) + '</p>';
    else if (/^[🎯🔥✅🚫⏱🔁]/.test(s)) h += '<p class="tip">' + fmtLine(s) + '</p>';
    else h += '<p>' + fmtLine(s) + '</p>';
  });
  el.innerHTML = h;
}
SEC_KEYS.forEach(renderSec);
if (!secText('⚔️')){ document.getElementById('vh').style.display = 'none'; document.getElementById('ag-⚔️').style.display = 'none'; }

/* ── 助理：排名 ── */
(function(){
  var R = (D.rank && D.rank.rows) || [], el = document.getElementById('rank');
  if (!R.length){ el.style.display = 'none'; return; }
  el.innerHTML = R.map(function(x, i){ return '<div class="card flat"><b class="' + (i === 0 && R.length > 1 ? 'top' : '') + '">' + x.n + '</b><span>' + x.院 + (x.diff != null ? '<i class="' + (x.diff > 0 ? 'up' : '') + '">' + (x.diff > 0 ? '＋' : '') + x.diff + '</i>' : '') + '</span></div>'; }).join('');
  if (R.length === 1) el.style.gridTemplateColumns = '1fr';
  document.getElementById('rankNote').innerHTML = (D.rank.note || '');
})();

/* ── 助理：註冊未消耗＋走到哪一關（各院一列，點開看細節） ── */
(function(){
  var A = D.asst; if (!A){ document.getElementById('asstCards').innerHTML = '<div class="card flat"><p class="none">還沒有助理數據（要先跑一次 🏫 班況）。</p></div>'; return; }
  var orgs = D.r === '建國' ? ['建國'] : ['台一', '台二', '台三'], mo = A.月 ? (+String(A.月).split('/')[1]) + ' 月' : '';
  var U = A.unc || [], F = A.fun || [];
  var stat = orgs.map(function(o){ var u = U.filter(function(x){ return x.院 === o; }); return { o:o, u:u, n:u.length, max:u.reduce(function(a, x){ return Math.max(a, +x.天 || 0); }, 0), done:(A.done || {})[o] }; });
  var worstU = orgs.length > 1 ? stat.slice().sort(function(a, b){ return b.n - a.n || b.max - a.max; })[0].o : '', bestU = orgs.length > 1 ? stat.slice().sort(function(a, b){ return a.n - b.n || a.max - b.max; })[0].o : '';
  var h = '<div class="card flat acc" style="margin-top:10px"><div class="ch">' + (mo ? '<i class="mo">' + mo + '</i>' : '') + '<b><em>' + U.filter(function(x){ return orgs.indexOf(x.院) >= 0; }).length + '</em>筆 註冊未消耗</b><span>新註冊或學員加購、面談紀錄還是未登記・點一家看名單</span></div>'
    + '<div class="fr hd u"><span style="text-align:left">學院</span><span>筆數</span><span>最久沒登記</span><span>本週處理</span><span></span></div>';
  stat.forEach(function(s){
    h += '<div class="ai' + (orgs.length === 1 ? ' open' : '') + '"><button class="ar u" type="button" aria-expanded="' + (orgs.length === 1) + '"><span class="nm">' + s.o + (s.o === worstU && s.n ? '<i class="tag worst">最差</i>' : (s.o === bestU && s.o !== worstU ? '<i class="tag best">最好</i>' : '')) + '</span>'
      + '<span class="v' + (s.o === worstU && s.n ? ' gap' : (s.n ? '' : ' z')) + '">' + s.n + '</span><span class="v d' + (s.o === worstU && s.n ? ' gap' : '') + '">' + (s.n ? s.max + '<small>天</small>' : '—') + '</span><span class="v ' + (s.done ? 'ok' : 'z') + '">' + (s.done == null ? '—' : s.done) + '</span><span class="dc">›</span></button>'
      + '<div class="ab"><div><div class="unc">' + (s.u.length ? s.u.map(function(x){ return '<div class="ur"><div class="l"><div class="st">' + esc(short(x.承辦)) + (x.離職 ? '<small class="left">已離職</small>' : '') + '<span class="sn">' + esc(x.學生) + '</span></div><div class="cr">' + esc(x.課程) + (x.加購 ? '（學員加購）' : '') + '</div></div><div class="dy"><b>' + x.天 + '<small>天</small></b>註冊後還沒登記</div></div>'; }).join('') : '<p class="none">沒有，都登記了。</p>') + '</div></div></div></div>';
  });
  h += '<div class="cf">' + (A.base ? '本週處理掉跟 ' + A.base + ' 存檔比' : '「本週處理」要等週五存檔後才有') + '</div></div>';
  // 走到哪一關
  var sumOf = function(o){ var f = F.filter(function(x){ return x.院 === o; }); var s = { 談過:0, 報名:0, 註冊:0, 進班上課:0 }; f.forEach(function(x){ for (var k in s) s[k] += +x[k] || 0; }); s.f = f; s.rate = s.註冊 ? (s.註冊 - s.進班上課) / s.註冊 : 0; return s; };
  var fs = orgs.map(function(o){ var s = sumOf(o); s.o = o; return s; });
  var worstF = orgs.length > 1 ? fs.slice().sort(function(a, b){ return b.rate - a.rate; })[0].o : '', bestF = orgs.length > 1 ? fs.slice().sort(function(a, b){ return a.rate - b.rate; })[0].o : '';
  var v = function(x, cls){ return '<span class="v' + (cls || (+x ? '' : ' z')) + '">' + x + '</span>'; };
  h += '<div class="card flat acc" id="accF" style="margin-top:8px"><div class="ch">' + (mo ? '<i class="mo">' + mo + '</i>' : '') + '<b>談過的人，走到哪一關</b><span>每一關少幾個，就是掛在那一關的人・點一家看業務</span></div>'
    + '<div class="fr hd"><span style="text-align:left">學院</span><span>談過</span><span>報名</span><span>註冊</span><span>進班上課</span><span></span></div>';
  fs.forEach(function(s){
    var gapCls = s.進班上課 < s.註冊 ? (s.o === worstF ? ' gap' : '') : '';
    h += '<div class="ai' + (orgs.length === 1 ? ' open' : '') + '"><button class="ar" type="button"><span class="nm">' + s.o + (s.o === worstF ? '<i class="tag worst">最差</i>' : (s.o === bestF ? '<i class="tag best">最好</i>' : '')) + '</span>'
      + v(s.談過) + v(s.報名) + v(s.註冊) + '<span class="v' + (s.o === bestF ? ' ok' : gapCls) + '">' + s.進班上課 + '</span><span class="dc">›</span></button>'
      + '<div class="ab"><div><div class="fun">' + s.f.filter(function(x){ return !x.主管; }).sort(function(a, b){ return b.談過 - a.談過; }).map(function(x){
        return '<div class="fr"><span class="nm">' + esc(short(x.業務)) + '</span>' + v(x.談過) + v(x.報名) + v(x.註冊) + '<span class="v' + (x.進班上課 < x.註冊 ? ' gap' : (+x.進班上課 ? '' : ' z')) + '">' + x.進班上課 + '</span><span></span></div>'; }).join('') + '</div></div></div></div>';
  });
  if (orgs.length > 1){ var T = { 談過:0, 報名:0, 註冊:0, 進班上課:0 }; fs.forEach(function(s){ for (var k in T) T[k] += s[k]; });
    h += '<div class="fr sum"><span class="nm">中區合計</span><span class="v">' + T.談過 + '</span><span class="v">' + T.報名 + '</span><span class="v">' + T.註冊 + '</span><span class="v">' + T.進班上課 + '</span><span></span></div>'; }
  h += '<div class="cf" style="padding-top:8px;border-top:0">' + (orgs.length > 1 ? '最差＝註冊了還沒進班上課的比例最高。' : '') + '橘字＝有人註冊了、還沒進班上課。只算 ' + mo + '談過的人，跟上面「註冊未消耗」的數字不一樣。主管不列。漏斗資料 ' + esc(String(A.漏斗同步 || '').replace(/^\\d{4}\\//, '')) + '。</div></div>';
  document.getElementById('asstCards').innerHTML = h;
})();
document.querySelectorAll('.ar').forEach(function(b){ b.addEventListener('click', function(){ var it = b.parentElement, on = !it.classList.contains('open'); it.classList.toggle('open', on); b.setAttribute('aria-expanded', on ? 'true' : 'false'); }); });

/* ── 客服：EIP 班況抽屜 ── */
var CLS = (D.classes || []), byId = {}; CLS.forEach(function(c){ byId[c.cid] = c; });
function grpOf(c){
  if (c.type === '講座') return c.toOpen >= 0 && c.toOpen <= 14 ? '講座' : '';
  if (c.toOpen === 0) return '今天開班';
  if (c.toOpen >= 1 && c.toOpen <= 3) return '3 天內';
  if (c.toOpen >= 4 && c.toOpen <= 14) return '14 天內';
  if (c.phase === '已開班' && c.toOpen <= -1 && c.toOpen >= -3) return '已開班';
  if (c.phase === '已開班' && c.lRate !== '' && c.lRate > 30) return '未到多';
  if (c.toEnd !== '' && c.toEnd >= -2 && c.toEnd <= 7) return '結業';
  return '';
}
CLS.forEach(function(c){ c.grp = grpOf(c); });
var SHOW = CLS.filter(function(c){ return c.grp; });
var GROUPS = [['今天開班','今天開班'],['已開班','開班 3 天內・看第一堂出席'],['3 天內','3 天內要開'],['14 天內','14 天內要開'],['未到多','開班超過 3 天、最近一堂未到超過三成'],['結業','7 天內結業'],['講座','14 天內講座']];
function card(c){
  var pill, mt, bar = '', l1, need = false;
  if (c.type === '講座'){ l1 = c.openMD + ' 講座'; pill = '<span class="pill mute">報名 ' + c.reg + '</span>'; mt = '剩 <b>' + c.toOpen + '</b> 天'; }
  else if (c.toOpen >= 0){ var pct = Math.min(100, c.seat ? c.reg / c.seat * 100 : 0), thp = c.seat ? c.th / c.seat * 100 : 0; need = !c.ok; l1 = c.openMD + ' 開班';
    pill = '<span class="pill ' + (c.ok ? 'ok' : 'need') + '">' + esc(c.stTxt) + '</span>';
    mt = '登記 <b>' + c.reg + '</b>／滿班 ' + c.seat + (c.trial ? '・試聽 ' + c.trial : '') + (c.toOpen ? '・剩 <b>' + c.toOpen + '</b> 天' : '・<b>今天</b>');
    bar = '<div class="bar"><i class="' + (c.ok ? 'ok' : '') + '" style="width:' + pct + '%"></i><u style="left:' + thp + '%"></u></div>'; }
  else if (c.grp === '結業'){ l1 = c.endMD + ' 結業'; pill = '<span class="pill mute">' + (c.toEnd < 0 ? '已結業' : (c.toEnd === 0 ? '今天結業' : '剩 ' + c.toEnd + ' 天')) + '</span>'; mt = '共 ' + c.total + ' 堂・登記 ' + c.reg; }
  else { var f = c.grp === '已開班' ? c.first : c.last, lab = c.grp === '已開班' ? '第一堂' : '最近一堂 ' + (c.last && c.last.md || '');
    l1 = '第 ' + c.dayN + ' 天・' + c.endMD + ' 結業';
    if (!f || !f.應到){ pill = '<span class="pill need">出勤沒上傳</span>'; mt = lab + '出席<i>還沒上傳</i>'; need = true; }
    else { var r = Math.round((f.應到 - f.實到) / f.應到 * 100); need = r > 30; pill = '<span class="pill ' + (r > 30 ? 'need' : 'mute') + '">未到 ' + r + '%</span>';
      mt = lab + '出席 <b>' + f.實到 + '</b>／應到 ' + f.應到 + (f.請假 != null && f.請假 !== '' ? '・請假 ' + f.請假 + '・曠課 ' + f.曠課 : ''); bar = '<div class="bar"><i style="width:' + (f.實到 / f.應到 * 100) + '%"></i></div>'; } }
  return '<div class="card flat cls' + (need ? ' need' : '') + '" id="c-' + c.cid + '" data-id="' + c.cid + '"><div class="l1"><span class="code">' + c.code + '</span><span>' + c.type + '・' + l1 + '</span><span class="sp"></span>' + pill + '</div>'
    + '<div class="nm">' + esc(c.name) + '</div><div class="mt">' + mt + '</div>' + bar + '<div class="ft"><span class="chev">›</span></div></div>';
}
var ch = '', moves = [];
GROUPS.forEach(function(g){ var rows = SHOW.filter(function(c){ return c.grp === g[0]; }); if (rows.length) ch += '<div class="grp">' + g[1] + '</div>' + rows.map(card).join(''); });
document.getElementById('classes').innerHTML = ch || '<p class="none">這幾天沒有要追的班。</p>';
document.getElementById('dhN').innerHTML = SHOW.length + ' <small>班</small>';
var cnt = function(gs){ return SHOW.filter(function(c){ return gs.indexOf(c.grp) >= 0; }).length; };
document.getElementById('dhSub').textContent = '已開班 ' + cnt(['已開班','未到多']) + '・要開 ' + cnt(['今天開班','3 天內','14 天內']) + '・結業 ' + cnt(['結業']);

/* 今天要動（最多三張）：今天開班 → 3 天內差人 → 第一堂未到超過三成 → 14 天內差人 */
SHOW.filter(function(c){ return c.grp === '今天開班'; }).forEach(function(c){ moves.push({ c:c, t:'<em>今天開班</em>，登記 ' + c.reg + '／滿班 ' + c.seat, d:c.code + ' ' + c.name }); });
SHOW.filter(function(c){ return (c.grp === '3 天內' || c.grp === '14 天內') && !c.ok; }).sort(function(a, b){ return a.toOpen - b.toOpen; }).forEach(function(c){ moves.push({ c:c, t:'<em>' + esc(c.stTxt) + '</em>，剩 ' + c.toOpen + ' 天', d:c.code + ' ' + c.name + '・登記 ' + c.reg + '／門檻 ' + c.th }); });
SHOW.filter(function(c){ return c.grp === '已開班' && c.first && c.first.應到 && (c.first.應到 - c.first.實到) / c.first.應到 > .3; }).forEach(function(c){ var r = Math.round((c.first.應到 - c.first.實到) / c.first.應到 * 100); moves.splice(Math.min(moves.length, 2), 0, { c:c, t:'第一堂<em>未到 ' + r + '%</em>，追曠課', d:c.code + ' ' + c.name + '・出席 ' + c.first.實到 + '／應到 ' + c.first.應到 }); });
var n3 = cnt(['3 天內']), nNeed = SHOW.filter(function(c){ return (c.grp === '3 天內' || c.grp === '14 天內') && !c.ok; }).length, nToday = cnt(['今天開班']);
var hero = '<h2>' + (nToday ? '今天開 <b>' + nToday + '</b> 班。' : '今天沒有班要開。') + '3 天內開 <b>' + n3 + '</b> 班，<b>' + nNeed + '</b> 班還差人。</h2>';
moves.slice(0, 3).forEach(function(m, i){ hero += '<div class="move" data-id="' + m.c.cid + '"><span class="k">' + (i + 1) + '</span><div class="mv"><div class="t">' + m.t + '</div><div class="d">' + esc(m.d) + '</div></div><span class="chev">›</span></div>'; });
if (!CLS.length) hero = '<h2>班況還沒同步。</h2><p class="none">在業績數據中心按一次 🏫 班況（或 ⚡ 全部同步），這裡就會出現。</p>';
document.getElementById('hero').innerHTML = hero;
/* 抽屜：露出最急那一班 */
var peekId = moves.length ? moves[0].c.cid : (SHOW[0] && SHOW[0].cid), peekEl = peekId && document.getElementById('c-' + peekId);
if (peekEl){ var clone = peekEl.cloneNode(true); clone.removeAttribute('id'); document.getElementById('peek').appendChild(clone); peekEl.classList.add('top1'); }
var drawer = document.getElementById('drawer');
function openDrawer(){ drawer.classList.add('open'); document.getElementById('dhBtn').setAttribute('aria-expanded', 'true'); }
document.getElementById('dhBtn').addEventListener('click', function(){ if (drawer.classList.contains('open')){ drawer.classList.remove('open'); this.setAttribute('aria-expanded', 'false'); } else openDrawer(); });

/* ── 複製（iframe 裡 clipboard 可能被擋 → 退回 execCommand） ── */
function copyText(t){
  var ok = function(){ return true; };
  try { if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t).then(ok, function(){ return legacy(t); }); } catch(e){}
  return Promise.resolve(legacy(t));
}
function legacy(t){ var ta = document.getElementById('cpBuf'); ta.value = t; ta.focus(); ta.select(); try { return document.execCommand('copy'); } catch(e){ return false; } }
function flash(btn, txt){ var t = btn.textContent; btn.textContent = txt || '已複製'; btn.classList.add('done'); setTimeout(function(){ btn.textContent = t; btn.classList.remove('done'); }, 1200); }
document.querySelectorAll('h2.sec .cp').forEach(function(b){ b.addEventListener('click', function(e){ e.stopPropagation(); var t = secText(b.dataset.k); if (!t){ flash(b, '沒有這段'); return; } copyText(t).then(function(){ flash(b); }); }); });
document.getElementById('copyAll').addEventListener('click', function(){ var b = this; if (!LINE_TXT){ return; } copyText(LINE_TXT.trim()).then(function(){ b.textContent = '✓'; setTimeout(function(){ b.textContent = '⧉'; }, 1200); }); });

/* ── 章節索引 ── */
var links = [].slice.call(document.querySelectorAll('.idx a')), secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); });
links.forEach(function(a){ a.addEventListener('click', function(e){ e.preventDefault(); var t = document.querySelector(a.getAttribute('href')); if (t) window.scrollTo({ top: t.offsetTop - 118, behavior: 'smooth' }); }); });
function syncIdx(){ var y = window.scrollY + 140, cur = 0; secs.forEach(function(s, i){ if (s && s.offsetTop <= y) cur = i; });
  links.forEach(function(a, i){ a.classList.toggle('on', i === cur); }); }
window.addEventListener('scroll', syncIdx, { passive:true });

/* ── 細查面板（真資料：rows[].細查） ── */
var sheet = document.getElementById('sheet'), dim = document.getElementById('dim'), sheetIn = document.getElementById('sheetIn'), SPRING = 'cubic-bezier(.2,.9,.25,1)';
var CKC = { '出':'a', '假':'l', '曠':'x', '未':'', '確認':'y', '未接':'n' };
function ck(v, label, tag){ return '<span class="ck ' + (CKC[v] || '') + '"' + (label ? ' title="' + label + '"' : '') + '>' + (tag ? '<s>' + tag + '</s>' : '') + (v === '確認' ? '✓' : (v || '—')) + '</span>'; }
function stuOf(c){
  var q = c.細查; if (!q || !q.學生) return null;
  var done = q.已上 || 0, need = q.門檻 || 0;
  return q.學生.map(function(s){ var at = +s.累計出席 || 0, ok = need > 0 && at >= need;
    return { rep: s.負責 === '客服登記' ? '客服登記' : (short(s.負責 || s.登記人員 || s.承辦) || '（沒有登記人員）'), name: s.姓名, kind: s.別, c7: s.前七天, c3: s.前三天, c0: s.當天確認, at: at, lv: +s.請假 || 0, ab: +s.曠課 || 0, last: s.最近一堂 || '', lastD: s.最近一堂日期 || '', need: need, ok: ok, behind: !ok && at < Math.min(need, Math.ceil((q.已讀 || 0) / 3)) }; });
}
function detail(c){
  var L = stuOf(c), up = c.toOpen > 0 || c.type === '講座', q = c.細查 || {};
  if (!L) return '<div class="stub">這班還沒有名單。' + (c.type === '講座' ? '講座不讀名單。' : '出席細查會分好幾次讀完，下次同步就會出現。') + '</div>';
  var by = {}, order = [];
  L.forEach(function(x){ if (!by[x.rep]){ by[x.rep] = []; order.push(x.rep); } by[x.rep].push(x); });
  var bad = function(x){ return up ? x.c7 !== '確認' && x.c3 !== '確認' : x.behind; };
  order.sort(function(a, b){ return (a === '客服登記') - (b === '客服登記') || by[b].filter(bad).length - by[a].filter(bad).length || by[b].length - by[a].length; });   // 客服登記的放最後
  var nBad = L.filter(bad).length, nMiss = up ? 0 : L.filter(function(x){ return x.last && x.last !== '出'; }).length;
  var seg = up ? [['all', '全部', L.length], ['bad', '還沒確認', nBad]] : [['all', '全部', L.length], ['bad', '落後', nBad], ['miss', '最近一堂沒到', nMiss]];
  var h = '<div class="seg" id="seg">' + seg.map(function(x, i){ return '<button type="button" data-f="' + x[0] + '"' + (i ? '' : ' aria-pressed="true"') + '>' + x[1] + '<b>' + x[2] + '</b></button>'; }).join('') + '<i></i></div>';
  h += up ? '<p class="rule">還沒開班：看名單跟客服確認。<b>七／三／當</b>＝開班前七天、前三天、當天客服打的結果，<b>✓</b> 確認、<b>未接</b> 沒接到。</p>'
          : '<p class="rule">達標＝累計出席 ≥ 全期 ' + (c.total || '?') + ' 堂的 1/3（<b>' + (q.門檻 || '?') + ' 堂</b>）。已上 ' + (q.已上 || 0) + ' 堂' + ((q.已讀 || 0) < (q.已上 || 0) ? '，目前讀到 ' + (q.已讀 || 0) + ' 堂（其餘下次同步補讀）' : '') + '，照進度該到 <b>' + Math.min(q.門檻 || 0, Math.ceil((q.已讀 || 0) / 3)) + ' 堂</b>，沒到的算<b style="color:var(--orange)">落後</b>。</p>';
  order.forEach(function(rp){
    var g = by[rp], gb = g.filter(bad).length;
    h += '<div class="sg' + (rp === '客服登記' ? ' cs' : '') + '"><div class="sgh"><b>' + esc(rp) + '</b>' + (rp === '客服登記' ? '<span class="why">登記人員、承辦人都不是業務</span>' : '') + '<span>' + g.length + ' 位</span><em class="' + (gb ? '' : 'ok') + '">' + (gb ? (up ? gb + ' 位還沒確認' : gb + ' 位落後') : (up ? '都確認了' : (g.every(function(x){ return x.ok; }) ? '都達標' : '都照進度'))) + '</em></div>';
    g.sort(function(a, b){ return bad(b) - bad(a) || (up ? 0 : a.at - b.at); }).forEach(function(x){
      var miss = up ? false : (x.last && x.last !== '出');
      h += '<div class="sr' + (up ? ' up' : '') + '" data-bad="' + (bad(x) ? 1 : 0) + '" data-miss="' + (miss ? 1 : 0) + '"><span class="n">' + esc(x.name) + (x.kind && x.kind !== '正取' ? '<small>' + esc(x.kind) + '</small>' : '') + '</span>';
      if (up) h += '<span class="cks">' + ck(x.c7, '前七天', '七') + ck(x.c3, '前三天', '三') + ck(x.c0, '當天', '當') + '</span>';
      else { var pct = Math.min(100, x.need ? x.at / x.need * 100 : 0);
        h += ck(x.last, '最近一堂 ' + x.lastD) + '<span class="tot"><b class="' + (x.ok ? 'ok' : x.behind ? 'bh' : '') + '">' + x.at + '<small>／' + x.need + '</small></b><div class="mini"><i class="' + (x.ok ? 'ok' : x.behind ? 'bh' : '') + '" style="width:' + Math.max(pct, 4) + '%"></i></div></span>'; }
      h += '</div>';
    });
    h += '</div>';
  });
  return h + '<p class="demo">依「登記人員」分組；登記人員不是業務才看承辦人。名單讀取日 ' + esc(q.名單讀 || '—') + '。往下拖可以關掉。</p>';
}
function bindSeg(){
  var seg = document.getElementById('seg'); if (!seg) return;
  var bs = [].slice.call(seg.querySelectorAll('button')), pill = seg.querySelector('i');
  var place = function(b){ pill.style.width = b.offsetWidth + 'px'; pill.style.transform = 'translateX(' + (b.offsetLeft - 3) + 'px)'; };
  requestAnimationFrame(function(){ place(bs[0]); });
  bs.forEach(function(b){ b.addEventListener('pointerdown', function(){ place(b); });
    b.addEventListener('click', function(){ var f = b.dataset.f;
      bs.forEach(function(x){ x.removeAttribute('aria-pressed'); }); b.setAttribute('aria-pressed', 'true'); place(b);
      sheetIn.querySelectorAll('.sr').forEach(function(r){ r.classList.toggle('hide', f !== 'all' && r.dataset[f] !== '1'); });
      sheetIn.querySelectorAll('.sg').forEach(function(g){ g.classList.toggle('hide', !g.querySelector('.sr:not(.hide)')); }); }); });
}
function openSheet(c){
  var L = stuOf(c) || [], up = c.toOpen > 0 || c.type === '講座';
  var g4 = up ? [[c.reg, c.type === '講座' ? '報名' : '登記'], [c.seat, '滿班'], [c.th || '—', '門檻'], [c.trial || 0, '試聽']]
    : [[L.length, '學生'], [L.filter(function(x){ return x.last === '出'; }).length, '最近一堂到'], [L.filter(function(x){ return x.ok; }).length, '達標'], [L.filter(function(x){ return x.behind; }).length, '落後']];
  sheetIn.innerHTML = '<h4>' + esc(c.name) + '</h4><div class="s">' + c.code + '・' + c.type + '・' + c.openMD + ' 開班' + (c.endMD ? '・' + c.endMD + ' 結業' : '') + '</div><div class="g4">' + g4.map(function(x){ return '<div><b>' + x[0] + '</b><span>' + x[1] + '</span></div>'; }).join('') + '</div>' + detail(c);
  bindSeg();
  document.body.classList.add('lock'); dim.classList.add('on'); sheet.setAttribute('aria-hidden', 'false');
  sheet.style.transition = 'none'; sheet.style.transform = 'translateY(100%)'; sheet.scrollTop = 0;
  requestAnimationFrame(function(){ requestAnimationFrame(function(){ sheet.style.transition = 'transform 420ms ' + SPRING; sheet.style.transform = 'translateY(0)'; }); });
}
function closeSheet(v){ var ms = Math.max(180, Math.min(360, 360 - (v || 0) / 10)); sheet.style.transition = 'transform ' + ms + 'ms cubic-bezier(.3,.7,.4,1)'; sheet.style.transform = 'translateY(100%)'; dim.classList.remove('on'); document.body.classList.remove('lock'); sheet.setAttribute('aria-hidden', 'true'); }
dim.addEventListener('click', function(){ closeSheet(0); });
document.addEventListener('click', function(e){ var el = e.target.closest('[data-id]'); if (el && byId[el.dataset.id]) openSheet(byId[el.dataset.id]); });
/* 1:1 跟手拖曳、照放開速度決定關或回彈 */
var drag = null;
sheet.addEventListener('pointerdown', function(e){ if (sheet.scrollTop > 0 || e.target.closest('.seg')) return; drag = { y0:e.clientY, hist:[[e.clientY, performance.now()]], on:false, id:e.pointerId }; });
sheet.addEventListener('pointermove', function(e){ if (!drag) return; var dy = e.clientY - drag.y0;
  if (!drag.on){ if (Math.abs(dy) < 10) return; if (dy < 0){ drag = null; return; } drag.on = true; try { sheet.setPointerCapture(drag.id); } catch(x){} sheet.style.transition = 'none'; }
  sheet.style.transform = 'translateY(' + Math.max(0, dy) + 'px)'; drag.hist.push([e.clientY, performance.now()]); if (drag.hist.length > 6) drag.hist.shift(); });
function endDrag(e){ if (!drag) return; var d = drag; drag = null; if (!d.on) return;
  var a = d.hist[0], b = d.hist[d.hist.length - 1], v = (b[1] - a[1]) > 0 ? (b[0] - a[0]) / (b[1] - a[1]) * 1000 : 0, dy = e.clientY - d.y0;
  var proj = dy + (v / 1000) * 0.998 / (1 - 0.998);
  if (v > 500 || proj > sheet.offsetHeight * .45) closeSheet(v); else { sheet.style.transition = 'transform 380ms ' + SPRING; sheet.style.transform = 'translateY(0)'; } }
sheet.addEventListener('pointerup', endDrag); sheet.addEventListener('pointercancel', endDrag);

document.getElementById('foot').textContent = '議程由 9:30 排程產生（' + (D.agendaDate || '—') + '）；班況、出席、助理數據由業績數據中心同步 EIP（' + (D.syncAt || '—') + '）。開班門檻＝滿班 × 2/3。網頁留 30 天。';
</script>
`;

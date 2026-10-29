/**
 * 13:40 網頁版｜v1.11｜2026-10-29
 * 版本史：v1（10/21）第一版｜v1.1（10/22）細查名單改用「登記人員」分組（不是業務才退回承辦人，兩個都不是業務就歸「客服登記」）；離職名單上的人不列｜v1.2（10/22）加速：資料先算好放快取（送班況時就算），&fmt=json 只交資料給 GitHub 上的 1340.html；送業績快照時只換報到排名｜v1.3（10/22）加桃區（?r=桃區，13:30；議程是 LINE日會 第三段）； 主管名單分頁｜v1.4（10/22）首頁一句改「7 天內開幾班＋差人的班」、報到改一家一行（昨天 +N、全省第 N）、要開的班獨立一張橘色卡｜v1.5（10/22）報到改取「那一天最高的一筆」（業績中心有時資料沒載完就推，台三同一天 77→70）｜v1.6（10/22）議程顯示時拿掉離職名單上的人、「沒動」改成「沒有新增報到／面談／登記」（舊議程也套用）；桃區還沒有議程時講清楚哪天開始；走到哪一關「進班上課」拆成「排進班」「上過課」｜v1.7（10/22）會議模式（電腦版儀表板）＋昨天冠軍：多帶七家入帳、每位業務的報到／面談／註冊、七家報到排名｜v1.8（10/22）會議模式加「視角」（各院自己開會）：多帶全部業務的報到／面談／註冊、報到明細（誰、哪天、哪個通路）、每班的學院｜v1.9（10/22）會議模式手機、平板也能用（只改版面，資料不變）｜v1.10（10/23）議程改讀「13:40 日會議程」資料夾的「議程全文 YYYY-MM-DD.txt」（LINE日會 改成只推網址）；舊日期退回讀 LINE日會；看最新時議程拿今天的（不再跟著班況日期，修桃區 10/23 空白）
 * 網址：部署網址後面加 ?r=中區 或 ?r=建國（桃區預留：?r=桃區，等 Ivan 開口再開）
 *   可加 &d=2026-10-21 看那天的版本；網頁資料留 30 天
 * 資料：
 *   班況、出席細查、助理數據 ← 「13:40 日會議程」資料夾裡「網頁資料 YYYY-MM-DD.json」（業績數據中心 🏫 班況送過來時存的）
 *   議程文字 ← 「LINE 推播」資料夾裡「LINE日會 YYYY-MM-DD.txt」（9:30 排程產生；中區在前、<<<NEXT>>> 後面是高雄）
 *   報到排名 ← 快照表「數據」分頁
 */
var PG_PREFIX = '網頁資料 ';
var PG_KEEP_DAYS = 30;
var PG_REGIONS = { '中區': { 區: '中區', orgs: ['台一', '台二', '台三'], part: 0, label: '中區', time: '13:40' },
                   '建國': { 區: '南區', orgs: ['建國'], part: 1, label: '高雄建國', time: '13:40' },
                   '桃區': { 區: '桃竹區', orgs: ['壢一', '壢二', '壢三'], part: 2, label: '桃區', time: '13:30' } };   // v1.3
var PG_FULL = { '台中學院': '台一', '台中二部': '台二', '台中三部': '台三', '中壢學院': '壢一', '中壢二部': '壢二', '中壢三部': '壢三', '高雄建國': '建國' };

function pgDoGet_(e) {
  var r = String(e.parameter.r || ''), d = String(e.parameter.d || ''), json = e.parameter.fmt === 'json';
  if (!PG_REGIONS[r]) return json ? bkJson_({ ok: false, error: '網址後面要加 ?r=中區、?r=建國 或 ?r=桃區' })
    : HtmlService.createHtmlOutput('<p style="font:16px system-ui;padding:24px">網址後面要加 ?r=中區、?r=建國 或 ?r=桃區</p>');
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
function pgKey_(r, d) { return 'pg6|' + r + '|' + (d || 'latest'); }   // v1.10 換 pg6：新版一上線就重算，不吃舊快取
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
  if (s && !d && pgAgendaLate_(s, r)) s = null;
  if (!s) { s = JSON.stringify(pgData_(r, d)); try { pgCachePut_(key, s); } catch (err) {} }
  return s;
}
// 快取裡的議程比班況舊（班況今天送了、議程 9:30 才產生）→ 10 分鐘查一次 Drive 有沒有那天的議程
function pgAgendaLate_(s, r) {
  var o; try { o = JSON.parse(s); } catch (err) { return true; }
  var today = Utilities.formatDate(new Date(), BK_TZ, 'yyyy-MM-dd');   // v1.10：議程看「今天」，不是看班況那天
  if (o.agendaDate === today) return false;
  // v1.11（10/29 Ivan：LINE 推來的連結點開還是昨天的議程）：原本三區共用一個「10 分鐘內查過就不再查」的記號，
  //   議程 9:5x 才產生時，前 10 分鐘有人開過網頁就會一直拿到舊的 → 改成每區各自一個記號、只擋 1 分鐘
  var c = CacheService.getScriptCache(), k = 'pg2|agchk|' + (r || '') + '|' + today;
  if (c.get(k)) return false;
  c.put(k, '1', 60);
  try {
    if (DriveApp.getFolderById(BK_CSV_FOLDER).searchFiles("title contains '議程全文 " + today + "'").hasNext()) return true;
    return DriveApp.getFolderById(BK_LINE_FOLDER).searchFiles("title contains 'LINE日會 " + today + "'").hasNext();
  } catch (err) { return false; }
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
  var keep = (body.rows || []).filter(function (r) { return r.區 === '中區' || r.區 === '南區' || r.區 === '桃竹區'; });   // v1.3 加桃區
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
  // v1.10：看最新的時候，議程拿「今天」的（早上 9:30 議程先出來，班況下午才送）；看舊日期才用那天的
  var today = Utilities.formatDate(new Date(), BK_TZ, 'yyyy-MM-dd');
  var ag = pgAgenda_((d && date) ? date : today, R.part);
  var rank = pgRank_(r, date), ppl = pgPeople_();
  return pgBuild_(r, snap, ag, rank, dates, date, ScriptApp.getService().getUrl(), ppl);
}

// 誰是業務（快照表「業務」分頁出現過的人）、誰離職了（「離職名單」分頁）
function pgPeople_() {
  try {
    var ss = SpreadsheetApp.openById(BK_SHEET_ID), sales = {}, sh = ss.getSheetByName('業務');
    var stats = {};
    if (sh) {
      var n = sh.getLastRow(), from = Math.max(2, n - 2000), vals = sh.getRange(from, 1, n - from + 1, 11).getDisplayValues();
      vals.forEach(function (v) { if (v[3]) sales[String(v[3]).trim()] = 1; });
      stats = pgStats_(vals);
    }
    return { sales: Object.keys(sales), left: bkLeft_(ss), boss: bkBoss_(ss), stats: stats };
  } catch (err) { return { sales: [], left: [], boss: [], stats: {} }; }
}
// v1.7：每位業務最新的報到／面談／註冊A（業務分頁：寫入時間|資料日期|學院|業務|目前總報到|網際網路|到月底報到|面談|報名|註冊A|註冊B）
//   最新的資料日期裡，取「七家報到加總最高」的那一批（沒載完就推的批次會比較少）
function pgStats_(vals) {
  var lastD = '', batch = {};
  vals.forEach(function (v) { var d = String(v[1]); if (d > lastD) lastD = d; });
  vals.forEach(function (v) { if (String(v[1]) !== lastD) return; var b = batch[v[0]] || (batch[v[0]] = { sum: 0, rows: [] }); b.sum += +String(v[4]).replace(/,/g, '') || 0; b.rows.push(v); });
  var best = null; Object.keys(batch).forEach(function (k) { if (!best || batch[k].sum > best.sum) best = batch[k]; });
  var out = {}; if (!best) return out;
  best.rows.forEach(function (v) { var num = function (x) { return +String(x).replace(/,/g, '') || 0; };
    out[v[2] + '|' + String(v[3]).trim()] = { 報到: num(v[4]), 面談: num(v[7]), 報名: num(v[8]), 註冊: num(v[9]) }; });
  out._d = lastD; return out;
}
// v1.7：入帳（會議模式、昨天冠軍）——七家都帶（三區總覽、中壢以南比較要用）；離職的拿掉；不是業務的（主管、客服、副理）標 nb，冠軍不排他
function pgInc_(A, ppl) {
  var I = A && A.入帳; if (!I) return null;
  var isLeft = function (n) { return bkIsLeft_(ppl.left || [], n); };
  var nb = function (n) { n = String(n || '').trim(); return !n || bkIsLeft_(ppl.boss || [], n) || (ppl.sales.length && ppl.sales.indexOf(n) < 0); };
  var st = ppl.stats || {};
  var people = {};
  (I.人 || []).forEach(function (r) { if (isLeft(r[1])) return; var k = r[0] + '|' + r[1]; if (!people[k]) people[k] = { 院: r[0], 名: bkShort_(r[1]), nb: nb(r[1]), s: st[r[0] + '|' + r[1]] || null }; });
  return { 同步: I.同步 || '', 月: I.月 || '', 日: I.日 || [], 人: (I.人 || []).filter(function (r) { return !isLeft(r[1]); }),
    明細: (I.明細 || []).filter(function (r) { return !isLeft(r[1]); }), 誰: people, 業務資料日: st._d || '' };
}
// v1.8：全部業務（會議模式的報到排名用）——業務分頁最新一批，離職的拿掉，主管標 nb
function pgPpl_(ppl) {
  var st = (ppl && ppl.stats) || {}, out = [];
  Object.keys(st).forEach(function (k) { if (k === '_d') return; var q = k.split('|'), nm = q[1];
    if (bkIsLeft_(ppl.left || [], nm)) return;
    out.push({ 院: q[0], 全名: nm, 名: bkShort_(nm), nb: bkIsLeft_(ppl.boss || [], nm), 報到: st[k].報到, 面談: st[k].面談, 註冊: st[k].註冊 }); });
  return { d: st._d || '', 人: out };
}
// v1.8：報到明細（擴充 5.73 起才有）：[院, 承辦全名, 學生, 日期, 時間, 通路, 後來走到哪]，離職的人拿掉
function pgCk_(A, ppl) {
  var C = A && A.報到明細; if (!C) return null;
  return { 同步: C.同步 || '', 完整: !!C.完整, 列: (C.列 || []).filter(function (r) { return !bkIsLeft_(ppl.left || [], r[1]); }) };
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
  // v1.10（10/23）：排程把三區全文存成「議程全文 YYYY-MM-DD.txt」（13:40 日會議程資料夾，n8n 不看），LINE日會 只放網址
  //   新的日期在前；同一天「議程全文」優先；LINE日會 裡沒有主管段（只有網址）的不拿來當議程
  var cand = [];
  [[BK_CSV_FOLDER, '議程全文'], [BK_LINE_FOLDER, 'LINE日會']].forEach(function (x, src) {
    var it = DriveApp.getFolderById(x[0]).searchFiles("title contains '" + x[1] + " '");
    while (it.hasNext()) { var f = it.next(), m = f.getName().match(/(\d{4}-\d{2}-\d{2})/); if (m && m[1] <= date) cand.push({ f: f, d: m[1], src: src }); }
  });
  cand.sort(function (a, b) { return a.d < b.d ? 1 : (a.d > b.d ? -1 : a.src - b.src); });
  for (var i = 0; i < cand.length && i < 12; i++) {
    var t = cand[i].f.getBlob().getDataAsString();
    if (cand[i].src === 1 && t.indexOf('主管') < 0) continue;
    var parts = t.split(/\n?<<<NEXT>>>\n?/);
    return { text: (parts[part] || '').trim(), date: cand[i].d };
  }
  return { text: '', date: '' };
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
    if (!o[org] || n > o[org][1]) o[org] = [String(v[0]), n];   // v1.5：同一天取最高（報到是當月累計，不會變少；變少的是沒載完就推的批次）
  });
  var days = Object.keys(byDay).sort(); if (!days.length) return null;
  var cur = byDay[days[days.length - 1]], prev = days.length > 1 ? byDay[days[days.length - 2]] : null;
  var all = Object.keys(cur).map(function (o) { return { 院: o, n: cur[o][1], diff: prev && prev[o] ? cur[o][1] - prev[o][1] : null }; }).sort(function (a, b) { return b.n - a.n; });
  all.forEach(function (x, i) { x.rank = i + 1; });
  var mine = all.filter(function (x) { return PG_REGIONS[r].orgs.indexOf(x.院) >= 0; });
  var top3 = all.slice(0, 3).map(function (x) { return '<b>' + x.院 + ' ' + x.n + '</b>'; }).join('、');
  var note = '全省前三：' + top3 + '。' + mine.map(function (x) { return x.院 + '全省第 ' + x.rank; }).join('、') + '。'
    + (prev ? '增減是跟 ' + bkMD_(days[days.length - 2]) + ' 比。' : '') + '（' + bkMD_(days[days.length - 1]) + ' 資料）';
  return { rows: mine, all: all, note: note, cur: bkMD_(days[days.length - 1]), prev: prev ? bkMD_(days[days.length - 2]) : '' };   // v1.4；v1.7 多給七家 all（會議模式七家比）
}

// 純計算：組出網頁要的資料（node 也能測）
function pgBuild_(r, snap, ag, rank, dates, date, baseUrl, ppl) {
  var R = PG_REGIONS[r], todayS = snap ? snap.today : '';
  ppl = ppl || { sales: [], left: [], boss: [] };
  var rows = snap ? snap.rows.filter(function (x) { return x.區 === R.區 && (R.orgs.indexOf(x.院) >= 0); }) : [];
  var classes = rows.map(function (x) {
    var c = bkCalc_(x, todayS), f = c.f || null, l = c.l || null;
    return { cid: x.cid, 院: x.院 || '', code: c.code, name: x.班名, type: x.類型, phase: c.phase, toOpen: c.toOpen, dayN: c.dayN, toEnd: c.toEnd,
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
      fun: (A.走到哪一關 || []).filter(function (x) { return R.orgs.indexOf(x.院) >= 0 && !bkIsLeft_(ppl.left, x.業務); })
        .map(function (x) { return (!x.主管 && bkIsLeft_(ppl.boss || [], x.業務)) ? Object.assign({}, x, { 主管: true }) : x; }) };
  }
  var label = '';
  if (date) { var m = date.match(/(\d{4})-(\d{2})-(\d{2})/); label = (+m[2]) + '/' + (+m[3]) + '（' + bkWk_(m[1] + '/' + m[2] + '/' + m[3]) + '）'; }
  return { r: r, label: R.label, time: R.time, orgs: R.orgs, date: date || '', dateLabel: label, dates: dates, syncAt: snap ? snap.at : '', classes: classes, asst: asst, rank: rank,
    inc: snap && snap.asst ? pgInc_(snap.asst, ppl) : null, ppl: pgPpl_(ppl), ck: snap && snap.asst ? pgCk_(snap.asst, ppl) : null,
    agenda: pgCleanAg_(ag.text, ppl.left), agendaDate: ag.date, agNone: ag.text ? '' : pgAgNone_(r, ag.date), baseUrl: baseUrl };
}

// v1.6（10/22 Ivan）：議程顯示前整理——舊議程也照現在的規則
//   ① 離職名單上的人：清單裡的「瑋庭 2、」拿掉；講他的那一行整行拿掉；「這三位」跟著改成剩下的人數
//   ② 不寫「沒動」：報到那行→「沒有新增報到」、面談→「沒有新增面談」、班的人數→「沒有新增登記」
function pgCleanAg_(text, left) {
  if (!text) return text || '';
  var full = (left || []).filter(function (n) { return n && n.length >= 2; });
  var names = full.concat(full.map(function (n) { return bkShort_(n); })).filter(function (n, i, a) { return n.length >= 2 && a.indexOf(n) === i; });
  var esc = function (n) { return n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
  var out = [];
  text.split('\n').forEach(function (ln) {
    var t = ln;
    names.forEach(function (n) {
      t = t.replace(new RegExp(esc(n) + '\\s*\\d+\\s*[、，,]\\s*', 'g'), '')
           .replace(new RegExp('[、，,]\\s*' + esc(n) + '\\s*\\d+(?=\\s*[。.]?\\s*$)', 'g'), '');
    });
    if (names.some(function (n) { return t.indexOf(n) >= 0; })) return;   // 還有他的名字 → 這一行是在講他，整行拿掉
    out.push(pgNoMove_(t));
  });
  var CN = ['', '一', '兩', '三', '四', '五', '六'];
  for (var i = 0; i < out.length; i++) {
    if (!/^\s*這[一二兩三四五六七八九]位/.test(out[i])) continue;
    var k = 0; for (var j = i - 1; j >= 0 && /這個月/.test(out[j]); j--) k++;
    if (k > 0 && k < CN.length) out[i] = out[i].replace(/這[一二兩三四五六七八九]位/, '這' + CN[k] + '位');
  }
  return out.join('\n');
}
function pgNoMove_(ln) {
  if (ln.indexOf('動') < 0) return ln;
  var kind = /報到/.test(ln) ? '報到' : (/面談/.test(ln) ? '面談' : (/登記|滿班|門檻|開班|班）|\d{4} /.test(ln) ? '登記' : '報到'));
  return ln.replace(/沒動/g, '沒有新增' + kind).replace(/都有動/g, '都有新增' + kind);
}
// v1.6：這一區今天還沒有議程時，網頁空白處要講什麼
function pgAgNone_(r, agDate) {
  if (r === '桃區' && (!agDate || agDate < '2026-10-23')) return '桃區議程從 10/23（五）09:30 第一次產生，之後週一、三、五自動更新。現在先看上面的班況和助理數字。';
  if (!agDate) return '議程檔還沒產生（週一、三、五 09:30 產生）。';
  return bkMD_(agDate.replace(/-/g, '/')) + ' 那份議程沒有這一區。';
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
  #accF .fr,#accF .ar{grid-template-columns:minmax(0,1fr) 34px 34px 34px 46px 46px 14px;gap:3px}   /* v1.6 五欄：談過 報名 註冊 排進班 上過課 */
  #accF .ar .nm{flex-wrap:wrap;row-gap:3px}
  #accF .fr.hd span:nth-child(5)::after{content:'›';margin-left:3px;color:var(--label3)}
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

  /* 10/22：報到一家一行 */
  .rk.card{display:block;padding:2px 16px 4px}
  .rk-h{font-size:.8125rem;font-weight:600;color:var(--label2);padding:10px 0 6px}
  .rk-h small{font-weight:500;margin-left:2px}
  .rk-r{display:grid;grid-template-columns:2.6em 1fr auto auto;align-items:baseline;column-gap:12px;padding:9px 0;border-top:.5px solid var(--sep)}
  .rk-r .o{font-weight:600}
  .rk-r .n{font-size:.875rem;color:var(--label2)}
  .rk-r .n b{font-size:1.5rem;font-weight:700;letter-spacing:-.02em;color:var(--label);font-variant-numeric:tabular-nums}
  .rk-r .n b.top{color:var(--red)}
  .rk-r .df{font-size:.875rem;color:var(--label2);white-space:nowrap}
  .rk-r .df i{font-style:normal;font-weight:700;color:var(--label2)}
  .rk-r .df i.up{color:var(--red)}
  .rk-r .df i.dn{color:var(--c-focus)}
  .rk-r .rk{font-size:.8125rem;color:var(--label2);white-space:nowrap;text-align:right}
  /* 10/22：要開的班自己一張橘色卡 */
  .oc{margin-top:10px;padding:0 0 4px;overflow:hidden;border:1.5px solid var(--orange)}
  .oc[hidden]{display:none}
  .oc-h{background:var(--orange);color:#fff;padding:12px 16px;font-size:1.0625rem;font-weight:600;display:flex;align-items:baseline;gap:6px}
  .oc-h b{font-size:2rem;font-weight:700;letter-spacing:-.03em;line-height:1}
  .oc-h small{margin-left:auto;font-size:.8125rem;font-weight:500;color:rgba(255,255,255,.9)}
  .oc-r{position:relative;padding:11px 36px 11px 16px;border-top:.5px solid var(--sep);cursor:pointer;transition:opacity 100ms}
  .oc-r:first-of-type{border-top:0}
  .oc-r:active{opacity:.55}
  .oc-r .t{font-weight:600;font-size:1rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .oc-r .cd{color:var(--blue);margin-right:6px}
  .oc-r .s{font-size:.875rem;color:var(--label2);margin-top:2px}
  .oc-r .s b{color:var(--label)}
  .oc-r em{font-style:normal;font-weight:700;color:var(--orange)}
  .oc-r.need{background:var(--orangeBg)}
  .oc-r .chev{position:absolute;right:14px;top:50%;transform:translateY(-50%);color:var(--label3)}
  .hero h2 .h2s{display:block;font-size:1.125rem;line-height:1.4;font-weight:600;letter-spacing:-.01em;margin-top:6px}

  /* ══════ v1.7 會議模式（電腦版儀表板）＋昨天冠軍 ══════ */
  .ic.bd{display:inline-flex;align-items:center;width:auto;padding:0 12px;font-size:.8125rem;font-weight:700;white-space:nowrap}   /* v1.9 手機也看得到 */
  @media (max-width:599px){ .ic.bd .lg{display:none} }
  body.bmode{overflow:hidden}
  #board{position:fixed;inset:0;z-index:15;display:none;flex-direction:column;background:linear-gradient(180deg,var(--bg0),var(--bg1));
    font-size:clamp(13px,calc(.55vw + .75vh),22px);padding:0 1.4em .9em;font-variant-numeric:tabular-nums}
  #board.on{display:flex}
  #board .btop{display:flex;align-items:center;gap:.9em;height:3.3em;flex:none;border-bottom:.5px solid var(--sep)}
  #board .btop h1{margin:0;font-size:1.75em;letter-spacing:-.022em;line-height:1;white-space:nowrap}
  #board .btop .bs{color:var(--label2);font-size:.82em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  #board .bseg{margin-left:auto;display:flex;background:var(--fill);border-radius:.7em;padding:2px;flex:none}
  #board .bseg button{border:0;background:none;font:inherit;font-size:.85em;font-weight:600;color:var(--label2);padding:.45em 1em;border-radius:.55em;cursor:pointer;transition:transform 100ms ease-out}
  #board .bseg button:active{transform:scale(.96)}
  #board .bseg button.on{background:var(--card);color:var(--label);box-shadow:0 1px 3px rgba(0,0,0,.12)}
  #board .bbtn{border:0;font:inherit;font-size:.85em;font-weight:600;padding:.5em .85em;border-radius:.6em;background:var(--fill);color:var(--label);cursor:pointer;flex:none;transition:transform 100ms ease-out}
  #board .bbtn:active{transform:scale(.96)}
  #board .bchamp{border:0;font:inherit;font-size:.9em;font-weight:800;padding:.55em 1.1em;border-radius:999px;color:#3b2a00;cursor:pointer;flex:none;
    background:linear-gradient(135deg,#FFE58A,#FFC23D 55%,#F5A300);box-shadow:0 4px 14px rgba(245,163,0,.35);transition:transform 100ms ease-out}
  #board .bchamp:active{transform:scale(.95)}
  #board .bflow{display:flex;align-items:center;gap:.4em;height:2.3em;flex:none;font-size:.85em;color:var(--label2)}
  #board .bflow button{display:inline-flex;align-items:center;gap:.45em;border:0;background:none;font:inherit;color:inherit;font-weight:600;padding:.3em .85em;border-radius:999px;cursor:pointer}
  #board .bflow button i{width:.55em;height:.55em;border-radius:50%}
  #board .bflow button.on{background:var(--card);color:var(--label);box-shadow:var(--shadow)}
  #board .bflow .k{margin-left:auto;font-size:.85em;color:var(--label3);white-space:nowrap}
  #board .bgrid{flex:1;min-height:0;display:grid;gap:.9em;padding-top:.35em;
    grid-template-columns:1fr 1fr 1.25fr 1.25fr 2fr;grid-template-rows:1fr 1fr;
    grid-template-areas:"rank rank open open lead" "fun unc att focus inc"}
  #board .bc{background:var(--card);border-radius:1.15em;box-shadow:var(--shadow);border:.5px solid var(--sep);padding:.8em .95em .7em;min-height:0;min-width:0;overflow:hidden;
    display:flex;flex-direction:column;position:relative;cursor:zoom-in;transition:opacity 360ms ease,filter 360ms ease,transform 120ms ease-out}
  #board .bc:active{transform:scale(.99)}
  #board .bc.dim{opacity:.3;filter:saturate(.4)}
  #board .bc.hot{border-color:rgba(255,141,0,.45);box-shadow:var(--shadow),0 0 0 1px rgba(255,141,0,.18)}
  #board .bh{display:flex;align-items:baseline;gap:.5em;margin-bottom:.35em;flex:none;min-width:0}
  #board .bh i{width:.55em;height:.55em;border-radius:50%;align-self:center;flex:none}
  #board .bh b{font-size:1em;letter-spacing:-.01em;white-space:nowrap}
  #board .bh span{font-size:.78em;color:var(--label2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  #board .bh .x{margin-left:auto;color:var(--label3);font-size:.95em;flex:none}
  #board .kpi{display:flex;align-items:baseline;gap:.6em;flex:none}
  #board .kpi b{font-size:2.2em;font-weight:800;letter-spacing:-.03em;line-height:1}
  #board .kpi b small{font-size:.42em;font-weight:600;color:var(--label2);margin-left:.15em;letter-spacing:0}
  #board .kpi span{font-size:.82em;color:var(--label2)}
  #board .og{color:var(--orange)} #board .rd{color:var(--red)}
  #board svg.ch{display:block;width:100%;flex:1;min-height:0;overflow:visible}
  #board svg text{font-family:inherit}
  #board .leg{display:flex;gap:.9em;font-size:.72em;color:var(--label2);flex:none;margin-top:.2em;white-space:nowrap}
  #board .leg i{display:inline-block;width:.7em;height:.7em;border-radius:2px;margin-right:.3em;vertical-align:-.05em}
  #board .none{margin:auto;color:var(--label3);font-size:.85em;text-align:center}
  #board .fl{display:flex;flex-direction:column;gap:.55em;flex:1;min-height:0;overflow:hidden}
  #board .fl div{display:grid;grid-template-columns:1.6em 1fr;gap:.5em;align-items:start;font-size:.9em;line-height:1.35}
  #board .fl div b{font-size:1.5em;line-height:1;color:var(--c-focus);font-weight:800}
  #board .fl div span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  #board .fl .cnt{font-size:.78em;color:var(--label2);display:block;grid-column:2}
  #board .lt{flex:1;min-height:0;overflow:hidden;font-size:.9em;line-height:1.45}
  #board .lt p{margin:0 0 .35em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  #board .lt .nm{color:var(--blue);font-weight:700}
  #board .lt b{font-weight:700}
  #board .lt .gp{color:var(--orange);font-style:normal;font-weight:700}
  /* 三區總覽 */
  #board .bgrid.all{grid-template-columns:1fr 1fr 1fr;grid-template-rows:1fr 1.25fr;grid-template-areas:"rk rk inc" "r0 r1 r2"}
  #board .rcol{cursor:pointer}
  #board .rcol .big{display:grid;grid-template-columns:1fr 1fr 1fr;gap:.5em;flex:none;margin:.2em 0 .5em}
  #board .rcol .big div{background:var(--bg0);border-radius:.8em;padding:.45em .6em}
  #board .rcol .big b{display:block;font-size:1.6em;font-weight:800;letter-spacing:-.03em;line-height:1.1}
  #board .rcol .big span{font-size:.72em;color:var(--label2);white-space:nowrap}
  #board .rcol .champ1{flex:none;display:flex;align-items:center;gap:.5em;margin-top:.4em;padding:.45em .7em;border-radius:.8em;background:linear-gradient(135deg,rgba(255,229,138,.35),rgba(255,194,61,.18));font-size:.85em}
  #board .rcol .champ1 b{font-size:1.1em}
  #board .loading{margin:auto;color:var(--label2);font-size:.9em}
  /* 放大 */
  #bzoom{position:fixed;inset:0;z-index:17;pointer-events:none}
  #bzoom .zbg{position:absolute;inset:0;background:rgba(0,0,0,.28);opacity:0;transition:opacity 280ms ease}
  #bzoom.on{pointer-events:auto} #bzoom.on .zbg{opacity:1}
  #bzoom .zp{position:absolute;left:4vw;top:5vh;right:4vw;bottom:5vh;background:var(--card);border-radius:22px;box-shadow:0 30px 80px rgba(0,0,0,.25);overflow:hidden;
    display:flex;flex-direction:column;transform-origin:0 0;will-change:transform;font-size:clamp(13px,calc(.5vw + .7vh),20px)}
  #bzoom .zh{display:flex;align-items:center;gap:.6em;padding:1em 1.4em .7em;border-bottom:.5px solid var(--sep);flex:none}
  #bzoom .zh b{font-size:1.4em;letter-spacing:-.02em}
  #bzoom .zh span{color:var(--label2);font-size:.85em}
  #bzoom .zh button{margin-left:auto;border:0;background:var(--fill);font:inherit;font-weight:700;width:2.2em;height:2.2em;border-radius:50%;cursor:pointer;color:var(--label)}
  #bzoom .zb{flex:1;min-height:0;overflow:auto;padding:1em 1.4em 1.4em;transition:opacity 200ms ease}
  #bzoom .zb.pre{opacity:0}
  #bzoom .zg{display:grid;grid-template-columns:repeat(auto-fit,minmax(22em,1fr));gap:1.2em;align-items:start}
  #bzoom .zc{background:var(--bg0);border-radius:14px;padding:.9em 1em}
  #bzoom .zc h5{margin:0 0 .5em;font-size:1em}
  #bzoom svg.ch{display:block;width:100%;height:16em}
  #bzoom table{width:100%;border-collapse:collapse;font-size:.92em;font-variant-numeric:tabular-nums}
  #bzoom th{font-size:.78em;color:var(--label2);font-weight:600;text-align:right;padding:.2em .4em .5em;white-space:nowrap}
  #bzoom td{text-align:right;padding:.42em .4em;border-top:.5px solid var(--sep);white-space:nowrap}
  #bzoom th:first-child,#bzoom td:first-child,#bzoom td.l,#bzoom th.l{text-align:left}
  #bzoom td.l{white-space:normal}
  #bzoom tr.me td{font-weight:700}
  #bzoom tr.sum td{border-top:1.5px solid var(--sep);font-weight:700}
  #bzoom .nm{color:var(--blue);font-weight:600}
  #bzoom .og{color:var(--orange);font-weight:700} #bzoom .rd{color:var(--red);font-weight:700} #bzoom .z{color:var(--label3)}
  #bzoom .agz{font-size:1.05em;line-height:1.6;max-width:60em}
  #bzoom .agz p{margin:0 0 .35em}
  #bzoom .agz .nm{color:var(--blue);font-weight:700} #bzoom .agz .gp{color:var(--orange);font-style:normal;font-weight:700}
  #bzoom .clk{cursor:pointer} #bzoom .clk:hover td{background:var(--fill)}
  /* 🏆 昨天冠軍（永遠深色舞台） */
  #champ{position:fixed;inset:0;z-index:30;display:none;color:#fff;font-size:clamp(13px,calc(.55vw + .8vh),24px);font-variant-numeric:tabular-nums;
    background:radial-gradient(70vw 70vh at 28% 45%,#3a2a05 0%,#140f04 45%,#07070a 100%);overflow:hidden;cursor:default}
  #champ.on{display:block}
  #champ .stg{position:absolute;inset:0;display:grid;grid-template-columns:1.12fr 1fr;grid-template-rows:auto 1fr;gap:1.2em;padding:1.5em 1.8em}
  #champ .stg.tri{grid-template-columns:1fr 1fr 1fr}
  #champ .hd{grid-column:1/-1;display:flex;align-items:baseline;gap:.8em}
  #champ .hd h1{margin:0;font-size:1.9em;letter-spacing:-.02em}
  #champ .hd span{color:rgba(255,255,255,.6);font-size:1em}
  #champ .hd .x{margin-left:auto;display:flex;gap:.5em}
  #champ .hd button{border:0;font:inherit;font-size:.85em;font-weight:700;color:rgba(255,255,255,.85);background:rgba(255,255,255,.1);border-radius:999px;padding:.45em 1em;cursor:pointer}
  #champ .one{position:relative;border-radius:1.6em;padding:1.7em 2em;overflow:hidden;min-height:0;display:flex;flex-direction:column;justify-content:center;
    background:linear-gradient(160deg,rgba(255,215,90,.22),rgba(255,180,0,.06) 45%,rgba(255,255,255,.03));border:1.5px solid rgba(255,214,102,.55);
    box-shadow:0 0 0 1px rgba(255,214,102,.15),0 30px 80px rgba(255,170,0,.18),inset 0 1px 0 rgba(255,255,255,.25)}
  #champ .one::before{content:'';position:absolute;right:-10%;top:-40%;width:32em;height:32em;background:radial-gradient(circle,rgba(255,220,120,.32),transparent 60%);pointer-events:none}
  #champ .rk1{align-self:flex-start;display:inline-flex;align-items:center;gap:.4em;font-size:.9em;font-weight:800;color:#3b2a00;background:linear-gradient(135deg,#FFE58A,#FFC23D 55%,#F5A300);border-radius:999px;padding:.35em .9em}
  #champ .nm1{font-size:6.2em;font-weight:900;letter-spacing:-.04em;line-height:1;margin:.25em 0 .08em;background:linear-gradient(180deg,#FFF6D6,#FFD15C 60%,#E8A400);-webkit-background-clip:text;background-clip:text;color:transparent;white-space:nowrap}
  #champ .org{font-size:1.2em;color:rgba(255,255,255,.75);font-weight:600}
  #champ .amt{font-size:3.6em;font-weight:900;letter-spacing:-.03em;margin:.3em 0 .1em;white-space:nowrap}
  #champ .amt small{font-size:.36em;color:rgba(255,255,255,.6);font-weight:700;margin-left:.4em;letter-spacing:0}
  #champ .chips{display:flex;flex-wrap:wrap;gap:.45em;margin:.5em 0 1em}
  #champ .chips span{font-size:.9em;font-weight:700;border-radius:.6em;padding:.35em .7em;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.14)}
  #champ .chips span b{color:#FFD15C;margin-left:.35em}
  #champ .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:.6em}
  #champ .st{border-radius:1em;padding:.7em .85em;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1)}
  #champ .st .v{font-size:1.8em;font-weight:900;letter-spacing:-.02em;white-space:nowrap}
  #champ .st .l{font-size:.78em;color:rgba(255,255,255,.6)}
  #champ .st .c{font-size:.74em;color:#FFD15C;font-weight:700}
  #champ .quote{margin-top:1.1em;font-size:1.15em;font-weight:600;color:rgba(255,255,255,.92)}
  #champ .right{display:grid;grid-template-rows:1fr 1fr;gap:1.2em;min-height:0}
  #champ .two{position:relative;border-radius:1.4em;padding:1.3em 1.6em;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);display:grid;grid-template-columns:auto 1fr;gap:.35em 1.3em;align-content:center;overflow:hidden;min-height:0}
  #champ .two .rk{grid-row:span 3;font-size:5em;font-weight:900;line-height:1;align-self:center}
  #champ .two.s .rk{background:linear-gradient(180deg,#F5F7FA,#AEB6C2);-webkit-background-clip:text;background-clip:text;color:transparent}
  #champ .two.b .rk{background:linear-gradient(180deg,#F7D2B0,#C07A43);-webkit-background-clip:text;background-clip:text;color:transparent}
  #champ .two .nm{font-size:3em;font-weight:900;letter-spacing:-.03em;line-height:1.05;white-space:nowrap}
  #champ .two .nm small{font-size:.38em;color:rgba(255,255,255,.6);font-weight:600;margin-left:.6em;letter-spacing:0}
  #champ .two .a{font-size:2.1em;font-weight:800;white-space:nowrap}
  #champ .two .a small{font-size:.5em;color:rgba(255,255,255,.55);margin-left:.3em}
  #champ .two .t{font-size:.95em;color:rgba(255,255,255,.72)}
  #champ .two .t b{color:#fff}
  #champ .empty{grid-column:1/-1;margin:auto;text-align:center;color:rgba(255,255,255,.7);font-size:1.6em}
  #champ .tri .one{padding:1.4em 1.5em}
  #champ .tri .nm1{font-size:4.4em}
  #champ .tri .amt{font-size:2.6em}
  #champ .tri .stats{grid-template-columns:1fr 1fr}
  #champ canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5}
  #champ .fx{position:absolute;inset:0;pointer-events:none;z-index:6}
  /* 揭曉前的狀態，各特效 */
  #champ .rv{opacity:0}
  #champ .rv.in{opacity:1;transition:opacity 260ms ease}
  #champ.e-flip .stg{perspective:1400px}
  #champ.e-flip .rv{transform:rotateY(-95deg);transform-origin:50% 50%;backface-visibility:hidden}
  #champ.e-flip .rv.in{transform:none;transition:transform 760ms cubic-bezier(.2,.9,.25,1),opacity 200ms ease}
  #champ.e-slot .rv{transform:translateY(1.2em)} #champ.e-slot .rv.in{transform:none;transition:transform 420ms cubic-bezier(.2,.9,.25,1),opacity 260ms ease}
  #champ.e-slot .nm1,#champ.e-slot .two .nm{opacity:0;transform:scale(.85);transition:opacity 260ms ease,transform 420ms cubic-bezier(.2,.9,.25,1)}
  #champ.e-slot .lit .nm1,#champ.e-slot .lit .nm{opacity:1;transform:none}
  #champ.e-conf .rv{transform:scale(.92)} #champ.e-conf .rv.in{transform:none;transition:transform 520ms cubic-bezier(.2,.9,.25,1),opacity 260ms ease}
  #champ.e-glass .rv{filter:blur(26px);transform:scale(1.08)} #champ.e-glass .rv.in{filter:none;transform:none;transition:filter 900ms ease,transform 900ms cubic-bezier(.2,.9,.25,1),opacity 500ms ease}
  #champ .gb{position:absolute;border-radius:50%;background:rgba(255,236,170,.14);border:1px solid rgba(255,255,255,.35);-webkit-backdrop-filter:blur(14px) saturate(180%);backdrop-filter:blur(14px) saturate(180%);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.45),0 10px 30px rgba(0,0,0,.3);transition:transform 900ms cubic-bezier(.2,.9,.25,1),opacity 500ms ease 700ms}
  #champ.e-sweep .rv.in{transition:opacity 200ms ease}
  #champ.e-sweep .sw{-webkit-mask-image:linear-gradient(90deg,#000 var(--p,0%),transparent calc(var(--p,0%) + 10%));mask-image:linear-gradient(90deg,#000 var(--p,0%),transparent calc(var(--p,0%) + 10%))}
  #champ.e-spot .spot{position:absolute;inset:0;z-index:7;pointer-events:none;background:radial-gradient(circle at var(--x,10%) var(--y,30%),rgba(0,0,0,0) 0,rgba(0,0,0,0) 14vmin,rgba(0,0,0,.94) 26vmin);transition:opacity 500ms ease}
  #champ.done .rv{opacity:1!important;transform:none!important;filter:none!important;transition:none!important}
  #champ.done .nm1,#champ.done .two .nm{opacity:1!important;transform:none!important}
  #champ.done .sw{-webkit-mask-image:none!important;mask-image:none!important}
  #champ.done .spot{opacity:0!important}
  @media (prefers-reduced-motion:reduce){ #board .bc{transition:none} #bzoom .zbg,#bzoom .zb{transition:none}
    #champ .rv,#champ .rv.in{transform:none!important;filter:none!important} }
  @media (prefers-color-scheme:dark){ #board .bc{border-color:rgba(255,255,255,.08)} }

  /* ── v1.8 視角選單、比較切換、報到排名、個人明細 ── */
  #board .bpw{position:relative;margin-left:auto;flex:none}
  #board .bpick{border:.5px solid var(--sep);background:var(--card);box-shadow:0 1px 3px rgba(0,0,0,.08);font:inherit;font-size:.9em;font-weight:700;color:var(--label);border-radius:999px;padding:.45em 1em;cursor:pointer;transition:transform 100ms ease-out}
  #board .bpick:active{transform:scale(.97)}
  #board .bpick i{font-style:normal;color:var(--label3);margin:0 .15em}
  #board .bpick small{color:var(--label3);font-size:.7em;margin-left:.2em}
  #board .bpop{position:absolute;right:0;top:calc(100% + .5em);z-index:5;min-width:17em;background:var(--glass);-webkit-backdrop-filter:blur(26px) saturate(180%);backdrop-filter:blur(26px) saturate(180%);
    border:.5px solid var(--sep);border-radius:1em;box-shadow:0 18px 50px rgba(0,0,0,.18);padding:.6em;transform-origin:top right;animation:bpop 220ms cubic-bezier(.2,.9,.25,1)}
  #board .bpop[hidden]{display:none}
  @keyframes bpop{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:none}}
  #board .bpop .pg{display:flex;flex-wrap:wrap;gap:.35em;padding:.35em}
  #board .bpop .pg+.pg{border-top:.5px solid var(--sep);margin-top:.2em;padding-top:.6em}
  #board .bpop .pg span{width:100%;font-size:.72em;color:var(--label2);font-weight:600;margin-bottom:.1em}
  #board .bpop button{border:0;font:inherit;font-size:.86em;font-weight:600;color:var(--label);background:var(--fill);border-radius:.6em;padding:.45em .8em;cursor:pointer}
  #board .bpop button.on{background:var(--label);color:var(--card)}
  #board .mseg{display:inline-flex;background:var(--fill);border-radius:.5em;padding:1px;margin-left:auto;flex:none}
  #board .mseg+.x{margin-left:.5em}
  #board .mseg button{border:0;background:none;font:inherit;font-size:.78em;font-weight:600;color:var(--label2);padding:.25em .6em;border-radius:.42em;cursor:pointer;white-space:nowrap}
  #board .mseg button.on{background:var(--card);color:var(--label);box-shadow:0 1px 2px rgba(0,0,0,.12)}
  #board .lrk{flex:1;min-height:0;display:flex;flex-direction:column;gap:2px;overflow:hidden}
  #board .lrow{flex:1 1 auto;min-height:1.9em;max-height:2.7em;display:grid;grid-template-columns:4.6em 1fr 2.2em 4.4em;align-items:center;gap:.6em;border:0;background:none;font:inherit;color:inherit;text-align:left;padding:0 .5em;border-radius:.55em;cursor:pointer;transition:background 120ms ease}
  #board .lrow[hidden]{display:none}
  #board .lrow:hover{background:var(--fill)}
  #board .lrow .n{font-weight:700;color:var(--blue);font-size:.92em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #board .lrow .n small{color:var(--label3);font-weight:600;font-size:.78em;margin-left:.35em}
  #board .lrow .t{height:.75em;border-radius:.3em;background:var(--fill);overflow:hidden}
  #board .lrow .t i{display:block;height:100%;border-radius:.3em;background:#C7C7CC}
  #board .lrow .v{font-weight:800;text-align:right}
  #board .lrow .d{font-size:.8em;font-weight:700;text-align:right;color:var(--label3);white-space:nowrap}
  #board .lrow.hot{background:rgba(255,141,0,.09)}
  #board .lrow.hot .t i{background:var(--orange)}
  #board .lrow.hot .d{color:var(--orange)}
  #board .lmore{font-size:.75em;color:var(--label2);padding:.2em .5em 0}
  #board .lmore[hidden]{display:none}
  #board .bask{position:absolute;inset:0;z-index:6;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.18);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);animation:bfade 240ms ease}
  @keyframes bfade{from{opacity:0}to{opacity:1}}
  #board .bq{background:var(--card);border-radius:1.4em;box-shadow:0 30px 80px rgba(0,0,0,.25);padding:1.6em 1.8em;max-width:30em;text-align:center;animation:bpop 320ms cubic-bezier(.2,.9,.25,1)}
  #board .bq h3{margin:0 0 .4em;font-size:1.5em;letter-spacing:-.02em}
  #board .bq p{margin:0 0 1.1em;color:var(--label2);font-size:.9em;line-height:1.55}
  #board .bqb{display:flex;flex-wrap:wrap;gap:.5em;justify-content:center}
  #board .bqb button{border:0;font:inherit;font-weight:700;font-size:1em;padding:.7em 1.3em;border-radius:.8em;background:var(--fill);color:var(--label);cursor:pointer;transition:transform 100ms ease-out}
  #board .bqb button:active{transform:scale(.96)}
  #board .bqb button.all{background:none;color:var(--blue);font-weight:600}
  #bzoom.side .zp{left:auto;right:1.5vw;top:2.5vh;bottom:2.5vh;width:min(46vw,46em);transform-origin:right center}
  #bzoom .ph{display:flex;align-items:baseline;gap:.6em}
  #bzoom .ph h2{margin:0;font-size:2em;letter-spacing:-.025em}
  #bzoom .ph span{color:var(--label2);font-size:.9em}
  #bzoom .psub{margin:.3em 0 1em;color:var(--label2);font-size:.92em}
  #bzoom .pk{display:grid;grid-template-columns:repeat(4,1fr);gap:.6em;margin-bottom:1.2em}
  #bzoom .pk div{background:var(--bg0);border-radius:.9em;padding:.7em .85em}
  #bzoom .pk b{display:block;font-size:1.6em;letter-spacing:-.02em;line-height:1.15}
  #bzoom .pk span{font-size:.75em;color:var(--label2)}
  #bzoom h5{margin:1.1em 0 .5em;font-size:.95em}
  #bzoom h5 small{color:var(--label2);font-weight:500;margin-left:.6em;font-size:.85em}
  #bzoom .pcal{display:grid;grid-template-columns:repeat(auto-fill,minmax(1.6em,1fr));gap:3px}
  #bzoom .pcal i{position:relative;height:2.2em;border-radius:.35em;background:var(--fill);font-style:normal;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:.15em 0}
  #bzoom .pcal i b{font-size:.8em;color:#fff}
  #bzoom .pcal i s{text-decoration:none;font-size:.62em;color:var(--label3);margin-top:auto}
  #bzoom .pcal i.h{background:var(--label)} #bzoom .pcal i.h s{color:rgba(255,255,255,.7)}
  #bzoom .pcal i.o{box-shadow:inset 0 0 0 2px var(--orange)}
  @media (prefers-color-scheme:dark){ #bzoom .pcal i.h b{color:#000} #bzoom .pcal i.h s{color:rgba(0,0,0,.6)} }

  /* ══════ v1.9 會議模式：手機、平板（響應式） ══════ */
  #board .mb{display:none}
  @media (max-width:1023px){
    #board.on{display:block;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;font-size:15px;padding:0 0 calc(env(safe-area-inset-bottom) + 24px)}
    #board .btop{flex-wrap:wrap;height:auto;gap:.5em .6em;padding:calc(env(safe-area-inset-top) + .7em) 16px .6em;border-bottom:0}
    #board .btop h1{font-size:1.6em;order:1}
    #board .btop .bpw{order:2}
    #board .btop .bs{order:5;width:100%;font-size:.78em;white-space:normal}
    #board .btop .bbtn,#board .btop .bchamp{order:3;min-height:44px}
    #board .bpick{min-height:44px}
    #board .bfull{display:none}
    #board .dk{display:none} #board .mb{display:inline}
    #board .bflow{position:sticky;top:0;z-index:4;height:auto;padding:.5em 16px;overflow-x:auto;scrollbar-width:none;background:var(--glass);-webkit-backdrop-filter:blur(22px) saturate(180%);backdrop-filter:blur(22px) saturate(180%);border-bottom:.5px solid var(--sep)}
    #board .bflow::-webkit-scrollbar{display:none}
    #board .bflow button{min-height:40px;white-space:nowrap;flex:none}
    #board .bflow .k{display:none}
    #board .bgrid{display:grid;padding:.8em 16px 0;gap:.8em;grid-template-columns:1fr 1fr;grid-template-rows:none;grid-auto-rows:auto;
      grid-template-areas:"open open" "rank lead" "fun unc" "att focus" "inc inc"}
    #board .bc{height:21em;cursor:pointer}
    #board .bc[data-card="open"]{height:24em}
    #board .bc[data-card="lead"]{height:24em}
    #board .bc[data-card="rank"]{height:24em}
    #board .bgrid.all{grid-template-columns:1fr 1fr;grid-template-areas:"rk inc" "r0 r1" "r2 r2"}
    #board .bgrid.all .bc{height:24em}
    #board .bpop{position:fixed;left:16px;right:16px;top:calc(env(safe-area-inset-top) + 4.2em);min-width:0}
    #board .bpop button{min-height:40px}
    #board .lrow{min-height:2.6em;max-height:3em}
    #board .mseg button{padding:.45em .7em;font-size:.82em}
    #board .bask .bq{margin:0 16px}
    #bzoom.sheet .zp,#bzoom.side.sheet .zp{left:0;right:0;width:auto;top:calc(env(safe-area-inset-top) + 2.5vh);bottom:0;border-radius:22px 22px 0 0;font-size:15px;transform-origin:50% 100%}
    #bzoom.sheet .zh{position:relative;padding-top:1.4em;touch-action:none;cursor:grab}
    #bzoom.sheet .zh::before{content:'';position:absolute;left:50%;top:.5em;width:36px;height:5px;margin-left:-18px;border-radius:3px;background:var(--label3);opacity:.5}
    #bzoom.sheet .zh button{width:44px;height:44px}
    #bzoom .zb{padding-bottom:calc(env(safe-area-inset-bottom) + 1.4em)}
    #bzoom .tw{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 -.2em}
    #bzoom .tw table{min-width:30em}
    #bzoom .zg{grid-template-columns:1fr}
    #bzoom svg.ch{height:13em}
    #bzoom .pk{grid-template-columns:1fr 1fr}
    #champ{overflow-y:auto;-webkit-overflow-scrolling:touch}
  }
  @media (max-width:599px){
    #board .btop h1{flex:1 1 calc(100% - 6em)}
    #board .btop .bpw{order:3;margin-left:0}
    #board .btop .bchamp{order:4;margin-left:auto}
    #board .btop #bExit{order:2}
    #board .bc[data-card="rank"],#board .bc[data-card="fun"],#board .bc[data-card="unc"]{height:auto}
    #board .bc[data-card="rank"] svg.ch,#board .bc[data-card="unc"] svg.ch{flex:none;height:calc(var(--n,4) * 2.6em + .6em)}
    #board .bc[data-card="fun"] svg.ch{flex:none;height:calc(var(--n,4) * 3.4em + .6em)}
    #board .bc[data-card="lead"]{height:auto}
    #board .bc[data-card="lead"] .lrk{flex:none;overflow:visible}
    #champ .dk{display:none}
    #board .bgrid{grid-template-columns:1fr;grid-template-areas:"rank" "fun" "unc" "open" "att" "lead" "focus" "inc"}
    #board .bc{height:19em}
    #board .bc[data-card="open"]{height:auto;min-height:20em}
    #board .bc[data-card="open"] svg.ch{height:18em;flex:none}
    #board .bc[data-card="inc"]{height:22em}
    #board .bc[data-card="focus"]{height:auto;min-height:12em}
    #board .bgrid.all{grid-template-columns:1fr;grid-template-areas:"rk" "inc" "r0" "r1" "r2"}
    #board .bh span:not(.x):not(.mseg){display:none}
    #board .bh{flex-wrap:wrap}
    #bzoom .tw table.stab{min-width:0}
    #bzoom table.stab,#bzoom table.stab tbody{display:block}
    #bzoom table.stab tr:first-child{display:none}
    #bzoom table.stab tr{display:grid;grid-template-columns:1fr auto;gap:.15em .8em;padding:.7em .2em;border-top:.5px solid var(--sep)}
    #bzoom table.stab td{border:0;padding:0;white-space:normal}
    #bzoom table.stab td:nth-child(1){grid-column:1/-1;font-size:.82em;color:var(--label2)}
    #bzoom table.stab td:nth-child(2){font-weight:700}
    #bzoom table.stab td:nth-child(3){grid-column:1/-1;font-size:.85em;color:var(--label2);order:4}
    #bzoom table.stab td:nth-child(4){text-align:right}
    #champ{font-size:clamp(12px,3.4vw,18px)}
    #champ .stg{position:relative;inset:auto;min-height:100%;grid-template-columns:1fr;grid-template-rows:auto auto auto;padding:calc(env(safe-area-inset-top) + 1em) 16px calc(env(safe-area-inset-bottom) + 1.2em)}
    #champ .hd{flex-wrap:wrap}
    #champ .hd .x{margin-left:0;width:100%}
    #champ .hd button{min-height:40px}
    #champ .one{padding:1.3em 1.2em}
    #champ .nm1{font-size:4.6em}
    #champ .amt{font-size:2.5em}
    #champ .stats{grid-template-columns:1fr 1fr}
    #champ .right{grid-template-rows:none;grid-template-columns:1fr 1fr;gap:.8em}
    #champ .two{grid-template-columns:1fr;padding:1em;gap:.2em}
    #champ .two .rk{grid-row:auto;font-size:2.6em}
    #champ .two .nm{font-size:2em}
    #champ .two .a{font-size:1.35em}
    #champ .stg.tri{grid-template-columns:1fr}
    #champ canvas{position:fixed}
  }
  @media (max-width:1023px) and (orientation:landscape) and (max-height:500px){
    #board .btop{padding-top:calc(env(safe-area-inset-top) + .4em);padding-bottom:.3em} #board .btop .bs{display:none} #board .btop h1{font-size:1.3em}
    #board .bflow{padding-top:.25em;padding-bottom:.25em} #board .bflow button{min-height:36px}
    #board .bc{height:17em}
    #champ .stg{position:relative;min-height:100%}
  }
`;

var PG_BODY = `<header class="top">
  <div class="t"><div><h1 id="hTitle">13:40</h1><div class="sub" id="hSub"></div></div><div class="tb"><button class="ic bd" type="button" id="boardBtn" title="會議模式：一眼看完的儀表板，開會用">會議<span class="lg">模式</span></button><button class="ic" type="button" id="copyAll" title="複製整份 LINE 文字">⧉</button><select class="day" id="daySel" aria-label="選日期"></select></div></div>
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
  <div class="oc card flat" id="openCard" hidden></div>
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
  <div class="legend"><span><i style="background:var(--blue)"></i>人名、班別（可點）</span><span><i style="background:var(--orange)"></i>缺口、沒有新增、未到</span><span><i style="background:var(--red)"></i>達標、過門檻</span></div>
  <p class="foot" id="foot"></p>
</section>
</main>

<div id="board" aria-label="會議模式"></div><div id="bzoom"></div><div id="champ" role="dialog" aria-label="昨天冠軍"></div>
<div id="dim"></div>
<div id="sheet" aria-hidden="true"><div class="grip"><i></i></div><div class="in" id="sheetIn"></div></div>
<textarea id="cpBuf" aria-hidden="true" style="position:fixed;left:-9999px;top:0;opacity:0"></textarea>

<script>
var D = window.DATA || {};
function esc(t){ return String(t == null ? '' : t).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function short(n){ n = String(n || ''); return n.length === 3 ? n.slice(1) : n; }
var REGION = D.label || (D.r === '建國' ? '高雄建國' : D.r), MTIME = D.time || '13:40';
document.title = REGION + ' ' + MTIME;
document.getElementById('hTitle').textContent = REGION + ' ' + MTIME;
var _sa = String(D.syncAt || ''), _sd = _sa.slice(0, 10).replace(/-/g, '/'), _dd = String(D.date || '').replace(/-/g, '/');
document.getElementById('hSub').textContent = (D.dateLabel || D.date || '') + (_sa ? '・班況 ' + (_sd === _dd ? _sa.slice(11, 16) : _sa.replace(/^\\d{4}\\//, '').slice(0, 11)) + ' 同步' : '・班況還沒同步');

/* 日期選單：留 30 天 */
var sel = document.getElementById('daySel');
(D.dates || []).forEach(function(d, i){ var o = document.createElement('option'); o.value = d; o.textContent = i === 0 ? '最新 ' + d.slice(5) : d.slice(5); if (d === D.date) o.selected = true; sel.appendChild(o); });
sel.addEventListener('change', function(){ var u = (D.baseUrl || '') + '?r=' + encodeURIComponent(D.r) + (sel.selectedIndex ? '&d=' + sel.value : ''); try { window.top.location.href = u; } catch(e){ location.href = u; } });

/* ── 議程原文（LINE 版）切段 ── */
var LINE_TXT = D.agenda || '';
var AG_NONE_SAID = false;   // v1.6：沒有議程的說明，第一段講完整、後面只講一句
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
  if (!t){ var nm = D.agNone || '今天議程沒有這一段（今天的議程檔還沒產生）。'; if (!LINE_TXT && AG_NONE_SAID) nm = nm.split('，')[0].replace(/。$/, '') + '。'; if (!LINE_TXT) AG_NONE_SAID = true;
    el.innerHTML = '<p class="none">' + (LINE_TXT ? '今天議程沒有這一段。' : esc(nm)) + '</p>'; return; }   // v1.6：桃區第一份議程前講清楚
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

/* ── 助理：報到（10/22 Ivan 選 B：一家一行「台三 76 人 昨天 +3 全省第 2」） ── */
(function(){
  var R = (D.rank && D.rank.rows) || [], el = document.getElementById('rank'), nt = document.getElementById('rankNote');
  if (!R.length){ el.style.display = 'none'; nt.style.display = 'none'; return; }
  var note = String(D.rank.note || ''), prev = D.rank.prev || ((note.match(/跟 (\\d+\\/\\d+) 比/) || [])[1] || ''), cur = D.rank.cur || ((note.match(/（(\\d+\\/\\d+) 資料）/) || [])[1] || '');
  var yday = false;
  if (prev && cur){ var y = new Date().getFullYear(), pa = prev.split('/'), ca = cur.split('/'); yday = Math.round((new Date(y, ca[0] - 1, +ca[1]) - new Date(y, pa[0] - 1, +pa[1])) / 864e5) === 1; }
  var lab = yday ? '昨天' : (prev ? '比 ' + prev : '');
  var h = '<div class="rk-h">' + (cur ? (+cur.split('/')[0]) + ' 月報到<small>（到 ' + cur + '）</small>' : '這個月報到') + '</div>';
  h += R.map(function(x, i){ var d = x.diff;
    return '<div class="rk-r"><span class="o">' + esc(x.院) + '</span><span class="n"><b class="' + (i === 0 && R.length > 1 ? 'top' : '') + '">' + x.n + '</b> 人</span>'
      + '<span class="df">' + (d == null ? '' : lab + ' <i class="' + (d > 0 ? 'up' : (d < 0 ? 'dn' : '')) + '">' + (d > 0 ? '+' : '') + d + '</i>') + '</span>'
      + '<span class="rk">全省第 ' + x.rank + '</span></div>'; }).join('');
  el.className = 'rk card flat'; el.innerHTML = h;
  var top3 = (note.match(/全省前三：(.*?)。/) || [])[1] || '';
  nt.innerHTML = top3 ? '全省前三：' + top3 : '';
})();

/* ── 助理：註冊未消耗＋走到哪一關（各院一列，點開看細節） ── */
(function(){
  var A = D.asst; if (!A){ document.getElementById('asstCards').innerHTML = '<div class="card flat"><p class="none">還沒有助理數據（要先跑一次 🏫 班況）。</p></div>'; return; }
  var orgs = D.orgs || (D.r === '建國' ? ['建國'] : ['台一', '台二', '台三']), mo = A.月 ? (+String(A.月).split('/')[1]) + ' 月' : '';
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
  var sumOf = function(o){ var f = F.filter(function(x){ return x.院 === o; }); var s = { 談過:0, 報名:0, 註冊:0, 排進班:0, 上過課:0 }, has = f.some(function(x){ return x.上過課 != null; }); f.forEach(function(x){ s.談過 += +x.談過 || 0; s.報名 += +x.報名 || 0; s.註冊 += +x.註冊 || 0; s.排進班 += +pj(x) || 0; s.上過課 += +x.上過課 || 0; }); if (!has) s.上過課 = null; s.f = f; s.rate = s.註冊 ? (s.註冊 - s.排進班) / s.註冊 : 0; return s; };
  // v1.6（10/22 Ivan）：「進班上課」拆兩欄——排進班＝已登記到某一班（11 月、12 月、明年的班都算），上過課＝EIP 寫使用中或出席
  function pj(x){ return x.排進班 != null ? x.排進班 : x.進班上課; }
  var u5 = function(x){ return x == null ? '<span class="v z">—</span>' : '<span class="v' + (+x ? '' : ' z') + '">' + x + '</span>'; };
  var fs = orgs.map(function(o){ var s = sumOf(o); s.o = o; return s; });
  var worstF = orgs.length > 1 ? fs.slice().sort(function(a, b){ return b.rate - a.rate; })[0].o : '', bestF = orgs.length > 1 ? fs.slice().sort(function(a, b){ return a.rate - b.rate; })[0].o : '';
  var v = function(x, cls){ return '<span class="v' + (cls || (+x ? '' : ' z')) + '">' + x + '</span>'; };
  h += '<div class="card flat acc" id="accF" style="margin-top:8px"><div class="ch">' + (mo ? '<i class="mo">' + mo + '</i>' : '') + '<b>談過的人，走到哪一關</b><span>每一關少幾個，就是掛在那一關的人・點一家看業務</span></div>'
    + '<div class="fr hd"><span style="text-align:left">學院</span><span>談過</span><span>報名</span><span>註冊</span><span>排進班</span><span>上過課</span><span></span></div>';
  fs.forEach(function(s){
    var gapCls = s.排進班 < s.註冊 ? (s.o === worstF ? ' gap' : '') : '';
    h += '<div class="ai' + (orgs.length === 1 ? ' open' : '') + '"><button class="ar" type="button"><span class="nm">' + s.o + (s.o === worstF ? '<i class="tag worst">最差</i>' : (s.o === bestF ? '<i class="tag best">最好</i>' : '')) + '</span>'
      + v(s.談過) + v(s.報名) + v(s.註冊) + '<span class="v' + (s.o === bestF ? ' ok' : gapCls) + '">' + s.排進班 + '</span>' + u5(s.上過課) + '<span class="dc">›</span></button>'
      + '<div class="ab"><div><div class="fun">' + s.f.filter(function(x){ return !x.主管; }).sort(function(a, b){ return b.談過 - a.談過; }).map(function(x){
        return '<div class="fr"><span class="nm">' + esc(short(x.業務)) + '</span>' + v(x.談過) + v(x.報名) + v(x.註冊) + '<span class="v' + (pj(x) < x.註冊 ? ' gap' : (+pj(x) ? '' : ' z')) + '">' + pj(x) + '</span>' + u5(x.上過課) + '<span></span></div>'; }).join('') + '</div></div></div></div>';
  });
  if (orgs.length > 1){ var T = { 談過:0, 報名:0, 註冊:0, 排進班:0, 上過課:0 }; fs.forEach(function(s){ for (var k in T) T[k] = (T[k] == null || s[k] == null) ? null : T[k] + s[k]; });
    h += '<div class="fr sum"><span class="nm">' + REGION + '合計</span><span class="v">' + T.談過 + '</span><span class="v">' + T.報名 + '</span><span class="v">' + T.註冊 + '</span><span class="v">' + T.排進班 + '</span>' + u5(T.上過課).replace(' z"', '"') + '<span></span></div>'; }
  h += '<div class="cf" style="padding-top:8px;border-top:0">' + '排進班＝已經登記到某一班，下個月以後、甚至明年才開的班也算。上過課＝EIP 寫使用中或出席的。' + (orgs.length > 1 ? '最差＝註冊了還沒排進班的比例最高。' : '') + '橘字＝有人註冊了、還沒排進班。只算 ' + mo + '談過的人，跟上面「註冊未消耗」的數字不一樣。主管不列。漏斗資料 ' + esc(String(A.漏斗同步 || '').replace(/^\\d{4}\\//, '')) + '。</div></div>';
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
/* 10/22 Ivan 選 C：要開的班自己一張橘色卡，抽屜只放出席要追、結業、講座 */
var OPEN = SHOW.filter(function(c){ return ['今天開班','3 天內','14 天內'].indexOf(c.grp) >= 0; }).sort(function(a, b){ return a.toOpen - b.toOpen; });
var SHOW_D = SHOW.filter(function(c){ return OPEN.indexOf(c) < 0; });
function shortNm(n){ n = String(n || ''); var p = n.split('｜'); n = p.length > 1 ? p[1] : n; return n.replace(/班$/, ''); }
function needN(c){ var m = String(c.stTxt || '').match(/差 (\\d+) 位/); return m ? +m[1] : 0; }
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
GROUPS.forEach(function(g){ var rows = SHOW_D.filter(function(c){ return c.grp === g[0]; }); if (rows.length) ch += '<div class="grp">' + g[1] + '</div>' + rows.map(card).join(''); });
document.getElementById('classes').innerHTML = ch || '<p class="none">這幾天沒有要追的班。</p>';
document.getElementById('dhN').innerHTML = SHOW_D.length + ' <small>班</small>';
(function(){
  var el = document.getElementById('openCard'); if (!OPEN.length) return;
  el.hidden = false;
  el.innerHTML = '<div class="oc-h"><b>' + OPEN.length + '</b> 班要開<small>14 天內・點一班看名單</small></div>' + OPEN.map(function(c){
    var st = c.ok ? esc(c.stTxt) : '<em>差 ' + needN(c) + ' 位</em>';
    return '<div class="oc-r' + (c.ok ? '' : ' need') + '" data-id="' + c.cid + '"><div class="t"><span class="cd">' + c.code + '</span>' + esc(shortNm(c.name)) + '</div>'
      + '<div class="s">' + st + '・' + (c.toOpen ? '剩 <b>' + c.toOpen + '</b> 天' : '<em>今天開班</em>') + '</div><span class="chev">›</span></div>'; }).join('');
})();
var cnt = function(gs){ return SHOW.filter(function(c){ return gs.indexOf(c.grp) >= 0; }).length; };
document.getElementById('dhSub').textContent = '出席要追 ' + cnt(['已開班','未到多']) + '・結業 ' + cnt(['結業']) + (cnt(['講座']) ? '・講座 ' + cnt(['講座']) : '');

/* 今天要動（最多三張）：今天開班 → 3 天內差人 → 第一堂未到超過三成 → 14 天內差人 */
SHOW.filter(function(c){ return c.grp === '今天開班'; }).forEach(function(c){ moves.push({ c:c, t:'<em>今天開班</em>，登記 ' + c.reg + '／滿班 ' + c.seat, d:c.code + ' ' + c.name }); });
SHOW.filter(function(c){ return (c.grp === '3 天內' || c.grp === '14 天內') && !c.ok; }).sort(function(a, b){ return a.toOpen - b.toOpen; }).forEach(function(c){ moves.push({ c:c, t:'<em>' + esc(c.stTxt) + '</em>，剩 ' + c.toOpen + ' 天', d:c.code + ' ' + c.name + '・登記 ' + c.reg + '／門檻 ' + c.th }); });
SHOW.filter(function(c){ return c.grp === '已開班' && c.first && c.first.應到 && (c.first.應到 - c.first.實到) / c.first.應到 > .3; }).forEach(function(c){ var r = Math.round((c.first.應到 - c.first.實到) / c.first.應到 * 100); moves.splice(Math.min(moves.length, 2), 0, { c:c, t:'第一堂<em>未到 ' + r + '%</em>，追曠課', d:c.code + ' ' + c.name + '・出席 ' + c.first.實到 + '／應到 ' + c.first.應到 }); });
/* 10/22 Ivan 選 B：7 天內開幾班＋直接點出差人的班 */
var nToday = cnt(['今天開班']), n7 = OPEN.filter(function(c){ return c.toOpen >= 1 && c.toOpen <= 7; }).length, NEED = OPEN.filter(function(c){ return !c.ok; });
var line1 = (nToday ? '今天開 <b>' + nToday + '</b> 班。' : '') + (n7 ? '7 天內' + (nToday ? '再' : '') + '開 <b>' + n7 + '</b> 班。' : (nToday ? '' : '7 天內沒有班要開。'));
var nm = function(c){ return c.code + ' ' + esc(shortNm(c.name)); }, left = function(c){ return c.toOpen ? '剩 ' + c.toOpen + ' 天' : '今天開班'; };
var line2 = NEED.length === 1 ? nm(NEED[0]) + '還差 <b>' + needN(NEED[0]) + '</b> 位，' + left(NEED[0]) + '。'
  : NEED.length > 1 ? '<b>' + NEED.length + '</b> 班還差人，最急的是 ' + nm(NEED[0]) + '，差 <b>' + needN(NEED[0]) + '</b> 位、' + left(NEED[0]) + '。'
  : (OPEN.length ? '要開的班都過門檻了。' : '');
var hero = '<h2>' + line1 + (line2 ? '<span class="h2s">' + line2 + '</span>' : '') + '</h2>';
moves.slice(0, 3).forEach(function(m, i){ hero += '<div class="move" data-id="' + m.c.cid + '"><span class="k">' + (i + 1) + '</span><div class="mv"><div class="t">' + m.t + '</div><div class="d">' + esc(m.d) + '</div></div><span class="chev">›</span></div>'; });
if (!CLS.length) hero = '<h2>班況還沒同步。</h2><p class="none">在業績數據中心按一次 🏫 班況（或 ⚡ 全部同步），這裡就會出現。</p>';
document.getElementById('hero').innerHTML = hero;
/* 抽屜：露出最急那一班 */
var peekC = moves.map(function(m){ return m.c; }).filter(function(c){ return SHOW_D.indexOf(c) >= 0; })[0] || SHOW_D[0], peekId = peekC && peekC.cid, peekEl = peekId && document.getElementById('c-' + peekId);
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

/* ══════ v1.7（10/22 Ivan）會議模式：電腦版儀表板＋聚光燈＋放大＋三區總覽＋🏆 昨天冠軍 ══════
   v1.8（10/22 Ivan 同意）：視角（中區 › 台三）、比較範圍放在圖上、主管點名改成每個人的報到排名、點人看報到明細、出席圓環放大、留白收緊
   同一份資料（window.DATA），不多讀 EIP。window／document 的監聽只掛一次，透過 window.__pgB 找最新的畫法（GitHub 版第二次畫時會重跑這段）。 */
(function(){
  var B = document.getElementById('board'); if (!B) return;
  var ST = window.__pgBS || (window.__pgBS = { on: false, spot: 0, view: 'one', fx: -1 });
  var NS = 'http://www.w3.org/2000/svg', REDUCE = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var I = D.inc || null, ORGS = D.orgs || [], RANK = D.rank || null, A = D.asst || null;
  var REG = [['中區', '中區'], ['桃區', '桃區'], ['建國', '高雄建國']];
  var C = { ink:'#1D1D1F', l2:'#6E6E73', l3:'#A1A1A6', gray:'#D1D1D6', gray2:'#C7C7CC', fill:'#ECECEF', red:'#E0172D', orange:'#FF8D00', blue:'#0A7AFF', asst:'#AF52DE', cs:'#30B0C7', focus:'#34C759', biz:'#FFB800' };
  if (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) { C.ink = '#F5F5F7'; C.l2 = '#98989D'; C.l3 = '#636366'; C.gray = '#48484A'; C.gray2 = '#3A3A3C'; C.fill = '#2C2C2E'; C.red = '#FF5A6A'; C.orange = '#FFA03D'; C.blue = '#409CFF'; }
  var SEGS = [['① 助理', C.asst], ['② 客服', C.cs], ['③ 主管', '#5856D6'], ['④ 本日重點', C.focus], ['⑤ 業務', C.biz]];
  var ALL7 = ['壢一', '壢二', '壢三', '台一', '台二', '台三', '建國'], ORG_KEY = 'pg1340_org_' + D.r, CMP_KEY = 'pg1340_cmp';
  function lsGet(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }
  function lsSet(k, v){ try { localStorage.setItem(k, v); } catch(e){} }
  (function(){ var q = new URLSearchParams(location.search).get('o'), v = q != null ? q : lsGet(ORG_KEY);
    ST.org = (v && ORGS.indexOf(v) >= 0) ? v : ''; ST.asked = v != null || ORGS.length < 2;
    var c = {}; try { c = JSON.parse(lsGet(CMP_KEY) || '{}') || {}; } catch(e){} ST.cmp = { rank: c.rank || '', inc: c.inc || '' }; })();
  function FOCUS(){ return ST.org ? [ST.org] : ORGS; }
  function NARROW(){ return !!(window.matchMedia && matchMedia('(max-width: 1023px)').matches); }   // v1.9 手機、平板：往下滑的版面，面板從底部上來
  function wrapTables(){ Z.querySelectorAll('.zb table').forEach(function(t){ if (t.parentNode.classList.contains('tw')) return; var w = document.createElement('div'); w.className = 'tw'; t.parentNode.insertBefore(w, t); w.appendChild(t); }); }
  function sheetIn(p){ if (REDUCE) return; p.style.transform = 'translateY(100%)'; p.getBoundingClientRect(); p.style.transition = 'transform 420ms cubic-bezier(.2,.9,.25,1)'; p.style.transform = 'none'; }
  function cmpOf(id){ if (ORGS.length < 2) return '七家'; var v = ST.cmp[id]; if (v) return v; return id === 'rank' && ST.org ? '本區' : '七家'; }
  function scopeOf(id){ return cmpOf(id) === '本區' ? ORGS : ALL7; }
  function setOrg(o){ ST.org = o; ST.asked = true; lsSet(ORG_KEY, o || 'all'); try { var u = new URL(location.href); if (o) u.searchParams.set('o', o); else u.searchParams.delete('o'); history.replaceState(null, '', u.toString()); } catch(e){} }
  function dOf(s){ var m = String(s).match(/(\\d{4})\\/(\\d{2})\\/(\\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }

  /* ── 小工具 ── */
  function el(p, t, a, txt){ var e = document.createElementNS(NS, t); for (var k in a) e.setAttribute(k, a[k]); if (txt != null) e.textContent = txt; p.appendChild(e); return e; }
  function svgOf(box){ var s = box.querySelector('svg.ch'); if (!s) return null; while (s.firstChild) s.removeChild(s.firstChild); var r = s.getBoundingClientRect(); var w = Math.max(40, r.width), h = Math.max(30, r.height); s.setAttribute('viewBox', '0 0 ' + w + ' ' + h); return [s, w, h, parseFloat(getComputedStyle(s).fontSize) || 15]; }
  function wan(v){ v = +v || 0; return Math.abs(v) >= 10000 ? (Math.round(v / 1000) / 10) + ' 萬' : v.toLocaleString(); }
  function ymd(d){ return d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0'); }
  function md(s){ var m = String(s).match(/\\d{4}\\/(\\d{2})\\/(\\d{2})/); return m ? (+m[1]) + '/' + (+m[2]) : s; }
  var WK = '日一二三四五六';
  var TODAY = (function(){ var m = String(D.date || '').match(/(\\d{4})-(\\d{2})-(\\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(); })();
  function addD(d, n){ return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function pjx(x){ return x.排進班 != null ? x.排進班 : x.進班上課; }
  function chName(sub){ sub = String(sub || '').replace(/^\\d{4}[_\\-]\\d{2}\\s*/, '').replace(/[（(].*?[)）]/g, '').trim(); return sub || '其他通路'; }
  function baseUrl(){ return D.baseUrl || location.pathname; }
  function go(u){ try { window.top.location.href = u; } catch(e){ location.href = u; } }
  function setUrl(v){ try { var u = new URL(location.href); if (v) u.searchParams.set('v', v); else u.searchParams.delete('v'); history.replaceState(null, '', u.toString()); } catch(e){} }

  /* ── 入帳：區域、日期範圍 ── */
  function incPeople(orgs){ var o = {}; if (!I) return o; Object.keys(I.誰 || {}).forEach(function(k){ var p = I.誰[k]; if (orgs.indexOf(p.院) >= 0) o[k] = p; }); return o; }
  function sumBy(rows, f){ var o = {}; rows.forEach(function(r){ var k = f(r); if (k == null) return; o[k] = (o[k] || 0) + (+r[3] || 0); }); return o; }
  function champWin(){   // 週一看週六＋週日；其他天看昨天
    var dow = TODAY.getDay();
    if (dow === 1) return { from: ymd(addD(TODAY, -2)), to: ymd(addD(TODAY, -1)), label: '週末（' + md(ymd(addD(TODAY, -2))) + '–' + md(ymd(addD(TODAY, -1))) + '）', short: '週末' };
    var y = addD(TODAY, -1); return { from: ymd(y), to: ymd(y), label: md(ymd(y)) + '（' + WK[y.getDay()] + '）', short: '昨天' };
  }
  function lastDays(n){   // 最近 n 個「有入帳」的日子（今天以前）
    if (!I) return []; var t = ymd(TODAY), s = {}; (I.日 || []).forEach(function(r){ if (r[1] < t && r[2]) s[r[1]] = 1; });
    return Object.keys(s).sort().slice(-n);
  }
  function champs(orgs){
    if (!I) return null;
    var w = champWin(), ppl = incPeople(orgs), sales = Object.keys(ppl).filter(function(k){ return !ppl[k].nb; });
    var inWin = function(d){ return d >= w.from && d <= w.to; };
    var amt = {}, cnt = {}, mtd = {}, dayReg = {}, dayPer = {};
    (I.人 || []).forEach(function(r){ var k = r[0] + '|' + r[1]; if (!ppl[k]) return;
      if (inWin(r[2])) { amt[k] = (amt[k] || 0) + r[3]; cnt[k] = (cnt[k] || 0) + r[4]; }
      if (String(r[2]).indexOf(I.月 + '/') === 0) mtd[k] = (mtd[k] || 0) + r[3];
      dayReg[r[2]] = (dayReg[r[2]] || 0) + r[3]; (dayPer[k] || (dayPer[k] = {}))[r[2]] = (dayPer[k][r[2]] || 0) + r[3]; });
    var top = sales.filter(function(k){ return (amt[k] || 0) > 0; }).sort(function(a, b){ return amt[b] - amt[a]; }).slice(0, 3);
    var mtdRank = sales.slice().sort(function(a, b){ return (mtd[b] || 0) - (mtd[a] || 0); });
    var sF = 0, sT = 0; sales.forEach(function(k){ var s = ppl[k].s; if (s){ sF += s.面談; sT += s.註冊; } });
    var regRate = sF ? sT / sF : 0;
    var regDays = Object.keys(dayReg).filter(function(d){ return dayReg[d] > 0 && d <= w.to; }).sort().reverse();
    return { win: w, list: top.map(function(k, i){
      var p = ppl[k], s = p.s || null, its = (I.明細 || []).filter(function(r){ return r[0] + '|' + r[1] === k && inWin(r[2]); });
      var bySid = {}; its.forEach(function(r){ var b = bySid[r[7]] || (bySid[r[7]] = { ch: chName(r[5]), cs: [], v: 0 }); if (b.cs.indexOf(r[4]) < 0) b.cs.push(r[4]); b.v += r[3]; });
      var studs = Object.keys(bySid).map(function(x){ return bySid[x]; }).sort(function(a, b){ return b.v - a.v; });
      var streak = 0; for (var j = 0; j < regDays.length; j++){ if ((dayPer[k] || {})[regDays[j]] > 0) streak++; else break; }
      var big = studs.filter(function(x){ return x.cs.length >= 2; })[0], q = '';
      if (big) q = big.ch === '學員加購' ? '一位舊生一次加購 ' + big.cs.length + ' 科。' : '一位' + big.ch + '來的學生，一次報 ' + big.cs.length + ' 科。';
      else if (studs.length >= 3) q = w.short + '收了 ' + studs.length + ' 位學生的款。';
      else if (studs.length) q = (studs[0].ch === '學員加購' ? '舊生加購' : studs[0].ch + '來的學生，報') + clip(studs[0].cs[0], 14) + '。';
      return { k: k, 名: p.名, 院: p.院, amt: amt[k], n: cnt[k] || its.length, studs: studs, mtd: mtd[k] || 0, mtdRank: mtdRank.indexOf(k) + 1,
        報到: s ? s.報到 : null, rate: s && s.面談 ? s.註冊 / s.面談 : null, 面談: s ? s.面談 : 0, regRate: regRate, streak: streak, quote: q, courses: its.map(function(r){ return r[4]; }).filter(function(c, ix, a){ return a.indexOf(c) === ix; }) };
    }) };
  }

  /* ── 主管點名：從議程主管段抓「誰 這個月報到 N，連 X 天沒有新增報到」 ── */
  function leadPeople(){
    var t = (typeof secText === 'function' ? secText('🧑') : '') || '', out = [];
    t.split('\\n').forEach(function(l){ var m = l.match(/^\\s*(?:📌)?\\s*([^\\s，,、。0-9]{2,4}?)這個月報到\\s*(\\d+)(?:[，,]\\s*連\\s*(\\d+)\\s*天)?/); if (m) out.push({ n: m[1], v: +m[2], d: m[3] ? +m[3] : 0, line: l.trim() }); });
    return out;
  }
  function focusItems(){
    var t = (typeof secText === 'function' ? secText('🎤') : '') || '', out = [], cur = null;
    t.split('\\n').slice(1).forEach(function(l){ var s = l.trim(); if (!s) return; var m = s.match(/^(\\d+)[.、．]\\s*(.*)$/);
      if (m){ cur = { n: m[1], t: m[2], sub: 0 }; out.push(cur); } else if (cur) cur.sub++; });
    return out;
  }

  /* ── 圖表 ── */
  function hbars(box, rows, opt){   // rows: {l, v, me, tail, tailC}
    var g = svgOf(box); if (!g) return; var s = g[0], w = g[1], h = g[2], fs = g[3];
    if (!rows.length){ el(s, 'text', { x: w / 2, y: h / 2, 'text-anchor': 'middle', 'font-size': fs * .85, fill: C.l3 }, '沒有資料'); return; }
    var mx = Math.max.apply(null, rows.map(function(r){ return r.v; })) || 1, rh = h / rows.length, x0 = fs * 2.6, tailW = opt && opt.tail ? fs * 3.2 : 0, x1 = w - tailW - fs * 2.4;
    rows.forEach(function(r, i){ var y = i * rh + rh * .16, bh = Math.max(4, Math.min(rh * .6, fs * 1.8)), bw = Math.max(2, (x1 - x0) * r.v / mx);
      el(s, 'text', { x: 0, y: y + bh * .78, 'font-size': fs * .85, 'font-weight': r.me ? 700 : 500, fill: r.me ? C.ink : C.l3 }, r.l);
      el(s, 'rect', { x: x0, y: y, width: bw, height: bh, rx: Math.min(5, bh / 3), fill: r.me ? C.ink : C.gray });
      el(s, 'text', { x: x0 + bw + fs * .35, y: y + bh * .78, 'font-size': fs * .95, 'font-weight': 800, fill: r.me ? C.ink : C.l3 }, (opt && opt.fmt ? opt.fmt(r.v) : r.v));
      if (r.tail) el(s, 'text', { x: w, y: y + bh * .78, 'font-size': fs * .8, 'font-weight': 700, fill: r.tailC || C.l2, 'text-anchor': 'end' }, r.tail);
    });
  }
  function bullets(box, list){
    var g = svgOf(box); if (!g) return; var s = g[0], w = g[1], h = g[2], fs = g[3];
    if (!list.length){ el(s, 'text', { x: w / 2, y: h / 2, 'text-anchor': 'middle', 'font-size': fs * .9, fill: C.l3 }, '14 天內沒有要開的班'); return; }
    var n = Math.min(list.length, Math.max(2, Math.floor(h / (fs * 2.9)))), rh = h / n, lw = Math.min(w * .36, fs * 11), x0 = lw + fs * .6, x1 = w - fs * 4.6;
    list.slice(0, n).forEach(function(c, i){ var y = i * rh + rh * .2, bh = Math.max(8, Math.min(rh * .42, fs * 1.3)), seat = c.seat || Math.max(c.reg, c.th, 1), ok = c.ok;
      var g2 = el(s, 'g', { 'data-id': c.cid, style: 'cursor:pointer' });
      el(g2, 'text', { x: 0, y: y + fs * .8, 'font-size': fs * .72, 'font-weight': 700, fill: C.blue }, c.code);
      el(g2, 'text', { x: 0, y: y + fs * 1.85, 'font-size': fs * .86, 'font-weight': 600, fill: C.ink }, clip(shortNm(c.name), Math.floor(lw / (fs * .86))));
      el(g2, 'rect', { x: x0, y: y + fs * .25, width: x1 - x0, height: bh, rx: bh / 2, fill: C.fill });
      var bw = Math.max(bh, (x1 - x0) * Math.min(1, c.reg / seat));
      el(g2, 'rect', { x: x0, y: y + fs * .25, width: bw, height: bh, rx: bh / 2, fill: ok ? C.red : C.orange });
      if (bw > fs * 2) el(g2, 'text', { x: x0 + bw - fs * .45, y: y + fs * .25 + bh * .74, 'font-size': fs * .78, 'font-weight': 800, fill: '#fff', 'text-anchor': 'end' }, c.reg);
      if (c.th){ var tx = x0 + (x1 - x0) * Math.min(1, c.th / seat); el(g2, 'line', { x1: tx, x2: tx, y1: y + fs * .25 - 4, y2: y + fs * .25 + bh + 4, stroke: C.ink, 'stroke-width': 2 }); }
      el(g2, 'text', { x: w, y: y + fs * .25 + bh * .74, 'font-size': fs * .95, 'font-weight': 800, fill: ok ? C.red : C.orange, 'text-anchor': 'end' }, ok ? '過門檻' : '差 ' + needN(c) + ' 位');
      el(g2, 'text', { x: w, y: y + fs * .25 + bh + fs * .95, 'font-size': fs * .74, fill: C.l2, 'text-anchor': 'end' }, c.toOpen ? '剩 ' + c.toOpen + ' 天' : '今天開班');
    });
    if (list.length > n) el(s, 'text', { x: 0, y: h - 2, 'font-size': fs * .74, fill: C.l2 }, '還有 ' + (list.length - n) + ' 班，點開看全部');
  }
  function clip(t, n){ t = String(t || ''); return t.length > n ? t.slice(0, Math.max(1, n - 1)) + '…' : t; }
  function streaks(box, ppl){
    var g = svgOf(box); if (!g) return; var s = g[0], w = g[1], h = g[2], fs = g[3];
    var n = Math.min(ppl.length, Math.max(1, Math.floor(h / (fs * 2.4)))), rh = h / Math.max(n, 3), cells = 14, x0 = fs * 6.2, cw = (w - x0 - fs * 3.4) / cells;
    ppl.slice(0, n).forEach(function(p, i){ var y = i * rh + rh / 2;
      el(s, 'circle', { cx: fs * 1.15, cy: y, r: fs * 1.05, fill: 'rgba(10,122,255,.1)' });
      el(s, 'text', { x: fs * 1.15, y: y + fs * .32, 'font-size': fs * .85, 'font-weight': 700, fill: C.blue, 'text-anchor': 'middle' }, p.n.slice(0, 1));
      el(s, 'text', { x: fs * 2.6, y: y - fs * .05, 'font-size': fs * .92, 'font-weight': 700, fill: C.blue }, p.n);
      el(s, 'text', { x: fs * 2.6, y: y + fs * .95, 'font-size': fs * .72, fill: C.l2 }, '報到 ' + p.v);
      var d = Math.min(cells, p.d);
      for (var k = 0; k < cells; k++) el(s, 'rect', { x: x0 + k * cw, y: y - fs * .42, width: Math.max(2, cw - 3), height: fs * .84, rx: 3, fill: k >= cells - d ? C.orange : C.fill });
      el(s, 'text', { x: w, y: y + fs * .35, 'font-size': fs * 1.05, 'font-weight': 800, fill: p.d ? C.orange : C.l2, 'text-anchor': 'end' }, p.d ? p.d + ' 天' : '—');
    });
  }
  function funnel(box, rows){
    var g = svgOf(box); if (!g) return; var s = g[0], w = g[1], h = g[2], fs = g[3];
    if (!rows.length){ el(s, 'text', { x: w / 2, y: h / 2, 'text-anchor': 'middle', 'font-size': fs * .85, fill: C.l3 }, '沒有資料'); return; }
    var mx = Math.max.apply(null, rows.map(function(r){ return r.談過; })) || 1, rh = Math.min(h / rows.length, fs * 5.4), y0 = (h - rh * rows.length) / 2, x0 = fs * 2.4, W = w - x0 - fs * .3;
    rows.forEach(function(r, i){ var y = y0 + i * rh + rh * .12, bh = Math.min(rh * .48, fs * 1.7);
      el(s, 'text', { x: 0, y: y + bh * .75, 'font-size': fs * .85, 'font-weight': 700, fill: C.ink }, r.o);
      [[r.談過, 'rgba(175,82,222,.22)'], [r.註冊, 'rgba(175,82,222,.6)'], [pjx(r), C.asst]].forEach(function(z){ el(s, 'rect', { x: x0, y: y, width: Math.max(z[0] ? 3 : 0, W * z[0] / mx), height: bh, rx: 3, fill: z[1] }); });
      el(s, 'text', { x: x0 + W * r.談過 / mx - fs * .3, y: y + bh * .74, 'font-size': fs * .78, 'font-weight': 700, fill: '#5B2B80', 'text-anchor': 'end' }, r.談過);
      el(s, 'text', { x: x0, y: y + bh + fs * .95, 'font-size': fs * .72, fill: C.l2 }, '註冊 ' + r.註冊 + ' → 排進班 ' + pjx(r) + (r.上過課 != null ? ' → 上過課 ' + r.上過課 : ''));
    });
  }
  function uncBars(box, rows){
    var g = svgOf(box); if (!g) return; var s = g[0], w = g[1], h = g[2], fs = g[3];
    var cols = ['rgba(255,141,0,.28)', 'rgba(255,141,0,.6)', C.orange], mx = Math.max(1, Math.max.apply(null, rows.map(function(r){ return r.b[0] + r.b[1] + r.b[2]; }))), rh = Math.min(h / Math.max(1, rows.length), fs * 5.4), y0 = (h - rh * Math.max(1, rows.length)) / 2, x0 = fs * 2.4, W = w - x0 - fs * 2;
    rows.forEach(function(r, i){ var y = y0 + i * rh + rh * .2, bh = Math.min(rh * .5, fs * 1.6), x = x0, t = r.b[0] + r.b[1] + r.b[2];
      el(s, 'text', { x: 0, y: y + bh * .75, 'font-size': fs * .85, 'font-weight': 700, fill: C.ink }, r.o);
      if (!t) el(s, 'rect', { x: x0, y: y, width: W, height: bh, rx: 3, fill: C.fill });
      r.b.forEach(function(v, k){ if (!v) return; var bw = W * v / mx; el(s, 'rect', { x: x, y: y, width: Math.max(2, bw - 2), height: bh, rx: 3, fill: cols[k] }); x += bw; });
      el(s, 'text', { x: w, y: y + bh * .78, 'font-size': fs * 1.05, 'font-weight': 800, fill: r.b[2] ? C.orange : (t ? C.ink : C.l3), 'text-anchor': 'end' }, t);
      if (r.max) el(s, 'text', { x: x0, y: y + bh + fs * .95, 'font-size': fs * .72, fill: C.l2 }, '最久 ' + r.max + ' 天');
    });
  }
  function rings(box, list){
    var g = svgOf(box); if (!g) return; var s = g[0], w = g[1], h = g[2], fs = g[3];
    if (!list.length){ el(s, 'text', { x: w / 2, y: h / 2, 'text-anchor': 'middle', 'font-size': fs * .85, fill: C.l3 }, '這幾天沒有要追的出席'); return; }
    var per = Math.min(list.length, 4), cols = per <= 2 ? per : 2, rowsN = per <= 2 ? 1 : 2, cw = w / cols, chh = h / rowsN;
    var R = Math.max(12, Math.min(cw * .4, (chh - fs * 2.2) / 2)), sw = Math.max(6, R * .18);
    list.slice(0, per).forEach(function(c, i){ var cx = (i % cols) * cw + cw / 2, cy = Math.floor(i / cols) * chh + (chh - fs * 1.6) / 2, p = c.p, a = 2 * Math.PI * R;
      var g2 = el(s, 'g', { 'data-id': c.cid, style: 'cursor:pointer' });
      el(g2, 'circle', { cx: cx, cy: cy, r: R, fill: 'none', stroke: C.fill, 'stroke-width': sw });
      if (p != null) el(g2, 'circle', { cx: cx, cy: cy, r: R, fill: 'none', stroke: p < .7 ? C.orange : C.cs, 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-dasharray': (a * p) + ' ' + a, transform: 'rotate(-90 ' + cx + ' ' + cy + ')' });
      el(g2, 'text', { x: cx, y: cy + Math.min(fs * 1.6, R * .5) * .36, 'font-size': Math.min(fs * 1.6, R * .5), 'font-weight': 800, fill: C.ink, 'text-anchor': 'middle' }, p == null ? '未傳' : Math.round(p * 100) + '%');
      el(g2, 'text', { x: cx, y: cy + R + sw / 2 + fs * 1.05, 'font-size': fs * .78, 'font-weight': 700, fill: C.blue, 'text-anchor': 'middle' }, c.code);
    });
  }
  function incCols(box, opt){
    var g = svgOf(box); if (!g) return; var s = g[0], w = g[1], h = g[2], fs = g[3];
    var days = lastDays(3);
    if (!I || !days.length){ el(s, 'text', { x: w / 2, y: h / 2, 'text-anchor': 'middle', 'font-size': fs * .85, fill: C.l3 }, I ? '最近沒有入帳資料' : '入帳資料等下一次 🏫 班況同步'); return; }
    var all = (opt && opt.scope) || ALL7, mine = (opt && opt.mine) || FOCUS(), v = {};
    (I.日 || []).forEach(function(r){ var di = days.indexOf(r[1]); if (di < 0) return; (v[r[0]] || (v[r[0]] = [0, 0, 0]))[di] += r[2]; });
    var tot = all.map(function(o){ return (v[o] || [0, 0, 0]).reduce(function(a, b){ return a + b; }, 0); }), mx = Math.max.apply(null, tot) || 1;
    var ringW = opt && opt.ring ? Math.min(w * .22, h * .5) : 0, cw = (w - ringW) / all.length, base = h - fs * 1.4, top = fs * 1.6;
    var mineC = ['rgba(29,29,31,.28)', 'rgba(29,29,31,.55)', C.ink], othC = [C.fill, C.gray2, C.gray];
    if (C.ink !== '#1D1D1F') mineC = ['rgba(245,245,247,.3)', 'rgba(245,245,247,.6)', C.ink];
    all.forEach(function(o, i){ var x = i * cw, m = mine.indexOf(o) >= 0, y = base, vv = v[o] || [0, 0, 0];
      if (opt && opt.ink) m = true;
      if (m && !(opt && opt.ink)) el(s, 'rect', { x: x + cw / 2 - Math.min(cw * .44, fs * 2.6), y: top * .35, width: Math.min(cw * .88, fs * 5.2), height: h - top * .35, rx: fs * .5, fill: 'none', stroke: C.ink, 'stroke-width': 1.2, 'stroke-dasharray': '4 3', opacity: .45 });
      var bw = Math.min(cw * .52, fs * 3.4); vv.forEach(function(a, k){ var bh = (base - top) * a / mx; if (bh <= 0) return; y -= bh; el(s, 'rect', { x: x + (cw - bw) / 2, y: y, width: bw, height: Math.max(1, bh - 1.5), rx: 3, fill: (m ? mineC : othC)[k] }); });
      el(s, 'text', { x: x + cw / 2, y: y - fs * .3, 'font-size': fs * .78, 'font-weight': 800, fill: m ? C.ink : C.l2, 'text-anchor': 'middle' }, tot[i] ? (Math.round(tot[i] / 1000) / 10) : '0');
      el(s, 'text', { x: x + cw / 2, y: h - fs * .15, 'font-size': fs * .78, 'font-weight': m ? 700 : 500, fill: m ? C.ink : C.l3, 'text-anchor': 'middle' }, o);
    });
    if (ringW){ var cx = w - ringW / 2, cy = h / 2 - fs * .3, R = ringW * .38, a = 2 * Math.PI * R, last = new Date(TODAY.getFullYear(), TODAY.getMonth() + 1, 0).getDate(), left = last - TODAY.getDate(), p = TODAY.getDate() / last;
      el(s, 'circle', { cx: cx, cy: cy, r: R, fill: 'none', stroke: 'rgba(255,184,0,.22)', 'stroke-width': R * .18 });
      el(s, 'circle', { cx: cx, cy: cy, r: R, fill: 'none', stroke: C.biz, 'stroke-width': R * .18, 'stroke-linecap': 'round', 'stroke-dasharray': (a * p) + ' ' + a, transform: 'rotate(-90 ' + cx + ' ' + cy + ')' });
      el(s, 'text', { x: cx, y: cy + R * .18, 'font-size': R * .62, 'font-weight': 800, fill: C.ink, 'text-anchor': 'middle' }, left + ' 天');
      el(s, 'text', { x: cx, y: cy + R + fs * 1.3, 'font-size': fs * .72, fill: C.l2, 'text-anchor': 'middle' }, '離月底結算');
    }
  }

  /* ── 資料整理（單區） ── */
  function rankRows(){ var all = (RANK && RANK.all) || (RANK && RANK.rows) || [], sc = scopeOf('rank'); return all.filter(function(x){ return sc.indexOf(x.院) >= 0; }).map(function(x){ return { l: x.院, v: x.n, me: FOCUS().indexOf(x.院) >= 0, tail: x.diff == null ? '' : (x.diff > 0 ? '+' + x.diff : String(x.diff)), tailC: x.diff > 0 ? C.red : C.l2 }; }); }
  function funRows(){ var F = (A && A.fun) || [];
    if (ST.org) return F.filter(function(x){ return x.院 === ST.org && !x.主管 && +x.談過; }).sort(function(a, b){ return b.談過 - a.談過; }).slice(0, 8).map(function(x){ return { o: short(x.業務), 談過: +x.談過 || 0, 註冊: +x.註冊 || 0, 排進班: +pjx(x) || 0, 上過課: x.上過課 }; });
    return ORGS.map(function(o){ var f = F.filter(function(x){ return x.院 === o; }), s = { o: o, 談過: 0, 註冊: 0, 排進班: 0, 上過課: null };
    f.forEach(function(x){ s.談過 += +x.談過 || 0; s.註冊 += +x.註冊 || 0; s.排進班 += +pjx(x) || 0; if (x.上過課 != null) s.上過課 = (s.上過課 || 0) + (+x.上過課 || 0); }); return s; }).filter(function(s){ return s.談過; }); }
  function uncRows(){ var U = (A && A.unc) || [];
    var keys = ST.org ? U.filter(function(x){ return x.院 === ST.org; }).map(function(x){ return short(x.承辦) || '（沒有承辦）'; }).filter(function(k, i, a){ return a.indexOf(k) === i; }) : ORGS;
    var rows = keys.map(function(o){ var u = U.filter(function(x){ return ST.org ? (x.院 === ST.org && (short(x.承辦) || '（沒有承辦）') === o) : x.院 === o; }), b = [0, 0, 0], mx = 0;
    u.forEach(function(x){ var d = +x.天 || 0; mx = Math.max(mx, d); b[d <= 7 ? 0 : (d <= 14 ? 1 : 2)]++; }); return { o: o, b: b, max: mx, u: u }; });
    return ST.org ? rows.sort(function(a, b){ return b.u.length - a.u.length; }).slice(0, 8) : rows; }
  function inFocus(c){ if (!ST.org) return true; return c.院 ? c.院 === ST.org : String(c.code || '').indexOf(ST.org) === 0; }
  function attList(){ return (typeof SHOW_D !== 'undefined' ? SHOW_D : []).filter(function(c){ return (c.grp === '已開班' || c.grp === '未到多') && inFocus(c); }).map(function(c){ var f = c.grp === '已開班' ? c.first : c.last; return { cid: c.cid, code: c.code, name: c.name, p: f && f.應到 ? f.實到 / f.應到 : null, c: c }; }).sort(function(a, b){ return (a.p == null ? -1 : a.p) - (b.p == null ? -1 : b.p); }); }
  function openList(){ return (typeof OPEN !== 'undefined' ? OPEN : []).filter(function(c){ return c.type !== '講座' && inFocus(c); }).slice().sort(function(a, b){ return (a.ok - b.ok) || (a.toOpen - b.toOpen); }); }

  /* ── 版面 ── */
  var CARDS = [
    { id: 'rank', seg: 1, dot: C.asst, cmp: 1, t: function(){ return (A && A.月 ? (+String(A.月).split('/')[1]) + ' 月' : '本月') + '報到・' + (ST.view !== 'all' && cmpOf('rank') === '本區' ? REGION + '比' : '七家比'); }, s: function(){ return (RANK && RANK.cur ? '到 ' + RANK.cur : '') + (ST.view === 'all' ? '・比前一天' : '・深色是' + (ST.org || '我們')); }, body: '<svg class="ch"></svg>', draw: function(b){ hbars(b, rankRows(), { tail: 1 }); } },
    { id: 'open', seg: 2, dot: C.orange, hot: 1, t: function(){ return '14 天內要開的班'; }, s: function(){ return '直線＝開班門檻・點一班看名單'; },
      body: function(){ var L = openList(), need = L.filter(function(c){ return !c.ok; }), gap = need.reduce(function(a, c){ return a + needN(c); }, 0);
        return '<div class="kpi"><b class="' + (need.length ? 'og' : '') + '">' + L.length + '<small>班</small></b><span>' + (need.length ? need.length + ' 班還差人・共差 <em class="og" style="font-style:normal;font-weight:800">' + gap + ' 位</em>' : (L.length ? '都過門檻了' : '')) + '</span></div><svg class="ch"></svg>'; },
      draw: function(b){ bullets(b, openList()); } },
    { id: 'lead', seg: 3, dot: '#5856D6', t: function(){ return '主管・報到排名'; }, s: function(){ return (ST.org || REGION) + '・橘色＝3 天以上沒有新增報到・點名字看明細'; },
      body: function(){ var L = leadRank();
        if (!L){ var P = leadPeople(); if (P.length) return '<svg class="ch"></svg>'; var t = (typeof secText === 'function' ? secText('🧑') : ''); if (!t) return '<p class="none">' + esc(D.agNone || '今天議程沒有這一段') + '</p>';
          return '<div class="lt">' + t.split('\\n').slice(1).filter(function(l){ return l.trim(); }).slice(0, 6).map(function(l){ return '<p>' + fmtLine(l.replace(/^\\s*\\d+[.、]\\s*/, '')) + '</p>'; }).join('') + '</div>'; }
        if (!L.length) return '<p class="none">這一院沒有業務資料</p>';
        var mx = Math.max.apply(null, L.map(function(x){ return x.v; })) || 1;
        return '<div class="lrk">' + L.map(function(x){ var hot = x.none || (x.d != null && x.d >= 3);
          return '<button type="button" class="lrow' + (hot ? ' hot' : '') + '" data-p="' + esc(x.k) + '"><span class="n">' + esc(x.名) + (ST.org || ORGS.length < 2 ? '' : '<small>' + esc(x.院) + '</small>') + '</span><span class="t"><i style="width:' + Math.max(2, x.v / mx * 100) + '%"></i></span><span class="v">' + x.v + '</span><span class="d">' + esc(dayTxt(x)) + '</span></button>'; }).join('') + '<div class="lmore" hidden></div></div>'; },
      draw: function(b){ if (!leadRank()){ var P = leadPeople(); if (P.length) streaks(b, P); return; } fitRows(b); } },
    { id: 'fun', seg: 1, dot: C.asst, t: function(){ return '走到哪一關'; }, s: function(){ return (A && A.月 ? (+String(A.月).split('/')[1]) + ' 月談過的人' : ''); },
      body: '<svg class="ch"></svg><div class="leg"><span><i style="background:rgba(175,82,222,.22)"></i>談過</span><span><i style="background:rgba(175,82,222,.6)"></i>註冊</span><span><i style="background:' + C.asst + '"></i>排進班</span></div>', draw: function(b){ funnel(b, funRows()); } },
    { id: 'unc', seg: 1, dot: C.asst, t: function(){ return '註冊未消耗'; }, s: function(){ return '繳了學費、還沒登記上課'; },
      body: '<svg class="ch"></svg><div class="leg"><span><i style="background:rgba(255,141,0,.28)"></i>7 天內</span><span><i style="background:rgba(255,141,0,.6)"></i>8–14 天</span><span><i style="background:' + C.orange + '"></i>15 天以上</span></div>', draw: function(b){ uncBars(b, uncRows()); } },
    { id: 'att', seg: 2, dot: C.cs, t: function(){ return '出席'; }, s: function(){ return '已開班・最近一堂'; }, body: '<svg class="ch"></svg>', draw: function(b){ rings(b, attList()); } },
    { id: 'focus', seg: 4, dot: C.focus, t: function(){ return '本日重點'; }, s: function(){ return ''; },
      body: function(){ var F = focusItems(); if (!F.length) return '<p class="none">' + esc((D.agNone || '今天議程沒有這一段').split('，')[0]) + '</p>';
        return '<div class="fl">' + F.map(function(f){ var t = f.t.replace(/[：:]\\s*$/, ''); return '<div><b>' + esc(f.n) + '</b><span>' + esc(t) + (f.sub ? '<em class="cnt">' + f.sub + ' 項</em>' : '') + '</span></div>'; }).join('') + '</div>'; } },
    { id: 'inc', seg: 5, dot: C.red, cmp: 1, t: function(){ return '近三天入帳・' + (ST.view !== 'all' && cmpOf('inc') === '本區' ? REGION : '中壢以南'); }, s: function(){ var d = lastDays(3); return (d.length ? md(d[0]) + '–' + md(d[d.length - 1]) + '・' : '') + '萬元' + (ST.view === 'all' ? '・三天疊起來' : '・深色是' + (ST.org || '我們')); },
      body: '<svg class="ch"></svg>', draw: function(b){ incCols(b, { ring: 1, scope: scopeOf('inc') }); } }
  ];
  function head(c){ var tg = '';
    if (c.cmp && ST.view !== 'all' && ORGS.length > 1){ var v = cmpOf(c.id); tg = '<span class="mseg"><button type="button" data-cmp="' + c.id + '" data-v="本區" class="' + (v === '本區' ? 'on' : '') + '">' + esc(REGION) + '</button><button type="button" data-cmp="' + c.id + '" data-v="七家" class="' + (v === '七家' ? 'on' : '') + '">中壢以南</button></span>'; }
    return '<div class="bh"><i style="background:' + c.dot + '"></i><b>' + esc(c.t()) + '</b><span>' + esc(c.s()) + '</span>' + tg + '<span class="x">⤢</span></div>'; }
  /* 主管報到排名：業務分頁每個人的 10 月報到 ＋ 報到明細算「幾天沒有新增」（沒有明細時退回議程主管段的天數） */
  function leadRank(){
    var P = (D.ppl && D.ppl.人) || []; if (!P.length) return null;
    var rows = (D.ck && D.ck.列) || [], has = rows.length > 0, last = {}, ag = {}, mon = ymd(TODAY).slice(0, 8);
    rows.forEach(function(r){ var k = r[0] + '|' + r[1]; if (r[3].slice(0, 8) === mon && (!last[k] || r[3] > last[k])) last[k] = r[3]; });
    leadPeople().forEach(function(x){ ag[x.n] = x.d; });
    return P.filter(function(p){ return !p.nb && FOCUS().indexOf(p.院) >= 0; }).map(function(p){
      var k = p.院 + '|' + p.全名, l = last[k], d = null, none = false;
      if (has){ if (l) d = Math.max(0, Math.round((TODAY - dOf(l)) / 864e5)); else { none = true; d = TODAY.getDate(); } }
      else if (ag[p.名] != null) d = ag[p.名];
      return { k: k, 名: p.名, 院: p.院, 全名: p.全名, v: +p.報到 || 0, 面談: +p.面談 || 0, 註冊: +p.註冊 || 0, d: d, last: l || '', none: none };
    }).sort(function(a, b){ return (b.v - a.v) || ((b.d || 0) - (a.d || 0)); });
  }
  function dayTxt(x){ if (x.none) return '本月沒有'; if (x.d == null) return '—'; return x.d === 0 ? '今天有' : x.d + ' 天'; }
  function fitRows(b){ var box = b.querySelector('.lrk'); if (!box) return; var rows = [].slice.call(box.querySelectorAll('.lrow')), more = box.querySelector('.lmore');
    rows.forEach(function(r){ r.hidden = false; }); more.hidden = true;
    var H = box.clientHeight; if (box.scrollHeight <= H + 1) return;
    more.hidden = false; more.textContent = '還有 99 位，點 ⤢ 看全部';
    var lim = H - more.offsetHeight - 6, used = 0, hide = 0;
    rows.forEach(function(r){ used += r.offsetHeight + 2; if (used > lim){ r.hidden = true; hide++; } });
    more.textContent = '還有 ' + hide + ' 位，點 ⤢ 看全部'; }
  /* 點一個人：右邊滑出他的報到明細 */
  function personHtml(k){
    var L = leadRank() || [], x = L.filter(function(p){ return p.k === k; })[0]; if (!x) return '';
    var rows = ((D.ck && D.ck.列) || []).filter(function(r){ return r[0] + '|' + r[1] === k; }).sort(function(a, b){ return a[3] < b[3] ? 1 : -1; });
    var mon = ymd(TODAY).slice(0, 8), cnt = {}; rows.forEach(function(r){ if (r[3].slice(0, 8) === mon) cnt[+r[3].slice(8)] = (cnt[+r[3].slice(8)] || 0) + 1; });
    var cal = ''; for (var d = 1; d <= TODAY.getDate(); d++){ var on = cnt[d], stop = x.last && d > +x.last.slice(8) && !on; cal += '<i class="' + (on ? 'h' : '') + (stop && x.d >= 3 ? ' o' : '') + '" title="' + (+mon.slice(5, 7)) + '/' + d + (on ? '・' + on + ' 位' : '') + '">' + (on ? '<b>' + on + '</b>' : '') + '<s>' + d + '</s></i>'; }
    var same = L.filter(function(p){ return p.院 === x.院; });
    var h = '<div class="ph"><h2>' + esc(x.名) + '</h2><span>' + esc(x.院) + '・' + (+mon.slice(5, 7)) + ' 月</span></div>'
      + '<p class="psub">' + (x.last ? '最後一次新增報到 ' + md(x.last) + '・' + (x.d ? '已經 <b class="og">' + x.d + ' 天</b>沒有新增' : '今天有新增') : (x.none ? '這個月還沒有報到' : '')) + '</p>'
      + '<div class="pk"><div><b>' + x.v + '</b><span>' + (+mon.slice(5, 7)) + ' 月報到</span></div><div><b>' + x.面談 + '</b><span>面談</span></div><div><b>' + x.註冊 + '</b><span>註冊</span></div><div><b class="' + ((x.none || x.d >= 3) ? 'og' : '') + '">' + esc(dayTxt(x)) + '</b><span>沒有新增報到</span></div></div>';
    if (!D.ck){ return h + '<p class="z">報到明細（誰、哪天、哪個通路）要等擴充 5.73 同步一次報到、再按 🏫 班況之後才會出現。</p>'; }
    h += '<h5>' + (+mon.slice(5, 7)) + ' 月每天的報到<small>深色＝有人報到・橘框＝還沒有新增的日子</small></h5><div class="pcal">' + cal + '</div>'
      + '<h5>已報到的學生<small>' + rows.length + ' 位</small></h5>' + (rows.length ? '<table class="stab"><tr><th class="l">報到日</th><th class="l">學生</th><th class="l">通路</th><th class="l">後來</th></tr>' + rows.map(function(r){ var dd = dOf(r[3]);
        return '<tr><td class="l">' + md(r[3]) + (dd ? '（' + WK[dd.getDay()] + '）' : '') + (r[4] ? ' ' + esc(r[4]) : '') + '</td><td class="l">' + esc(r[2]) + '</td><td class="l">' + esc(r[5] || '—') + '</td><td class="l' + (/註冊/.test(r[6]) ? ' rd' : '') + '">' + esc(r[6] || '') + '</td></tr>'; }).join('') + '</table>' : '<p class="z">這個月還沒有報到。</p>')
      + '<h5>同院比較</h5><table><tr><th class="l">業務</th><th>報到</th><th>最後一次報到</th><th>幾天沒有新增</th></tr>' + same.map(function(p){ return '<tr class="' + (p.k === k ? 'me' : '') + ' clk" data-p="' + esc(p.k) + '"><td class="l nm">' + esc(p.名) + '</td><td>' + p.v + '</td><td>' + (p.last ? md(p.last) : '—') + '</td><td class="' + ((p.none || p.d >= 3) ? 'og' : '') + '">' + esc(dayTxt(p)) + '</td></tr>'; }).join('') + '</table>'
      + (D.ck.完整 ? '' : '<p class="z" style="margin-top:1em">這個月的報到明細還沒抓完整（第一次補抓會在下一次同步報到時完成）。</p>');
    return h;
  }
  function openPerson(k){
    var html = personHtml(k); if (!html) return;
    if (ST.zoom && Z.classList.contains('side')){ Z.querySelector('.zb').innerHTML = html; Z.querySelector('.zb').scrollTop = 0; wrapTables(); return; }
    if (ST.zoom) { Z.classList.remove('on'); Z.innerHTML = ''; }
    Z.className = 'side'; Z.innerHTML = '<div class="zbg"></div><div class="zp" role="dialog" aria-modal="true"><div class="zh"><b>報到明細</b><span>' + esc(ST.org || REGION) + '</span><button type="button" aria-label="關閉">✕</button></div><div class="zb">' + html + '</div></div>';
    ST.zoom = 'person'; Z.__from = null; var p = Z.querySelector('.zp');
    wrapTables(); if (NARROW()) Z.classList.add('sheet');
    requestAnimationFrame(function(){ Z.classList.add('on'); if (NARROW()) return sheetIn(p); if (!REDUCE){ p.style.transform = 'translateX(105%)'; p.getBoundingClientRect(); p.style.transition = 'transform 420ms cubic-bezier(.2,.9,.25,1)'; p.style.transform = 'none'; } });
  }
  function pickerHtml(){
    var lab = ST.view === 'all' ? '三區總覽' : esc(REGION) + (ORGS.length > 1 ? ' <i>›</i> ' + esc(ST.org || '全區') : '');
    return '<div class="bpw"><button class="bpick" type="button" id="bPick" aria-haspopup="true">' + lab + ' <small>▾</small></button><div class="bpop" id="bPop" hidden>'
      + '<div class="pg"><span>區域</span>' + REG.map(function(r){ return '<button type="button" data-reg="' + r[0] + '" class="' + (ST.view !== 'all' && D.r === r[0] ? 'on' : '') + '">' + r[1] + '</button>'; }).join('') + '<button type="button" data-reg="all" class="' + (ST.view === 'all' ? 'on' : '') + '">三區總覽</button></div>'
      + (ORGS.length > 1 && ST.view !== 'all' ? '<div class="pg"><span>我是</span><button type="button" data-org="" class="' + (!ST.org ? 'on' : '') + '">全區</button>' + ORGS.map(function(o){ return '<button type="button" data-org="' + o + '" class="' + (ST.org === o ? 'on' : '') + '">' + o + '</button>'; }).join('') + '</div>' : '')
      + '</div></div>'; }
  function askHtml(){ if (ST.asked || ST.view === 'all' || ORGS.length < 2) return '';
    return '<div class="bask"><div class="bq"><h3>你是哪一院？</h3><p>選了之後，點名、要開的班、走到哪一關都只看那一院；這台電腦會記住，之後可以從右上角換。</p><div class="bqb">'
      + ORGS.map(function(o){ return '<button type="button" data-org="' + o + '">' + o + '</button>'; }).join('') + '<button type="button" data-org="" class="all">全區（' + esc(REGION) + '）</button></div></div></div>'; }
  function regSeg(){ return '<div class="bseg">' + REG.map(function(r){ return '<button type="button" data-reg="' + r[0] + '" class="' + (ST.view !== 'all' && D.r === r[0] ? 'on' : '') + '">' + r[1] + '</button>'; }).join('') + '<button type="button" data-reg="all" class="' + (ST.view === 'all' ? 'on' : '') + '">三區總覽</button></div>'; }
  function subLine(){ var x = []; if (D.dateLabel) x.push(D.dateLabel); if (D.syncAt) x.push('班況 ' + String(D.syncAt).slice(11, 16)); if (I && I.同步) x.push('入帳 ' + md(String(I.同步).slice(0, 10)) + ' ' + String(I.同步).slice(11, 16)); if (RANK && RANK.cur) x.push('報到 ' + RANK.cur); return x.join('・'); }
  function render(){
    if (ST.view === 'all') return renderAll();
    var h = '<div class="btop"><h1>' + esc((ST.org || REGION) + ' ' + MTIME) + '</h1><div class="bs">' + esc(subLine()) + '</div>' + pickerHtml()
      + '<button class="bbtn bfull" type="button" id="bFull">全螢幕</button><button class="bbtn" type="button" id="bExit"><span class="dk">手機版</span><span class="mb">離開</span></button><button class="bchamp" type="button" id="bChamp">🏆 ' + champWin().short + '冠軍</button></div>'
      + '<nav class="bflow">' + SEGS.map(function(s, i){ return '<button type="button" data-seg="' + (i + 1) + '" class="' + (ST.spot === i + 1 ? 'on' : '') + '"><i style="background:' + s[1] + '"></i>' + s[0] + '</button>'; }).join('')
      + '<span class="k">← → 換段落・點任何一格放大・Esc 回總覽</span></nav><div class="bgrid">';
    var NR = { rank: function(){ return rankRows().length; }, fun: function(){ return funRows().length; }, unc: function(){ return uncRows().length; } };   // v1.9 手機：圖的高度跟著列數
    CARDS.forEach(function(c){ h += '<section class="bc' + (c.hot ? ' hot' : '') + '" data-card="' + c.id + '" data-seg="' + c.seg + '" style="grid-area:' + c.id + (NR[c.id] ? ';--n:' + Math.max(1, NR[c.id]()) : '') + '">' + head(c) + (typeof c.body === 'function' ? c.body() : c.body) + '</section>'; });
    B.innerHTML = h + '</div>' + askHtml();
    applySpot(); requestAnimationFrame(drawAll);
  }
  function drawAll(){ if (ST.view === 'all') return drawAllView(); CARDS.forEach(function(c){ var b = B.querySelector('[data-card="' + c.id + '"]'); if (b && c.draw) try { c.draw(b); } catch(e){ console.warn('[會議模式] ' + c.id, e); } }); }
  function applySpot(){ B.querySelectorAll('.bc').forEach(function(x){ x.classList.toggle('dim', !!ST.spot && +x.dataset.seg !== ST.spot); }); B.querySelectorAll('.bflow button').forEach(function(x){ x.classList.toggle('on', +x.dataset.seg === ST.spot); }); }

  /* ── 三區總覽：另外兩區的資料用同一支 API 拿（不讀 EIP） ── */
  var OTHERS = window.__pgBO || (window.__pgBO = {});
  function apiOf(){ return window.PG_API || D.baseUrl || ''; }
  function loadOthers(cb){
    var need = REG.filter(function(r){ return r[0] !== D.r && !OTHERS[r[0]]; }); if (!need.length) return cb();
    var left = need.length; need.forEach(function(r){ fetch(apiOf() + '?r=' + encodeURIComponent(r[0]) + '&fmt=json', { cache: 'no-store' }).then(function(x){ return x.json(); })
      .then(function(j){ if (j && j.r) OTHERS[r[0]] = j; }).catch(function(){}).then(function(){ if (--left === 0) cb(); }); });
  }
  function regionOf(r){ return r === D.r ? D : OTHERS[r]; }
  function openOf(d){ return (d.classes || []).filter(function(c){ return c.type !== '講座' && c.toOpen !== '' && c.toOpen >= 0 && c.toOpen <= 14; }).sort(function(a, b){ return (a.ok - b.ok) || (a.toOpen - b.toOpen); }); }
  function renderAll(){
    var h = '<div class="btop"><h1>三區總覽</h1><div class="bs">' + esc(subLine()) + '</div>' + pickerHtml()
      + '<button class="bbtn bfull" type="button" id="bFull">全螢幕</button><button class="bbtn" type="button" id="bExit"><span class="dk">手機版</span><span class="mb">離開</span></button><button class="bchamp" type="button" id="bChamp">🏆 三區' + champWin().short + '冠軍</button></div>'
      + '<nav class="bflow"><span class="k" style="margin-left:0">點一區進去看那一區的會議模式・點任何一格放大</span></nav><div class="bgrid all">'
      + '<section class="bc" data-card="rank" style="grid-area:rk">' + head(CARDS[0]) + '<svg class="ch"></svg></section>'
      + '<section class="bc" data-card="inc" style="grid-area:inc">' + head(CARDS[7]) + '<svg class="ch"></svg></section>';
    REG.forEach(function(r, i){ h += '<section class="bc rcol" data-go="' + r[0] + '" style="grid-area:r' + i + '"><div class="bh"><i style="background:' + C.ink + '"></i><b>' + r[1] + '</b><span class="x">›</span></div><div class="loading">載入中…</div></section>'; });
    B.innerHTML = h + '</div>';
    requestAnimationFrame(drawAllView);
    loadOthers(function(){ if (ST.view === 'all' && ST.on) fillRegions(); });
    fillRegions();
  }
  function fillRegions(){
    REG.forEach(function(r){ var box = B.querySelector('[data-go="' + r[0] + '"]'), d = regionOf(r[0]); if (!box || !d) return;
      var L = openOf(d), need = L.filter(function(c){ return !c.ok; }), U = (d.asst && d.asst.unc) || [], mx = U.reduce(function(a, x){ return Math.max(a, +x.天 || 0); }, 0);
      var rk = (d.rank && d.rank.rows) || [], sum = rk.reduce(function(a, x){ return a + x.n; }, 0), dif = rk.reduce(function(a, x){ return a + (x.diff || 0); }, 0);
      var ch = champsFor(d.orgs || []), c1 = ch && ch.list[0];
      box.innerHTML = '<div class="bh"><i style="background:' + C.ink + '"></i><b>' + esc(d.label || r[1]) + '</b><span>' + esc((d.orgs || []).join('・')) + '</span><span class="x">›</span></div>'
        + '<div class="big"><div><b>' + sum + '</b><span>報到' + (dif ? '・<em class="' + (dif > 0 ? 'rd' : '') + '" style="font-style:normal">' + (dif > 0 ? '+' : '') + dif + '</em>' : '') + '</span></div><div><b class="' + (need.length ? 'og' : '') + '">' + L.length + '</b><span>14 天內開班' + (need.length ? '・' + need.length + ' 班差人' : '') + '</span></div><div><b class="' + (mx > 14 ? 'og' : '') + '">' + U.length + '</b><span>註冊未消耗' + (mx ? '・最久 ' + mx + ' 天' : '') + '</span></div></div>'
        + '<svg class="ch"></svg>' + (c1 ? '<div class="champ1">🏆 <span>' + esc(ch.win.short) + '冠軍</span><b>' + esc(c1.名) + '</b><span>' + esc(c1.院) + '・' + wan(c1.amt) + '</span></div>' : '');
      box.__open = L; });
    drawRegionBullets();
  }
  function drawRegionBullets(){ B.querySelectorAll('[data-go]').forEach(function(box){ if (box.__open) bullets(box, box.__open); }); }
  function champsFor(orgs){ return champs(orgs); }
  function drawAllView(){ var a = B.querySelector('[data-card="rank"]'), b = B.querySelector('[data-card="inc"]');
    if (a) hbars(a, ((RANK && RANK.all) || []).map(function(x){ return { l: x.院, v: x.n, me: true, tail: x.diff ? (x.diff > 0 ? '+' + x.diff : String(x.diff)) : '', tailC: x.diff > 0 ? C.red : C.l2 }; }), { tail: 1 });
    if (b) incCols(b, { mine: [], ink: 1 });
    drawRegionBullets(); }

  /* ── ⤢ 放大：從那一格長出來 ── */
  var Z = document.getElementById('bzoom');
  function zoomHtml(id){
    var t = '';
    if (id === 'rank'){ var all = (RANK && RANK.all) || [];
      t = '<div class="zg"><div class="zc"><h5>七家報到</h5><svg class="ch" data-z="rank"></svg></div><div class="zc"><h5>名次</h5><table><tr><th>學院</th><th>報到</th><th>比前一天</th><th>全省名次</th></tr>'
        + all.map(function(x){ return '<tr class="' + (ORGS.indexOf(x.院) >= 0 ? 'me' : '') + '"><td>' + x.院 + '</td><td>' + x.n + '</td><td class="' + (x.diff > 0 ? 'rd' : 'z') + '">' + (x.diff == null ? '—' : (x.diff > 0 ? '+' : '') + x.diff) + '</td><td>第 ' + x.rank + '</td></tr>'; }).join('') + '</table></div>'
        + personTable('業務報到', function(s){ return s.報到; }, '報到') + '</div>'; }
    else if (id === 'open'){ var L = (typeof OPEN !== 'undefined' ? OPEN : []);
      t = '<table><tr><th class="l">班</th><th>開班日</th><th>剩幾天</th><th>登記</th><th>門檻</th><th>滿班</th><th>狀態</th></tr>' + L.map(function(c){ return '<tr class="clk" data-id="' + c.cid + '"><td class="l"><span class="nm">' + esc(c.code) + '</span> ' + esc(shortNm(c.name)) + '</td><td>' + esc(c.openMD) + '</td><td>' + (c.toOpen ? c.toOpen + ' 天' : '今天') + '</td><td>' + c.reg + '</td><td>' + (c.th || '—') + '</td><td>' + (c.seat || '—') + '</td><td class="' + (c.ok ? 'rd' : 'og') + '">' + esc(c.ok ? c.stTxt : '差 ' + needN(c) + ' 位') + '</td></tr>'; }).join('') + '</table>'
        + (L.length ? '' : '<p class="z">14 天內沒有要開的班。</p>') + '<p class="z" style="margin-top:1em">點一班看學生名單。</p>'; }
    else if (id === 'lead' || id === 'focus'){ var k = id === 'lead' ? ['🧑', '⚔️'] : ['🎤'];
      var LR = id === 'lead' ? leadRank() : null;
      if (LR && LR.length) t = '<h5 style="margin:0 0 .5em;font-size:1.1em">' + esc(ST.org || REGION) + '・報到排名<small style="color:var(--label2);font-weight:500;margin-left:.6em">點名字看明細</small></h5><table><tr><th>名次</th><th class="l">業務</th>' + (ST.org || ORGS.length < 2 ? '' : '<th>學院</th>') + '<th>報到</th><th>面談</th><th>註冊</th><th>最後一次報到</th><th>幾天沒有新增</th></tr>'
        + LR.map(function(p, i){ return '<tr class="clk" data-p="' + esc(p.k) + '"><td>' + (i + 1) + '</td><td class="l nm">' + esc(p.名) + '</td>' + (ST.org || ORGS.length < 2 ? '' : '<td>' + esc(p.院) + '</td>') + '<td>' + p.v + '</td><td>' + p.面談 + '</td><td>' + p.註冊 + '</td><td>' + (p.last ? md(p.last) : '—') + '</td><td class="' + ((p.none || p.d >= 3) ? 'og' : '') + '">' + esc(dayTxt(p)) + '</td></tr>'; }).join('') + '</table><hr style="border:0;border-top:.5px solid var(--sep);margin:1.2em 0">';
      t += k.map(function(x){ var s = (typeof secText === 'function' ? secText(x) : ''); if (!s) return ''; var L2 = s.split('\\n'); return '<div class="agz"><h5 style="margin:.2em 0 .6em;font-size:1.1em">' + esc(L2[0].replace(/^\\S+\\s*/, '')) + '</h5>' + L2.slice(1).filter(function(l){ return l.trim(); }).map(function(l){ return '<p>' + fmtLine(l) + '</p>'; }).join('') + '</div>'; }).join('<hr style="border:0;border-top:.5px solid var(--sep);margin:1.2em 0">') || '<p class="z">' + esc(D.agNone || '今天議程沒有這一段') + '</p>'; }
    else if (id === 'fun'){ var F = (A && A.fun) || [];
      t = '<div class="zg">' + ORGS.map(function(o){ var f = F.filter(function(x){ return x.院 === o && !x.主管; }).sort(function(a, b){ return b.談過 - a.談過; });
        return '<div class="zc"><h5>' + o + '</h5><table><tr><th>業務</th><th>談過</th><th>報名</th><th>註冊</th><th>排進班</th><th>上過課</th></tr>' + f.map(function(x){ return '<tr><td class="nm">' + esc(short(x.業務)) + '</td><td>' + x.談過 + '</td><td>' + x.報名 + '</td><td>' + x.註冊 + '</td><td class="' + (pjx(x) < x.註冊 ? 'og' : '') + '">' + pjx(x) + '</td><td>' + (x.上過課 == null ? '—' : x.上過課) + '</td></tr>'; }).join('') + '</table></div>'; }).join('') + '</div>'; }
    else if (id === 'unc'){ var R = uncRows();
      t = '<div class="zg">' + R.map(function(r){ return '<div class="zc"><h5>' + r.o + '・' + r.u.length + ' 筆</h5><table><tr><th>承辦</th><th class="l">學生</th><th class="l">課程</th><th>幾天</th></tr>' + r.u.slice().sort(function(a, b){ return (+b.天 || 0) - (+a.天 || 0); }).map(function(x){ return '<tr><td class="nm">' + esc(short(x.承辦)) + '</td><td class="l">' + esc(x.學生) + '</td><td class="l">' + esc(x.課程) + '</td><td class="' + ((+x.天 || 0) > 14 ? 'og' : '') + '">' + x.天 + ' 天</td></tr>'; }).join('') + '</table></div>'; }).join('') + '</div>'; }
    else if (id === 'att'){ var S2 = (typeof SHOW_D !== 'undefined' ? SHOW_D : []);
      t = '<table><tr><th class="l">班</th><th>狀況</th><th>堂</th><th>出席</th><th>應到</th><th>請假</th><th>曠課</th></tr>' + S2.filter(function(c){ return c.type !== '講座'; }).map(function(c){ var f = c.grp === '已開班' ? c.first : c.last;
        return '<tr class="clk" data-id="' + c.cid + '"><td class="l"><span class="nm">' + esc(c.code) + '</span> ' + esc(shortNm(c.name)) + '</td><td>' + esc(c.grp === '結業' ? c.endMD + ' 結業' : c.grp === '已開班' ? '第一堂' : '最近一堂 ' + (c.last && c.last.md || '')) + '</td><td>' + (c.done || '—') + '/' + (c.total || '—') + '</td><td>' + (f && f.應到 ? f.實到 : '—') + '</td><td>' + (f && f.應到 || '—') + '</td><td>' + (f && f.請假 != null ? f.請假 : '—') + '</td><td>' + (f && f.曠課 != null ? f.曠課 : '—') + '</td></tr>'; }).join('') + '</table><p class="z" style="margin-top:1em">點一班看學生名單。</p>'; }
    else if (id === 'inc'){ t = incZoom(); }
    return t;
  }
  function personTable(title, f, lab){
    if (!I) return ''; var ppl = incPeople(ORGS), rows = Object.keys(ppl).filter(function(k){ return !ppl[k].nb && ppl[k].s; }).map(function(k){ return ppl[k]; }).sort(function(a, b){ return f(b.s) - f(a.s); });
    if (!rows.length) return '';
    return '<div class="zc"><h5>' + title + '</h5><table><tr><th>業務</th><th>學院</th><th>' + lab + '</th><th>面談</th><th>註冊</th><th>註冊率</th></tr>' + rows.map(function(p){ return '<tr><td class="nm">' + esc(p.名) + '</td><td>' + p.院 + '</td><td>' + f(p.s) + '</td><td>' + p.s.面談 + '</td><td>' + p.s.註冊 + '</td><td>' + (p.s.面談 ? Math.round(p.s.註冊 / p.s.面談 * 100) + '%' : '—') + '</td></tr>'; }).join('') + '</table></div>';
  }
  function incZoom(){
    if (!I) return '<p class="z">入帳資料等下一次 🏫 班況同步後才會出現。</p>';
    var days = lastDays(3), all = ['壢一', '壢二', '壢三', '台一', '台二', '台三', '建國'], v = {};
    (I.日 || []).forEach(function(r){ var di = days.indexOf(r[1]); if (di < 0) return; (v[r[0]] || (v[r[0]] = [0, 0, 0]))[di] += r[2]; });
    var tot = days.map(function(_, i){ return all.reduce(function(a, o){ return a + ((v[o] || [])[i] || 0); }, 0); });
    var h = '<div class="zg"><div class="zc" style="grid-column:1/-1"><h5>中壢以南・' + md(days[0] || '') + '–' + md(days[days.length - 1] || '') + '</h5><svg class="ch" data-z="inc"></svg></div>'
      + '<div class="zc"><h5>每天、每家入帳</h5><table><tr><th>學院</th>' + days.map(function(d){ return '<th>' + md(d) + '</th>'; }).join('') + '<th>三天合計</th></tr>'
      + all.map(function(o){ var a = v[o] || [0, 0, 0], s = a.reduce(function(x, y){ return x + y; }, 0); return '<tr class="' + (ORGS.indexOf(o) >= 0 ? 'me' : '') + '"><td>' + o + '</td>' + days.map(function(_, i){ return '<td>' + wan(a[i] || 0) + '</td>'; }).join('') + '<td>' + wan(s) + '</td></tr>'; }).join('')
      + '<tr class="sum"><td>七家</td>' + tot.map(function(x){ return '<td>' + wan(x) + '</td>'; }).join('') + '<td>' + wan(tot.reduce(function(a, b){ return a + b; }, 0)) + '</td></tr></table></div>';
    var ppl = incPeople(all), per = {};
    (I.人 || []).forEach(function(r){ var k = r[0] + '|' + r[1]; if (!ppl[k] || ppl[k].nb || days.indexOf(r[2]) < 0) return; per[k] = (per[k] || 0) + r[3]; });
    var top = Object.keys(per).sort(function(a, b){ return per[b] - per[a]; }).slice(0, 15);
    h += '<div class="zc"><h5>三天入帳最多的業務（七家）</h5><table><tr><th>名次</th><th>業務</th><th>學院</th><th>三天入帳</th></tr>' + top.map(function(k, i){ var p = ppl[k]; return '<tr class="' + (ORGS.indexOf(p.院) >= 0 ? 'me' : '') + '"><td>' + (i + 1) + '</td><td class="nm">' + esc(p.名) + '</td><td>' + p.院 + '</td><td>' + wan(per[k]) + '</td></tr>'; }).join('') + '</table></div></div>'
      + '<p class="z" style="margin-top:1em">金額是收支明細的「業績合計」（報名＋註冊；合談 EIP 已經拆成兩位各一半）。入帳資料 ' + esc(I.同步 || '') + '。</p>';
    return h;
  }
  function openZoom(card){
    var id = card.dataset.card, c = CARDS.filter(function(x){ return x.id === id; })[0]; if (!c) return;
    Z.innerHTML = '<div class="zbg"></div><div class="zp" role="dialog" aria-modal="true"><div class="zh"><b>' + esc(c.t()) + '</b><span>' + esc(c.s()) + '</span><button type="button" aria-label="關閉">✕</button></div><div class="zb pre">' + zoomHtml(id) + '</div></div>';
    var p = Z.querySelector('.zp'), r0 = card.getBoundingClientRect(), r1 = p.getBoundingClientRect();
    Z.classList.add('on'); ST.zoom = id; Z.__from = card;
    var zr = Z.querySelector('[data-z="rank"]'); if (zr) hbars(zr.parentNode, ST.view === 'all' ? ((RANK && RANK.all) || []).map(function(x){ return { l: x.院, v: x.n, me: true }; }) : rankRows(), { tail: 1 });
    var zi = Z.querySelector('[data-z="inc"]'); if (zi) incCols(zi.parentNode, ST.view === 'all' ? { mine: [], ink: 1 } : {});
    wrapTables();
    if (REDUCE || NARROW()){ Z.querySelector('.zb').classList.remove('pre'); if (NARROW()) { Z.classList.add('sheet'); sheetIn(p); } return; }
    p.style.transform = 'translate(' + (r0.left - r1.left) + 'px,' + (r0.top - r1.top) + 'px) scale(' + (r0.width / r1.width) + ',' + (r0.height / r1.height) + ')';
    p.getBoundingClientRect();
    p.style.transition = 'transform 420ms cubic-bezier(.2,.9,.25,1)'; p.style.transform = 'none';
    setTimeout(function(){ var zb = Z.querySelector('.zb'); if (zb) zb.classList.remove('pre'); }, 200);
  }
  function closeZoom(){
    if (!ST.zoom) return; ST.zoom = ''; var p = Z.querySelector('.zp'), card = Z.__from;
    var done = function(){ Z.classList.remove('on'); Z.classList.remove('side'); Z.classList.remove('sheet'); Z.innerHTML = ''; };
    if (Z.classList.contains('sheet') && p && !REDUCE){ Z.classList.remove('on'); p.style.transition = 'transform 300ms cubic-bezier(.2,.9,.25,1)'; p.style.transform = 'translateY(105%)'; setTimeout(done, 280); return; }
    if (Z.classList.contains('side') && p && !REDUCE){ Z.classList.remove('on'); p.style.transition = 'transform 320ms cubic-bezier(.2,.9,.25,1)'; p.style.transform = 'translateX(105%)'; setTimeout(done, 300); return; }
    if (REDUCE || !p || !card || !document.body.contains(card)){ done(); return; }
    var r0 = card.getBoundingClientRect(), r1 = p.getBoundingClientRect(); Z.querySelector('.zb').classList.add('pre'); Z.classList.remove('on');
    p.style.transition = 'transform 360ms cubic-bezier(.2,.9,.25,1)';
    p.style.transform = 'translate(' + (r0.left - r1.left) + 'px,' + (r0.top - r1.top) + 'px) scale(' + (r0.width / r1.width) + ',' + (r0.height / r1.height) + ')';
    setTimeout(done, 340);
  }

  /* ── 🏆 昨天冠軍 ── */
  var CH = document.getElementById('champ'), FX = ['flip', 'slot', 'spot', 'conf', 'glass', 'sweep'], fxStop = null;
  function pickFx(){ var last = -1; try { last = +(localStorage.getItem('pg1340_fx') || -1); } catch(e){ last = ST.fx; }
    var i = Math.floor(Math.random() * FX.length); if (i === last) i = (i + 1 + Math.floor(Math.random() * (FX.length - 1))) % FX.length;
    ST.fx = i; try { localStorage.setItem('pg1340_fx', String(i)); } catch(e){} return FX[i]; }
  function pct(x){ return x == null ? '—' : Math.round(x * 100) + '%'; }
  function chipsOf(p){ var s = p.studs.slice(0, 3).map(function(x){ return '<span>' + esc(x.ch === '學員加購' ? '舊生加購' : x.ch) + '・' + esc(clip(x.cs[0], 12)) + (x.cs.length > 1 ? '＋' + (x.cs.length - 1) + ' 科' : '') + '<b>' + wan(x.v) + '</b></span>'; }).join('');
    return s + (p.studs.length > 3 ? '<span>還有 ' + (p.studs.length - 3) + ' 位學生</span>' : ''); }
  function oneCard(p, regionLabel){
    return '<div class="one rv" data-rk="1"><span class="rk1">🏆 ' + (regionLabel ? esc(regionLabel) + ' ' : '') + '第 1 名</span><div class="nm1 sw">' + esc(p.名) + '</div><div class="org">' + esc(p.院) + '・入帳 ' + p.n + ' 筆</div>'
      + '<div class="amt">NT$ <span class="num" data-v="' + Math.round(p.amt) + '">' + Math.round(p.amt).toLocaleString() + '</span><small>' + esc(champWin().short) + '入帳</small></div>'
      + '<div class="chips">' + chipsOf(p) + '</div><div class="stats">'
      + '<div class="st"><div class="v">' + wan(p.mtd) + '</div><div class="l">' + (+String(I.月).split('/')[1]) + ' 月累計入帳</div><div class="c">區內第 ' + p.mtdRank + '</div></div>'
      + '<div class="st"><div class="v">' + (p.報到 == null ? '—' : p.報到) + '</div><div class="l">' + (+String(I.月).split('/')[1]) + ' 月報到</div><div class="c">' + esc(p.院) + '</div></div>'
      + '<div class="st"><div class="v">' + pct(p.rate) + '</div><div class="l">註冊率（面談 ' + (p.面談 || 0) + '）</div><div class="c">區平均 ' + pct(p.regRate) + '</div></div>'
      + '<div class="st"><div class="v">' + p.streak + ' 天</div><div class="l">連續有入帳</div><div class="c">算到' + esc(champWin().short) + '</div></div></div>'
      + (p.quote ? '<div class="quote">「' + esc(p.quote) + '」</div>' : '') + '</div>';
  }
  function twoCard(p, i){
    var bits = ['賣 <b>' + p.courses.slice(0, 2).map(function(c){ return esc(clip(c, 10)); }).join('</b>、<b>') + '</b>'];
    if (p.報到 != null) bits.push((+String(I.月).split('/')[1]) + ' 月報到 <b>' + p.報到 + '</b>');
    if (p.rate != null) bits.push('註冊率 <b>' + pct(p.rate) + '</b>'); else if (p.streak > 1) bits.push('連續 <b>' + p.streak + ' 天</b>有入帳');
    return '<div class="two rv ' + (i === 1 ? 's' : 'b') + '" data-rk="' + (i + 1) + '"><div class="rk">' + (i + 1) + '</div><div class="nm sw">' + esc(p.名) + '<small>' + esc(p.院) + '</small></div><div class="a">NT$ <span class="num" data-v="' + Math.round(p.amt) + '">' + Math.round(p.amt).toLocaleString() + '</span><small>' + p.n + ' 筆</small></div><div class="t">' + bits.join('・') + '</div></div>';
  }
  function openChamp(force){
    var fx = REDUCE ? 'fade' : (force || pickFx()), w = champWin(), h;
    if (!I){ h = '<div class="stg"><div class="hd"><h1>' + esc(w.short) + '入帳冠軍</h1><span class="x"><button type="button" data-a="close">關閉<span class="dk"> Esc</span></button></span></div><div class="empty">入帳資料要等下一次「🏫 班況」同步後才會出現。</div></div>'; fx = 'fade'; }
    else if (ST.view === 'all'){
      var cols = REG.map(function(r){ var d = regionOf(r[0]); var c = champs(d ? d.orgs : (r[0] === '建國' ? ['建國'] : r[0] === '桃區' ? ['壢一', '壢二', '壢三'] : ['台一', '台二', '台三'])); return { lab: r[1], p: c && c.list[0] }; });
      h = '<div class="stg tri"><div class="hd"><h1>三區・' + esc(w.short) + '入帳冠軍</h1><span>' + esc(w.label) + '</span><span class="x"><button type="button" data-a="again">再播一次</button><button type="button" data-a="close">關閉<span class="dk"> Esc</span></button></span></div>'
        + cols.map(function(c){ return c.p ? oneCard(c.p, c.lab) : '<div class="one rv"><span class="rk1">' + esc(c.lab) + '</span><div class="empty" style="font-size:1.2em;margin:auto">' + esc(w.short) + '沒有入帳</div></div>'; }).join('') + '</div>';
    } else {
      var ch = champs(ORGS);
      h = '<div class="stg"><div class="hd"><h1>' + esc(REGION) + '・' + esc(w.short) + '入帳冠軍</h1><span>' + esc(w.label) + '・' + esc(ORGS.join(' ')) + ' 業務</span><span class="x"><button type="button" data-a="again">再播一次</button><button type="button" data-a="close">關閉<span class="dk"> Esc</span></button></span></div>'
        + (ch && ch.list.length ? oneCard(ch.list[0]) + '<div class="right">' + (ch.list[1] ? twoCard(ch.list[1], 1) : '<div></div>') + (ch.list[2] ? twoCard(ch.list[2], 2) : '<div></div>') + '</div>'
          : '<div class="empty">' + esc(w.label) + ' 沒有入帳。</div>') + '</div>';
    }
    CH.className = 'on e-' + fx; CH.innerHTML = h + '<canvas></canvas><div class="fx"></div>' + (fx === 'spot' ? '<div class="spot"></div>' : '');
    document.body.classList.add('bmode');
    play(fx);
  }
  function closeChamp(){ if (fxStop) fxStop(); fxStop = null; CH.className = ''; CH.innerHTML = ''; }
  function skip(){ if (!CH.classList.contains('on') || CH.classList.contains('done')) return false; if (fxStop) fxStop(); CH.classList.add('done'); CH.querySelectorAll('.rv').forEach(function(x){ x.classList.add('in', 'lit'); });
    CH.querySelectorAll('.num').forEach(function(n){ n.textContent = (+n.dataset.v).toLocaleString(); }); CH.querySelectorAll('.sw').forEach(function(x){ x.style.removeProperty('--p'); }); return true; }
  function play(fx){
    var cards = [].slice.call(CH.querySelectorAll('.rv')).sort(function(a, b){ return (+b.dataset.rk || 0) - (+a.dataset.rk || 0); });   // 第三名先、冠軍最後
    var timers = [], raf = 0, stopped = false, cv = CH.querySelector('canvas'), parts = [];
    fxStop = function(){ stopped = true; timers.forEach(clearTimeout); cancelAnimationFrame(raf); parts = []; var x = cv && cv.getContext('2d'); if (x) x.clearRect(0, 0, cv.width, cv.height); };
    var T = function(f, ms){ timers.push(setTimeout(function(){ if (!stopped) f(); }, ms)); };
    var first = cards[cards.length - 1], gap = cards.length > 1 ? 480 : 0, tLast = (cards.length - 1) * gap + 250;
    function show(c){ c.classList.add('in'); }
    function lit(c){ c.classList.add('lit'); }
    function roll(c, ms){ var n = c.querySelector('.num'); if (!n) return; var v = +n.dataset.v, t0 = performance.now();
      (function f(){ if (stopped) return; var k = Math.min(1, (performance.now() - t0) / ms); n.textContent = (k < 1 ? Math.floor(v * (0.2 + 0.8 * k) + Math.random() * v * (1 - k) * .3) : v).toLocaleString(); if (k < 1) raf = requestAnimationFrame(f); else lit(c); })(); }
    function canvasLoop(){ var x = cv.getContext('2d'), dpr = window.devicePixelRatio || 1; cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr; x.scale(dpr, dpr);
      (function f(){ if (stopped) return; x.clearRect(0, 0, cv.clientWidth, cv.clientHeight); parts = parts.filter(function(p){ return p.life > 0; });
        parts.forEach(function(p){ p.vy += p.g; p.vx *= .992; p.vy *= .992; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life--; x.save(); x.globalAlpha = Math.max(0, Math.min(1, p.life / 40)); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c;
          if (p.dot){ x.beginPath(); x.arc(0, 0, p.s, 0, 7); x.fill(); } else x.fillRect(-p.s / 2, -p.s, p.s, p.s * 2); x.restore(); });
        if (parts.length) raf = requestAnimationFrame(f); })(); }
    function burst(c, n, dot){ var r = dot ? null : c.getBoundingClientRect(), cols = ['#FFD15C', '#FFF1B8', '#FF8D00', '#FFFFFF', '#E0172D', '#FFC23D'];
      for (var i = 0; i < n; i++){ var a = dot ? Math.random() * Math.PI * 2 : -Math.PI / 2 + (Math.random() - .5) * 2.2, sp = dot ? 2 + Math.random() * 5 : 6 + Math.random() * 9;
        parts.push({ x: dot ? c.x : r.left + r.width * (.2 + Math.random() * .6), y: dot ? c.y : r.top + r.height * .25, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: dot ? .06 : .22, r: Math.random() * 6, vr: (Math.random() - .5) * .3, s: dot ? 2 + Math.random() * 2 : 5 + Math.random() * 6, c: cols[i % cols.length], life: dot ? 70 + Math.random() * 30 : 120 + Math.random() * 60, dot: dot }); }
      if (parts.length === n) canvasLoop(); }
    if (fx === 'fade'){ cards.forEach(show); CH.classList.add('done'); return; }
    if (fx === 'flip' || fx === 'conf'){ cards.forEach(function(c, i){ T(function(){ show(c); }, 120 + i * gap); }); if (fx === 'conf') T(function(){ burst(first, 180); }, tLast + 200); T(function(){ CH.classList.add('done'); }, tLast + 2600); }
    else if (fx === 'slot'){ cards.forEach(function(c, i){ T(function(){ show(c); roll(c, c === first ? 1500 : 700); }, 120 + i * gap); }); T(function(){ CH.classList.add('done'); }, tLast + 1900); }
    else if (fx === 'glass'){ var fxl = CH.querySelector('.fx'), r = first.getBoundingClientRect(), W = innerWidth, H = innerHeight;
      cards.forEach(function(c, i){ if (c !== first) T(function(){ show(c); }, 100 + i * 300); });
      for (var i = 0; i < 9; i++){ var sz = 60 + Math.random() * 140, b = document.createElement('div'); b.className = 'gb'; b.style.width = b.style.height = sz + 'px';
        var sx = Math.random() * W, sy = Math.random() * H, tx = r.left + Math.random() * (r.width - sz), ty = r.top + Math.random() * (r.height - sz);
        b.style.left = tx + 'px'; b.style.top = ty + 'px'; b.style.transform = 'translate(' + (sx - tx) + 'px,' + (sy - ty) + 'px) scale(.6)'; fxl.appendChild(b);
        (function(b){ T(function(){ b.style.transform = 'none'; b.style.opacity = '0'; }, 120); })(b); }
      T(function(){ show(first); }, 650); T(function(){ CH.classList.add('done'); fxl.innerHTML = ''; }, 2600); }
    else if (fx === 'sweep'){ cards.forEach(function(c, i){ T(function(){ show(c); var sw = c.querySelector('.sw'), t0 = performance.now(), ms = c === first ? 1100 : 600;
        (function f(){ if (stopped) return; var k = Math.min(1, (performance.now() - t0) / ms); sw.style.setProperty('--p', (k * 110 - 10) + '%'); if (k < 1) requestAnimationFrame(f); else sw.style.removeProperty('--p'); })(); }, 120 + i * gap); });
      T(function(){ var r = first.getBoundingClientRect(); [[.3, .3], [.7, .2], [.5, .45]].forEach(function(q, i){ T(function(){ burst({ x: r.left + r.width * q[0], y: r.top + r.height * q[1] }, 70, true); }, i * 260); }); }, tLast + 900);
      T(function(){ CH.classList.add('done'); }, tLast + 2800); }
    else if (fx === 'spot'){ var sp = CH.querySelector('.spot'), r2 = first.getBoundingClientRect(), W2 = innerWidth, H2 = innerHeight, path = [[.08, .25], [.9, .3], [.75, .8], [.2, .75]], t0 = performance.now(), ms = 1500;
      var ex = (r2.left + r2.width / 2) / W2, ey = (r2.top + r2.height * .35) / H2; path.push([ex, ey]);
      cards.forEach(show);
      (function f(){ if (stopped) return; var k = Math.min(1, (performance.now() - t0) / ms), e = 1 - Math.pow(1 - k, 3), seg = e * (path.length - 1), i = Math.min(path.length - 2, Math.floor(seg)), u = seg - i;
        sp.style.setProperty('--x', ((path[i][0] + (path[i + 1][0] - path[i][0]) * u) * 100) + '%'); sp.style.setProperty('--y', ((path[i][1] + (path[i + 1][1] - path[i][1]) * u) * 100) + '%');
        if (k < 1) raf = requestAnimationFrame(f); else T(function(){ sp.style.opacity = '0'; burst(first, 120); }, 500); })();
      T(function(){ CH.classList.add('done'); }, 3600); }
  }

  /* ── 開關 ── */
  function enter(view){ ST.on = true; ST.view = view || ST.view || 'one'; B.classList.add('on'); document.body.classList.add('bmode'); setUrl(ST.view === 'all' ? 'all' : 'board'); render(); }
  function leave(){ ST.on = false; closeZoom(); B.classList.remove('on'); document.body.classList.remove('bmode'); setUrl(''); B.innerHTML = ''; try { if (document.fullscreenElement) document.exitFullscreen(); } catch(e){} }
  B.onclick = function(e){
    var t = e.target, pop = B.querySelector('#bPop');
    if (t.closest('#bPick')){ if (pop) pop.hidden = !pop.hidden; return; }
    if (pop && !pop.hidden && !t.closest('#bPop')) pop.hidden = true;
    var og = t.closest('[data-org]'); if (og){ setOrg(og.dataset.org || ''); render(); return; }
    var cm = t.closest('[data-cmp]'); if (cm){ ST.cmp[cm.dataset.cmp] = cm.dataset.v; lsSet(CMP_KEY, JSON.stringify(ST.cmp)); render(); return; }
    var pp = t.closest('[data-p]'); if (pp){ openPerson(pp.dataset.p); return; }
    var cls = t.closest('[data-id]'); if (cls && typeof byId !== 'undefined' && byId[cls.getAttribute('data-id')] && typeof openSheet === 'function'){ e.stopPropagation(); openSheet(byId[cls.getAttribute('data-id')]); return; }
    var rg = t.closest('[data-reg]'); if (rg){ var r = rg.dataset.reg; if (r === 'all'){ ST.view = 'all'; setUrl('all'); render(); } else if (r === D.r){ ST.view = 'one'; setUrl('board'); render(); } else go(baseUrl() + '?r=' + encodeURIComponent(r) + '&v=board'); return; }
    var sg = t.closest('[data-seg]'); if (sg && sg.tagName === 'BUTTON'){ var n = +sg.dataset.seg; ST.spot = ST.spot === n ? 0 : n; applySpot();
      if (NARROW() && ST.spot){ var tg = B.querySelector('.bc[data-seg="' + n + '"]'), fl = B.querySelector('.bflow'); if (tg) B.scrollTo({ top: Math.max(0, tg.offsetTop - (fl ? fl.offsetHeight : 0) - 10), behavior: REDUCE ? 'auto' : 'smooth' }); }
      return; }
    if (t.closest('#bExit')) return leave();
    if (t.closest('#bChamp')) return openChamp();
    if (t.closest('#bFull')){ try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch(err){} return; }
    var gg = t.closest('[data-go]'); if (gg){ var r2 = gg.dataset.go; if (r2 === D.r){ ST.view = 'one'; setUrl('board'); render(); } else go(baseUrl() + '?r=' + encodeURIComponent(r2) + '&v=board'); return; }
    var card = t.closest('.bc[data-card]'); if (card) openZoom(card);
  };
  if (Z) Z.onpointerdown = function(e){   // v1.9 手機：從面板頂端往下拉就關
    if (!Z.classList.contains('sheet') || !e.target.closest('.zh') || e.target.closest('button')) return;
    var p = Z.querySelector('.zp'), y0 = e.clientY, t0 = performance.now(), dy = 0; p.style.transition = 'none';
    var mv = function(ev){ dy = Math.max(0, ev.clientY - y0); p.style.transform = 'translateY(' + dy + 'px)'; };
    var up = function(ev){ document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); var v = dy / Math.max(1, performance.now() - t0);
      if (dy > 120 || v > .6) closeZoom(); else { p.style.transition = 'transform 320ms cubic-bezier(.2,.9,.25,1)'; p.style.transform = 'none'; } };
    document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
  };
  if (Z) Z.onclick = function(e){ var pr = e.target.closest('[data-p]'); if (pr){ openPerson(pr.dataset.p); return; } var row = e.target.closest('[data-id]'); if (row && typeof byId !== 'undefined' && byId[row.dataset.id]){ openSheet(byId[row.dataset.id]); return; } if (e.target.closest('.zh button') || e.target.classList.contains('zbg')) closeZoom(); };
  if (CH) CH.onclick = function(e){ var a = e.target.closest('[data-a]'); if (a){ if (a.dataset.a === 'close') closeChamp(); else { closeChamp(); openChamp(); } return; } skip(); };
  window.__pgB = {
    key: function(e){
      if (CH && CH.classList.contains('on')){ if (e.key === 'Escape') closeChamp(); else skip(); e.preventDefault(); return; }
      if (!ST.on) return;
      if (document.getElementById('sheet') && document.getElementById('sheet').classList.contains('on')) return;
      if (e.key === 'Escape'){ if (ST.zoom) closeZoom(); else if (ST.spot){ ST.spot = 0; applySpot(); } return; }
      if (ST.view === 'all' || ST.zoom) return;
      if (e.key === 'ArrowRight'){ ST.spot = (ST.spot + 1) % 6; applySpot(); e.preventDefault(); }
      else if (e.key === 'ArrowLeft'){ ST.spot = (ST.spot + 5) % 6; applySpot(); e.preventDefault(); }
    },
    champ: function(fx){ openChamp(fx); },
    resize: function(){ if (ST.on && !ST.zoom) { if (ST.view === 'all') drawAllView(); else drawAll(); } }
  };
  if (!window.__pgBBound){ window.__pgBBound = true; var rt = 0;
    document.addEventListener('keydown', function(e){ window.__pgB && window.__pgB.key(e); });
    window.addEventListener('resize', function(){ clearTimeout(rt); rt = setTimeout(function(){ window.__pgB && window.__pgB.resize(); }, 120); }); }
  var bb = document.getElementById('boardBtn'); if (bb) bb.onclick = function(){ enter('one'); };
  var v0 = new URLSearchParams(location.search).get('v');
  if (ST.on || v0 === 'board' || v0 === 'all') enter(ST.on ? ST.view : (v0 === 'all' ? 'all' : 'one'));
})();
</script>
`;

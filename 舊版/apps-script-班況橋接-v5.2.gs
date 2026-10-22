/**
 * 業績數據橋接 v5.2｜2026-10-22｜13:40 網頁加速（資料先算好放快取）
 * 版本史：v3（10/21）加 🏫 班況｜v4（10/21）多寫出席細查、助理數據；班況快報拿掉「開班超過 3 天」段｜v4.1（10/21）修：註冊未消耗那幾列少一格，整張表寫到一半就停｜v5（10/21）doGet 帶 ?r= 就出網頁（程式在「網頁」檔），送班況時多存一份當天網頁資料（留 30 天）｜v5.1（10/22）EIP出席多一欄登記人員；新分頁「離職名單」，名單上的人網頁、助理數據都不列｜v5.2（10/22）送班況後先把兩區網頁資料算好放快取；送業績快照後只換快取裡的報到排名
 *
 * 做什麼：
 *   業績數據中心按「🏫 班況」（或 ⚡ 全部同步的第 6 段）之後，把三區每一班的數字送過來，這支程式：
 *   ① 整份覆寫快照表的「EIP班況」分頁（一班一列，給你看）
 *   ② 覆寫 Drive「13:40 日會議程」資料夾裡的「EIP班況_最新.csv」（給 9:30 日會議程排程讀）
 *   ③ 在「LINE 推播」資料夾建「LINE班況 YYYY-MM-DD.txt」（一天只建一次，n8n 看到就推到你的 LINE）
 *   ④ v4：覆寫「EIP出席」分頁（中區＋建國，一位學生一列：承辦、累計出席、請假、曠課、最近一堂、達標）
 *   ⑤ v4：覆寫「助理數據」分頁（註冊未消耗名單＋每位業務 談過／報名／註冊／進班上課＋三家合計）
 *      週五那天另存一份到「註冊未消耗_週存檔」分頁，下週用來算「本週處理掉幾筆」
 *   原本的業績快照（數據、業務分頁）照舊，交給 doPostSnapshot_ 處理。
 *
 * v3 → v4 更新：把「班況橋接」這個檔案整份換成這一份（全選 → 貼上 → 儲存），
 *   再「部署」→「管理部署作業」→ 鉛筆 →「版本」選「建立新版本」→「部署」。網址不變。
 *   瀏覽器打開部署網址看到 {"v":4} 就是新版。
 *
 * 安裝（只要做一次）：
 *   1. 打開 Apps Script「業績數據橋接」，在原本那個檔案裡：
 *        function doPost(e)  → 改名成 function doPostSnapshot_(e)
 *        function doGet(e)   → 改名成 function doGetOld_(e)
 *   2. 左邊「檔案」旁邊的 ＋ → 指令碼，取名「班況橋接」，把這整份貼進去，按儲存。
 *   3. 右上「部署」→「管理部署作業」→ 鉛筆 →「版本」選「新版本」→「部署」。網址不會變。
 *      第一次會跳出授權（要寫 Drive），按「進階」→「前往」→「允許」。
 *   4. 驗證：瀏覽器打開部署網址，看到 {"v":3} 就是新版了。
 */

var BK_SHEET_ID = '1DPPblU4oNtT3LLG276kLBilz2cExtDAS4ZLFH6JP7Rg';   // 業績數據每日快照（自動寫入）
var BK_TAB = 'EIP班況';
var BK_CSV_FOLDER = '1GJXP1VWf1JfDpcOYgLhgLIBMA0hUsLji';            // 13:40 日會議程
var BK_CSV_NAME = 'EIP班況_最新.csv';
var BK_LINE_FOLDER = '1iZ9Sj683ZG_Fw6cS7o195BEX8lwREHZT';           // LINE 推播（n8n 監看）
var BK_TZ = 'Asia/Taipei';
var BK_BRIEF_REGIONS = ['中區', '南區'];                              // 桃竹區等中區、高雄跑順再加
var BK_ATT_TAB = 'EIP出席';
var BK_ASST_TAB = '助理數據';
var BK_WEEK_TAB = '註冊未消耗_週存檔';

function doGet(e) {
  if (e && e.parameter && e.parameter.r) return pgDoGet_(e);   // v5：13:40 網頁（「網頁」檔）
  return bkJson_({ v: 5.2 });
}

function doPost(e) {
  var body = null;
  try { body = JSON.parse(e.postData.contents); } catch (err) {}
  if (body && body.kind === '班況') {
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try { return bkJson_(bkHandle_(body)); }
    catch (err) { return bkJson_({ ok: false, error: String(err && err.message || err) }); }
    finally { lock.releaseLock(); }
  }
  var out = doPostSnapshot_(e);   // 原本的業績快照
  try { pgRefreshRank_(); } catch (err) {}   // v5.2：網頁快取裡的報到排名跟著換
  return out;
}

function bkJson_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function bkHandle_(body) {
  var rows = body.rows || [];
  if (!rows.length) return { ok: false, error: '沒有收到任何一班' };
  var todayS = Utilities.formatDate(new Date(), BK_TZ, 'yyyy/MM/dd');
  var at = body.at || Utilities.formatDate(new Date(), BK_TZ, 'yyyy/M/d HH:mm');
  var table = bkTable_(rows, todayS, at);

  // ① 分頁
  var ss = SpreadsheetApp.openById(BK_SHEET_ID);
  var sh = ss.getSheetByName(BK_TAB) || ss.insertSheet(BK_TAB);
  sh.clearContents();
  sh.getRange(1, 1, table.length, table[0].length).setNumberFormat('@').setValues(table);
  sh.setFrozenRows(1);

  // ② CSV
  var csv = table.map(function (r) {
    return r.map(function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',');
  }).join('\n');
  var folder = DriveApp.getFolderById(BK_CSV_FOLDER), it = folder.getFilesByName(BK_CSV_NAME);
  if (it.hasNext()) it.next().setContent(csv); else folder.createFile(BK_CSV_NAME, csv, MimeType.CSV);

  // ③ 班況快報（一天一則）
  var brief = 'exists', name = 'LINE班況 ' + todayS.replace(/\//g, '-') + '.txt';
  var lf = DriveApp.getFolderById(BK_LINE_FOLDER);
  if (!lf.getFilesByName(name).hasNext()) {
    lf.createFile(name, bkBrief_(rows, todayS, at), MimeType.PLAIN_TEXT);
    brief = 'new';
  }
  // ④ EIP出席（出席細查）
  var att = bkAttTable_(rows, at), nAtt = att.length - 1;
  bkWrite_(ss, BK_ATT_TAB, att);

  // ⑤ 助理數據
  var nUnc = null, asstRes = null;
  if (body.asst) {
    var wk = ss.getSheetByName(BK_WEEK_TAB) || ss.insertSheet(BK_WEEK_TAB);
    var arch = wk.getLastRow() > 1 ? wk.getRange(2, 1, wk.getLastRow() - 1, 4).getDisplayValues() : [];
    var left = bkLeft_(ss);   // v5.1：離職的人不列進「走到哪一關」
    body.asst.走到哪一關 = (body.asst.走到哪一關 || []).filter(function (f) { return !bkIsLeft_(left, f.業務); });
    var res = bkAsst_(body.asst, todayS, arch, at); asstRes = res;
    bkWrite_(ss, BK_ASST_TAB, res.table);
    nUnc = (body.asst.註冊未消耗 || []).length;
    if (res.newArch) {   // 週五：存一份（同一天重跑就覆蓋），只留 60 天
      var all = [['存檔日', '院', '學生', '課程']].concat(res.newArch);
      wk.clearContents();
      wk.getRange(1, 1, all.length, 4).setNumberFormat('@').setValues(all);
      wk.setFrozenRows(1);
    }
  }
  // ⑥ v5：網頁資料（當天一份，留 30 天）
  var web = 'ok';
  try { pgSaveSnap_(body, asstRes, todayS); } catch (err) { web = String(err && err.message || err); }
  try { pgWarm_(); } catch (err) { web += '｜快取 ' + String(err && err.message || err); }   // v5.2：網頁資料先算好
  return { ok: true, rows: table.length - 1, brief: brief, att: nAtt, unc: nUnc, web: web };
}

// v5.1：離職名單（Ivan 自己可以在分頁加人；姓名寫全名或名字都可以）
var BK_LEFT_TAB = '離職名單';
function bkLeft_(ss) {
  var sh = ss.getSheetByName(BK_LEFT_TAB);
  if (!sh) {
    sh = ss.insertSheet(BK_LEFT_TAB);
    sh.getRange(1, 1, 2, 4).setValues([['姓名', '學院', '離職日', '備註'], ['張瑋庭', '台二', '', '10/21 柏翰說已離職，網頁、議程都不要再出現']]);
    sh.setFrozenRows(1);
  }
  var n = sh.getLastRow(); if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, 1).getDisplayValues().map(function (r) { return String(r[0]).trim(); }).filter(String);
}
function bkIsLeft_(left, name) { name = String(name || ''); if (!name) return false; return left.some(function (x) { return x === name || (x.length >= 2 && (name.slice(-x.length) === x || x.slice(-name.length) === name && name.length >= 2)); }); }

function bkWrite_(ss, name, table) {
  var w = table[0].length;   // v4.1：每一列補齊（或切齊）到表頭的欄數，少一格不會再整張寫一半就停
  table = table.map(function (r) { r = r.slice(0, w); while (r.length < w) r.push(''); return r; });
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clearContents();
  sh.getRange(1, 1, table.length, table[0].length).setNumberFormat('@').setValues(table);
  sh.setFrozenRows(1);
}

/* ───────── 以下是純計算（不碰 Google 服務） ───────── */

var BK_REGION_ORDER = { '中區': 0, '南區': 1, '桃竹區': 2 };
var BK_WEEK = ['日', '一', '二', '三', '四', '五', '六'];

function bkDay_(s) {   // 'YYYY/MM/DD' → 天數（用 UTC 算，不受時區影響）
  var m = String(s || '').match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null;
}
function bkMD_(s) { var m = String(s || '').match(/\d{4}\/(\d{1,2})\/(\d{1,2})/); return m ? (+m[1]) + '/' + (+m[2]) : ''; }
function bkWk_(s) { var n = bkDay_(s); return n == null ? '' : BK_WEEK[(n + 4) % 7]; }   // 1970/1/1 是週四
function bkCode_(r) { var m = String(r.開班日 || '').match(/\d{4}\/(\d{2})\/(\d{2})/); return r.院 + (m ? m[1] + m[2] : ''); }
function bkPct_(a, b) { return b ? Math.round(a / b * 100) : ''; }

// 每一班算出：門檻、狀態、階段、剩幾天、第幾天、未到率
function bkCalc_(r, todayS) {
  var t = bkDay_(todayS), od = bkDay_(r.開班日), ed = bkDay_(r.結業日);
  var seat = +r.座位 || 0, reg = +r.正取 || 0, th = Math.ceil(seat * 2 / 3);
  var st;
  if (r.類型 === '講座') st = '報名 ' + reg;
  else if (!seat) st = '座位待填';
  else if (reg >= seat) st = '✅ 已滿班' + (+r.備取 ? '，備取 ' + r.備取 + ' 位' : '');
  else if (reg >= th) st = '✅ 還可登 ' + (seat - reg) + ' 位';
  else st = '💔 差 ' + (th - reg) + ' 位開班';
  var phase = r.類型 === '講座' ? '講座' : (od > t ? '還沒開班' : (ed != null && ed < t ? '已結業' : '已開班'));
  var f = r.第一堂 || null, l = r.最近一堂 || null;
  return {
    code: bkCode_(r), th: r.類型 === '講座' ? '' : th, st: st, phase: phase,
    icon: /^(✅|💔)/.test(st) ? st.match(/^(✅|💔)/)[1] : '', stTxt: st.replace(/^(✅|💔)\s*/, ''),
    toOpen: od == null ? '' : od - t, toEnd: ed == null ? '' : ed - t, dayN: od == null ? '' : t - od + 1,
    f: f, fAbs: f && f.應到 ? f.應到 - f.實到 : '', fRate: f && f.應到 && f.實到 ? bkPct_(f.應到 - f.實到, f.應到) : '',
    l: l, lRate: l && l.應到 && l.實到 ? bkPct_(l.應到 - l.實到, l.應到) : ''
  };
}

function bkTable_(rows, todayS, at) {
  var head = ['區', '院', '班別', '班名', '類型', '開班日', '結業日', '階段', '開班剩幾天（負數＝已開第幾天前）', '結業剩幾天',
    '座位（滿班）', '登記（正取）', '試聽', '備取', '開班門檻（座位×2/3）', '狀態',
    '第一堂日期', '第一堂應到', '第一堂出席', '第一堂請假', '第一堂曠課', '第一堂未到率%',
    '最近一堂日期', '最近一堂應到', '最近一堂出席', '最近一堂未到率%', '已上幾堂', '共幾堂',
    '單科課程', '課程類型', '上課時段', 'cid', '同步時間'];
  var list = rows.slice().sort(function (a, b) {
    return (BK_REGION_ORDER[a.區] - BK_REGION_ORDER[b.區]) || (bkDay_(a.開班日) - bkDay_(b.開班日)) || String(a.院).localeCompare(String(b.院));
  });
  var out = [head];
  list.forEach(function (r) {
    var c = bkCalc_(r, todayS), f = c.f || {}, l = c.l || {};
    out.push([r.區, r.院, c.code, r.班名, r.類型, r.開班日, r.結業日 || '', c.phase, c.toOpen, c.toEnd,
      r.座位, r.正取, r.試聽, r.備取, c.th, c.st,
      f.日期 ? f.日期 + (f.時段 ? '(' + f.時段 + ')' : '') : '', f.應到 == null ? '' : f.應到, f.實到 == null ? '' : f.實到,
      f.請假 == null ? '' : f.請假, f.曠課 == null ? '' : f.曠課, c.fRate,
      l.日期 ? l.日期 + (l.時段 ? '(' + l.時段 + ')' : '') : '', l.應到 == null ? '' : l.應到, l.實到 == null ? '' : l.實到, c.lRate,
      r.已上 || '', r.堂數 || '', r.單科課程 || '', r.課程類型 || '', r.時段 || '', r.cid, at]);
  });
  return out;
}

// 班況快報：只放「今天要動的」，空的段不寫
function bkBrief_(rows, todayS, at) {
  var lines = ['🏫 班況快報 ' + bkMD_(todayS) + '（' + bkWk_(todayS) + '）' + String(at).replace(/^.*\s/, '') + ' 同步'];
  BK_BRIEF_REGIONS.forEach(function (rg) {
    var R = rows.filter(function (r) { return r.區 === rg; }).map(function (r) { return { r: r, c: bkCalc_(r, todayS) }; })
      .sort(function (a, b) { return bkDay_(a.r.開班日) - bkDay_(b.r.開班日); });
    var cls = R.filter(function (x) { return x.r.類型 !== '講座'; });
    var name = function (x) { return x.c.code + ' ' + x.r.班名 + '（' + x.r.類型 + '）'; };
    var sec = [];
    var add = function (title, arr, fn) { if (arr.length) sec.push(title + '：\n' + arr.map(fn).join('\n')); };
    add('今天開班', cls.filter(function (x) { return x.c.toOpen === 0; }),
      function (x) { return x.c.icon + name(x) + ' 登記 ' + x.r.正取 + '，' + x.c.stTxt; });
    add('3 天內要開', cls.filter(function (x) { return x.c.toOpen >= 1 && x.c.toOpen <= 3; }),
      function (x) { return x.c.icon + name(x) + ' 登記 ' + x.r.正取 + '，' + x.c.stTxt + '，剩 ' + x.c.toOpen + ' 天'; });
    add('14 天內還差人', cls.filter(function (x) { return x.c.toOpen >= 4 && x.c.toOpen <= 14 && /^💔/.test(x.c.st); }),
      function (x) { return '💔' + name(x) + ' 登記 ' + x.r.正取 + (+x.r.試聽 ? '、試聽 ' + x.r.試聽 : '') + '，' + x.c.stTxt + '，剩 ' + x.c.toOpen + ' 天'; });
    add('開班 3 天內', cls.filter(function (x) { return x.c.toOpen <= -1 && x.c.toOpen >= -3; }),
      function (x) {
        var f = x.c.f;
        var a = f && f.應到 && f.實到 ? '第一堂出席 ' + f.實到 + '／應到 ' + f.應到 + (f.請假 != null ? '，請假 ' + f.請假 + '、曠課 ' + f.曠課 : '') : '第一堂出勤還沒上傳';
        return name(x) + ' 第 ' + x.c.dayN + ' 天，' + a;
      });
    add('7 天內結業', cls.filter(function (x) { return x.c.toEnd !== '' && x.c.toEnd >= 0 && x.c.toEnd <= 7; }),
      function (x) { return name(x) + ' ' + bkMD_(x.r.結業日) + '（' + bkWk_(x.r.結業日) + '）結業'; });
    add('7 天內講座', R.filter(function (x) { return x.r.類型 === '講座' && x.c.toOpen >= 0 && x.c.toOpen <= 7; }),
      function (x) { return x.c.code + ' ' + x.r.班名 + ' ' + bkMD_(x.r.開班日) + '（' + bkWk_(x.r.開班日) + '），報名 ' + x.r.正取; });
    lines.push('');
    lines.push('📍 ' + (rg === '南區' ? '高雄建國' : rg));
    lines.push(sec.length ? sec.join('\n\n') : '這幾天沒有要追的班。');
  });
  var txt = lines.join('\n');
  return txt.length > 4800 ? txt.slice(0, 4790) + '\n…（太長，其餘看 EIP班況 分頁）' : txt;
}

/* ───────── v4：出席細查、助理數據（純計算） ───────── */

function bkShort_(nm) { nm = String(nm || ''); return nm.length === 3 ? nm.slice(1) : nm; }   // 業務只寫名字不寫姓
var BK_LAST = { '出': '出席', '假': '請假', '曠': '曠課', '未': '未點名' };

function bkAttTable_(rows, at) {
  var head = ['區', '院', '班別', '班名', '承辦', '登記人員', '學生', '正取／試聽', '前七天', '前三天', '當天確認',
    '累計出席', '請假', '曠課', '最近一堂', '最近一堂日期', '已上幾堂', '已讀到幾堂', '達標門檻（全期堂數÷3）', '達標', '名單讀取日', '同步時間'];
  var out = [head];
  rows.filter(function (r) { return r.細查 && r.細查.學生; })
    .sort(function (a, b) { return (BK_REGION_ORDER[a.區] - BK_REGION_ORDER[b.區]) || String(a.院).localeCompare(String(b.院)) || (bkDay_(a.開班日) - bkDay_(b.開班日)); })
    .forEach(function (r) {
      var q = r.細查, code = bkCode_(r);
      q.學生.slice().sort(function (a, b) { return String(a.承辦).localeCompare(String(b.承辦)) || (a.累計出席 - b.累計出席); }).forEach(function (s) {
        out.push([r.區, r.院, code, r.班名, s.承辦 || '', s.登記人員 || '', s.姓名, s.別 || '', s.前七天 || '', s.前三天 || '', s.當天確認 || '',
          s.累計出席, s.請假, s.曠課, BK_LAST[s.最近一堂] || '', s.最近一堂日期 || '', q.已上, q.已讀, q.門檻, s.達標 ? '達標' : '', q.名單讀 || '', at]);
      });
    });
  if (out.length === 1) out.push(['（還沒有細查資料：擴充要 v5.64 以上，第一次會分好幾次讀完）'].concat(new Array(head.length - 1).join('.').split('.')));
  return out;
}

// arch：週存檔 [存檔日, 院, 學生, 課程]
function bkAsst_(asst, todayS, arch, at) {
  var unc = asst.註冊未消耗 || [], fun = asst.走到哪一關 || [];
  var key = function (院, 學生, 課程) { return 院 + '|' + 學生 + '|' + 課程; };
  var now = {}; unc.forEach(function (u) { now[key(u.院, u.學生, u.課程)] = 1; });
  // 上週五的存檔（今天以前、最近一個週五）
  var t = bkDay_(todayS), base = null;
  arch.forEach(function (r) { var d = bkDay_(r[0]); if (d != null && d < t && (d + 4) % 7 === 5 && (base == null || d > base)) base = d; });
  var done = {}, baseS = '';
  if (base != null) arch.forEach(function (r) { if (bkDay_(r[0]) === base) { baseS = r[0]; if (!now[key(r[1], r[2], r[3])]) done[r[1]] = (done[r[1]] || 0) + 1; } });
  // 週五存一份
  var newArch = null;
  if ((t + 4) % 7 === 5) {
    newArch = arch.filter(function (r) { var d = bkDay_(r[0]); return d != null && d !== t && t - d <= 60; })
      .concat(unc.map(function (u) { return [todayS, u.院, u.學生, u.課程]; }));
  }
  var head = ['類別', '院', '業務／承辦', '學生', '課程', '註冊日', '註冊幾天還沒登記', '學員加購', '課名對得上',
    '談過', '報名', '註冊', '進班上課', '筆數', '最久幾天', '本週處理掉', '比較基準', '漏斗資料同步', '同步時間'];
  var out = [head], E = function (n) { return new Array(n + 1).join('.').split('.').slice(0, n); };
  var orgs = ['台一', '台二', '台三', '建國'];
  // 三家（＋建國）合計
  orgs.forEach(function (o) {
    var u = unc.filter(function (x) { return x.院 === o; }), f = fun.filter(function (x) { return x.院 === o; });
    if (!u.length && !f.length && !done[o]) return;
    var sum = function (k) { return f.reduce(function (a, x) { return a + (+x[k] || 0); }, 0); };
    out.push(['合計', o, '', '', '', '', '', '', '', sum('談過'), sum('報名'), sum('註冊'), sum('進班上課'),
      u.length, u.length ? Math.max.apply(null, u.map(function (x) { return +x.天 || 0; })) : 0,
      base == null ? '（還沒有上週五存檔）' : (done[o] || 0), base == null ? '' : '跟 ' + bkMD_(baseS) + ' 存檔比', asst.漏斗同步 || '', at]);
  });
  unc.forEach(function (u) {
    out.push(['註冊未消耗', u.院, bkShort_(u.承辦), u.學生, u.課程, u.註冊日, u.天, u.加購 ? '是' : '', u.對到課名 ? '' : '對不上，列出他所有未登記的註冊課'].concat(E(8)).concat([asst.漏斗同步 || '', at]));
  });
  fun.forEach(function (f) {
    out.push(['走到哪一關', f.院, bkShort_(f.業務) + (f.主管 ? '（主管）' : '')].concat(E(6)).concat([f.談過, f.報名, f.註冊, f.進班上課]).concat(E(4)).concat([asst.漏斗同步 || '', at]));
  });
  (asst.查不到 || []).forEach(function (m) {
    out.push(['面談紀錄查不到（多半是很久以前的舊生加購）', m.split(' ')[0], '', m.split(' ').slice(1).join(' ')].concat(E(13)).concat([asst.漏斗同步 || '', at]));
  });
  return { table: out, newArch: newArch, done: done, baseS: base == null ? '' : bkMD_(baseS) };
}

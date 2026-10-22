/**
 * 業績數據橋接 v3｜2026-10-21｜加「🏫 班況」
 *
 * 做什麼：
 *   業績數據中心按「🏫 班況」（或 ⚡ 全部同步的第 6 段）之後，把三區每一班的數字送過來，這支程式：
 *   ① 整份覆寫快照表的「EIP班況」分頁（一班一列，給你看）
 *   ② 覆寫 Drive「13:40 日會議程」資料夾裡的「EIP班況_最新.csv」（給 9:30 日會議程排程讀）
 *   ③ 在「LINE 推播」資料夾建「LINE班況 YYYY-MM-DD.txt」（一天只建一次，n8n 看到就推到你的 LINE）
 *   原本的業績快照（數據、業務分頁）照舊，交給 doPostSnapshot_ 處理。
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

function doGet(e) { return bkJson_({ v: 3 }); }

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
  return doPostSnapshot_(e);   // 原本的業績快照
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
  return { ok: true, rows: table.length - 1, brief: brief };
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
    add('開班超過 3 天、未到超過三成', cls.filter(function (x) { return x.c.toOpen < -3 && x.c.phase === '已開班' && x.c.lRate !== '' && x.c.lRate > 30; }),
      function (x) { return name(x) + ' 最近一堂 ' + bkMD_(x.c.l.日期) + ' 出席 ' + x.c.l.實到 + '／應到 ' + x.c.l.應到 + '（未到 ' + x.c.lRate + '%）'; });
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

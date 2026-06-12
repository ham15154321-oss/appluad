/* ═══════════════════════════════════════════════
   Appedu EIP 激勵同步 — Chrome Extension Popup
   v4: 直接索引法（不用虛擬格線）

   EIP 學院績效總表結構：
   Header 有 17 欄，但「小組個人業績Ⓐ」(col15) 在資料行完全沒有 td

   型態 A（區域首列，有 rowspan）→ 實際 16~17 個 td
     td[0]=區域(rowspan=N), td[1]=學院, td[2..14]=數值欄, ...
     → 學院=td[1], 業績=td[12]

   型態 B（同區域後續列，無區域 td）→ 實際 15~16 個 td
     td[0]=學院, td[1..13]=數值欄, ...
     → 學院=td[0], 業績=td[11]
   ═══════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', function(){
  var now = new Date();
  var curY = now.getFullYear();
  var curM = now.getMonth() + 1;
  var selY = document.getElementById('selYear');
  var selM = document.getElementById('selMonth');

  for (var y = curY; y >= curY - 2; y--){
    var o = document.createElement('option');
    o.value = y; o.textContent = y;
    if (y === curY) o.selected = true;
    selY.appendChild(o);
  }
  for (var m = 1; m <= 12; m++){
    var o = document.createElement('option');
    o.value = String(m).padStart(2,'0');
    o.textContent = m + '月';
    if (m === curM) o.selected = true;
    selM.appendChild(o);
  }

  document.getElementById('btnSync').addEventListener('click', doSync);
});

function setStatus(msg, type){
  var el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status' + (type ? ' ' + type : '');
}

function showResult(academy, sales, groupPerf, reservePerf, checkin, perfP, perfPTotal, channelData){
  var el = document.getElementById('result');
  var html =
    '<div class="result-item"><span class="label">🏫 學院排名</span><span class="count">' + academy.length + ' 筆</span></div>' +
    '<div class="result-item"><span class="label">👤 業務排名</span><span class="count">' + sales.length + ' 筆</span></div>';
  if (groupPerf){
    html += '<div class="result-item"><span class="label">🎖️ 正式小組</span><span class="count">' + groupPerf.length + ' 組</span></div>';
  }
  if (reservePerf){
    html += '<div class="result-item"><span class="label">🌱 儲備小組</span><span class="count">' + reservePerf.length + ' 組</span></div>';
  }
  if (checkin){
    html += '<div class="result-item"><span class="label">🚪 已報到 / 網路 / 到月底</span><span class="count">' + checkin.formal.total + ' / ' + checkin.net.total + ' / ' + checkin.rs.total + '</span></div>';
  }
  if (perfP){
    html += '<div class="result-item"><span class="label">📆 七學院個人績效</span><span class="count">' + (perfPTotal || 0) + ' 人</span></div>';
  }
  if (channelData && channelData.channels){
    var nChan = 0;
    for (var ck in channelData.channels){ if (channelData.channels[ck].ranking.length) nChan++; }
    html += '<div class="result-item"><span class="label">📋 各通路績效</span><span class="count">' + nChan + '/6 通路</span></div>';
  }
  el.innerHTML = html;
}

// ══════════════════════════════════════════════
//  ★ 正式小組績效表（performance_d.php）
//  和 content.js 同步，邏輯一致
// ══════════════════════════════════════════════
function extractGroupPerformance(html){
  var doc = new DOMParser().parseFromString(html, 'text/html');
  var table = doc.getElementById('performances');
  if (!table){
    var tables = doc.querySelectorAll('table');
    for (var t = 0; t < tables.length; t++){
      var rs = getDirectRows(tables[t]);
      if (rs.length < 2) continue;
      if (rs[0].textContent.indexOf('正式組別') >= 0){ table = tables[t]; break; }
    }
  }
  if (!table) return [];

  var rows = getDirectRows(table);
  var data = [];

  function clean(s){ return String(s || '').trim(); }
  function num(s){
    var x = clean(s).replace(/,/g,'').replace(/\$/g,'').replace(/\s/g,'');
    return parseFloat(x) || 0;
  }

  for (var i = 1; i < rows.length; i++){
    var cells = getDirectCells(rows[i]);
    var tds = [];
    for (var c = 0; c < cells.length; c++){
      if (cells[c].tagName === 'TD') tds.push(cells[c]);
    }
    if (tds.length < 6) continue;

    var rank = parseInt(clean(tds[0].textContent), 10) || 0;
    var academy = clean(tds[1].textContent);
    var groupName = clean(tds[2].textContent);
    if (!groupName || groupName.indexOf('合計') >= 0 || groupName.indexOf('總計') >= 0) continue;

    var total = num(tds[3].textContent);
    var leader = {
      name: clean(tds[4] ? tds[4].textContent : ''),
      value: tds[5] ? num(tds[5].textContent) : 0
    };

    var members = [];
    for (var m = 6; m + 1 < tds.length; m += 2){
      var nm = clean(tds[m].textContent);
      var v = num(tds[m+1].textContent);
      if (nm) members.push({ name: nm, value: v });
    }

    data.push({
      rank: rank, academy: academy, groupName: groupName,
      total: total, leader: leader, members: members
    });
  }

  data.sort(function(a, b){ return (b.total||0) - (a.total||0); });
  console.log('[EIP] 正式小組: ' + data.length + ' 組');
  return data;
}

// ── 抓取 EIP 頁面 HTML ──
async function fetchEipPage(url){
  console.log('[EIP] 抓取:', url);
  var resp = await fetch(url, { credentials: 'include' });
  if (!resp.ok) throw new Error('HTTP ' + resp.status + ' — 可能未登入 EIP');
  var buf = await resp.arrayBuffer();

  var textBig5 = '', textUtf8 = '';
  try { textBig5 = new TextDecoder('big5').decode(buf); } catch(e){}
  try { textUtf8 = new TextDecoder('utf-8').decode(buf); } catch(e){}

  if (textUtf8.indexOf('學院') >= 0 || textUtf8.indexOf('姓名') >= 0 || textUtf8.indexOf('業績') >= 0){
    return textUtf8;
  }
  if (textBig5.indexOf('學院') >= 0 || textBig5.indexOf('姓名') >= 0 || textBig5.indexOf('業績') >= 0){
    return textBig5;
  }
  return textUtf8 || textBig5;
}

// ══════════════════════════════════════════════
//  ★ 取得直接子元素（避免巢狀 table 干擾）
// ══════════════════════════════════════════════
function getDirectChildren(parent, tagName){
  var result = [];
  var kids = parent.children;
  for (var i = 0; i < kids.length; i++){
    if (kids[i].tagName === tagName) result.push(kids[i]);
  }
  return result;
}

function getDirectRows(table){
  // 先找直屬 tbody/thead 的 tr
  var rows = [];
  var bodies = getDirectChildren(table, 'TBODY');
  var heads = getDirectChildren(table, 'THEAD');
  heads.forEach(function(h){ rows = rows.concat(getDirectChildren(h, 'TR')); });
  bodies.forEach(function(b){ rows = rows.concat(getDirectChildren(b, 'TR')); });
  // 若沒有 tbody/thead，直接取 table 的 tr
  if (rows.length === 0) rows = getDirectChildren(table, 'TR');
  return rows;
}

function getDirectCells(tr){
  var cells = [];
  var kids = tr.children;
  for (var i = 0; i < kids.length; i++){
    if (kids[i].tagName === 'TD' || kids[i].tagName === 'TH') cells.push(kids[i]);
  }
  return cells;
}

// ══════════════════════════════════════════════
//  ★ 找到含「學院」的主資料表格
// ══════════════════════════════════════════════
function findDataTable(doc){
  var tables = doc.querySelectorAll('table');
  for (var t = 0; t < tables.length; t++){
    var rows = getDirectRows(tables[t]);
    if (rows.length < 2) continue;
    var headerText = rows[0].textContent;
    if (headerText.indexOf('學院') >= 0 && headerText.indexOf('業績') >= 0){
      console.log('[EIP] 找到學院資料表，共 ' + rows.length + ' 列');
      return tables[t];
    }
  }
  // fallback: 找最大 table
  var best = null, bestCount = 0;
  for (var t = 0; t < tables.length; t++){
    var c = getDirectRows(tables[t]).length;
    if (c > bestCount){ bestCount = c; best = tables[t]; }
  }
  if (best) console.log('[EIP] 用最大 table（' + bestCount + ' 列）');
  return best;
}

// ══════════════════════════════════════════════
//  ★ 學院排名提取（v4 直接索引法）
// ══════════════════════════════════════════════
function extractAcademyDirect(html){
  var doc = new DOMParser().parseFromString(html, 'text/html');
  var table = findDataTable(doc);
  if (!table) return [];

  var rows = getDirectRows(table);
  var data = [];
  var seenNames = {};

  console.log('[EIP] 開始解析學院資料，共 ' + rows.length + ' 列');

  // ★ v5.1：依表頭文字定位「學院」「業績」欄（EIP 欄位增減也不會抓錯）
  var ths = getDirectCells(rows[0]);
  var colAcad = -1, colVal = -1, hasRegion = false;
  for (var hc = 0; hc < ths.length; hc++){
    var ht = ths[hc].textContent.trim();
    if (ht.indexOf('區域') >= 0) hasRegion = true;
    if (colAcad < 0 && ht === '學院') colAcad = hc;
    if (ht === '合計業績') colVal = hc;
    if (colVal < 0 && ht === '業績') colVal = hc;
  }
  var headerBased = (colAcad >= 0 && colVal >= 0);
  console.log('[EIP] 學院表頭定位: 學院欄=' + colAcad + ' 業績欄=' + colVal + ' 區域=' + hasRegion + (headerBased ? '' : '（找不到，退回固定索引）'));

  for (var i = 1; i < rows.length; i++){
    var tds = getDirectCells(rows[i]);
    // 只取 td，不取 th
    var tdOnly = [];
    for (var c = 0; c < tds.length; c++){
      if (tds[c].tagName === 'TD') tdOnly.push(tds[c]);
    }
    if (tdOnly.length < 5) continue;

    var firstTd = tdOnly[0];
    var firstText = firstTd.textContent.trim();

    // 跳過合計列
    if (firstText.indexOf('合計') >= 0 || firstText.indexOf('總計') >= 0 || firstText.indexOf('小計') >= 0) continue;
    // 跳過 colspan 列（通常是合計/小計）
    if (firstTd.getAttribute('colspan')) continue;

    var name, valStr;

    if (headerBased){
      // 型態 B（無區域 td、被 rowspan 合併）整列往左移 1 格
      var offset = (hasRegion && !firstTd.getAttribute('rowspan')) ? -1 : 0;
      var ni = colAcad + offset, vi = colVal + offset;
      if (ni < 0 || vi < 0 || ni >= tdOnly.length || vi >= tdOnly.length) continue;
      name = tdOnly[ni].textContent.trim();
      valStr = tdOnly[vi].textContent.trim();
      if (i <= 5) console.log('[EIP] 表頭定位 列' + i + ': 學院=' + name + ' 業績=' + valStr + ' offset=' + offset + ' (td數=' + tdOnly.length + ')');
    } else if (firstTd.getAttribute('rowspan')){
      // ★ 型態 A：有區域欄（rowspan）
      // td[0]=區域, td[1]=學院, td[2]=面談, ..., td[12]=業績
      if (tdOnly.length < 13) continue;
      name = tdOnly[1].textContent.trim();
      valStr = tdOnly[12].textContent.trim();
      if (i <= 3) console.log('[EIP] 型態A 列' + i + ': 區域=' + firstText + ' 學院=' + name + ' 業績=' + valStr + ' (td數=' + tdOnly.length + ')');
    } else {
      // ★ 型態 B：無區域欄（被 rowspan 合併）
      // td[0]=學院, td[1]=面談, ..., td[11]=業績
      if (tdOnly.length < 12) continue;
      name = tdOnly[0].textContent.trim();
      valStr = tdOnly[11].textContent.trim();
      if (i <= 5) console.log('[EIP] 型態B 列' + i + ': 學院=' + name + ' 業績=' + valStr + ' (td數=' + tdOnly.length + ')');
    }

    // 清理數值
    valStr = valStr.replace(/,/g, '').replace(/\$/g, '').replace(/\s/g, '');
    var val = parseFloat(valStr) || 0;

    // 過濾無效資料
    if (!name) continue;
    if (/^[\d.,\s]+$/.test(name)) continue;
    if (name.indexOf('合計') >= 0 || name.indexOf('總計') >= 0 || name.indexOf('小計') >= 0) continue;
    if (seenNames[name]) continue;
    seenNames[name] = true;

    data.push({ name: name, value: val });
  }

  data.sort(function(a, b){ return b.value - a.value; });
  console.log('[EIP] 學院資料: ' + data.length + ' 筆');
  if (data.length > 0){
    console.log('[EIP] 前5名: ' + data.slice(0, 5).map(function(d){ return d.name + '=$' + d.value; }).join(', '));
  }
  return data;
}

// ══════════════════════════════════════════════
//  ★ 業務排名提取（同樣用直接索引法）
// ══════════════════════════════════════════════
function extractSalesDirect(html){
  var doc = new DOMParser().parseFromString(html, 'text/html');
  var tables = doc.querySelectorAll('table');

  // 找含「姓名」的表格
  var table = null;
  for (var t = 0; t < tables.length; t++){
    var rows = getDirectRows(tables[t]);
    if (rows.length < 2) continue;
    var headerText = rows[0].textContent;
    if (headerText.indexOf('姓名') >= 0){
      table = tables[t];
      break;
    }
  }
  if (!table){
    // fallback: 最大表格
    var best = null, bestCount = 0;
    for (var t = 0; t < tables.length; t++){
      var c = getDirectRows(tables[t]).length;
      if (c > bestCount){ bestCount = c; best = tables[t]; }
    }
    table = best;
  }
  if (!table) return [];

  var rows = getDirectRows(table);
  // 找表頭中「姓名」和「業績」的欄位索引
  var headerCells = getDirectCells(rows[0]);
  var colName = -1, colVal = -1;
  for (var c = 0; c < headerCells.length; c++){
    var txt = headerCells[c].textContent.trim();
    if (txt.indexOf('姓名') >= 0 && colName < 0) colName = c;
    if (txt.indexOf('合計業績') >= 0) colVal = c;
    if (txt === '合計' && colVal < 0) colVal = c;
  }
  if (colVal < 0){
    for (var c = 0; c < headerCells.length; c++){
      var txt = headerCells[c].textContent.trim();
      if (txt === '業績' || (txt.indexOf('業績') >= 0 && txt.indexOf('Ⓐ') < 0 && txt.indexOf('Ⓑ') < 0)){
        colVal = c;
      }
    }
  }
  console.log('[EIP] 業務表：姓名欄=' + colName + ' 業績欄=' + colVal);
  if (colName < 0 || colVal < 0) return [];

  var data = [];
  for (var i = 1; i < rows.length; i++){
    var tds = getDirectCells(rows[i]);
    var tdOnly = [];
    for (var c = 0; c < tds.length; c++){
      if (tds[c].tagName === 'TD') tdOnly.push(tds[c]);
    }
    if (tdOnly.length <= Math.max(colName, colVal)) continue;

    // 業務表的 rowspan 處理：同學院績效表
    var offset = 0;
    if (tdOnly[0].getAttribute('rowspan')) offset = 0;
    else if (tdOnly[0].getAttribute('colspan')) continue; // 合計列
    else if (tdOnly.length < headerCells.length) offset = -1;

    var nameIdx = colName + offset;
    var valIdx = colVal + offset;
    if (nameIdx < 0 || valIdx < 0 || nameIdx >= tdOnly.length || valIdx >= tdOnly.length) continue;

    var name = tdOnly[nameIdx].textContent.trim();
    var valStr = tdOnly[valIdx].textContent.trim().replace(/,/g, '').replace(/\$/g, '').replace(/\s/g, '');
    var val = parseFloat(valStr) || 0;

    if (!name) continue;
    if (name.indexOf('合計') >= 0 || name.indexOf('總計') >= 0 || name.indexOf('小計') >= 0) continue;
    data.push({ name: name, value: val });
  }

  data.sort(function(a, b){ return b.value - a.value; });
  console.log('[EIP] 業務資料: ' + data.length + ' 筆');
  return data;
}

// ══════════════════════════════════════════════
//  ★ v4.9 新增：七學院個人績效（performance_p.php perfRows JSON）
// ══════════════════════════════════════════════
var PERF_ORGS = [
  { id: 23, name: '台中學院' },
  { id: 29, name: '台中二部' },
  { id: 33, name: '台中三部' },
  { id: 18, name: '中壢學院' },
  { id: 28, name: '中壢二部' },
  { id: 31, name: '中壢三部' },
  { id: 36, name: '高雄建國' }
];

function extractPerfRows(html){
  var i = html.indexOf('perfRows = ');
  if (i < 0) i = html.indexOf('perfRows=');
  if (i < 0) return null;
  var s = html.indexOf('{', i);
  if (s < 0) return null;
  var depth = 0, inStr = false, esc = false, j = s;
  for (; j < html.length; j++){
    var c = html[j];
    if (inStr){
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}'){ depth--; if (depth === 0){ j++; break; } }
  }
  try { return JSON.parse(html.slice(s, j)); } catch(e){ console.warn('[EIP] perfRows JSON 解析失敗', e); return null; }
}

async function fetchPerfP(year, month){
  var result = { orgs: {}, meta: { year: year, month: month } };
  for (var k = 0; k < PERF_ORGS.length; k++){
    var org = PERF_ORGS[k];
    setStatus('⏳ 個人績效 ' + org.name + ' (' + (k+1) + '/' + PERF_ORGS.length + ')...');
    var url = 'http://eip.appedu.com.tw/working/report/performance/performance_p.php?q1=' + year + '&q2=' + month + '&q3=' + org.id + '&q4=&q5=&btnq=%E6%9F%A5%E8%A9%A2';
    try {
      var html = await fetchEipPage(url);
      var rows = extractPerfRows(html);
      var arr = [];
      if (rows){ for (var key in rows){ if (rows.hasOwnProperty(key)) arr.push(rows[key]); } }
      result.orgs[org.name] = arr;
      console.log('[EIP] 個人績效 ' + org.name + ': ' + arr.length + ' 人');
    } catch(e){
      result.orgs[org.name] = [];
      console.warn('[EIP] 個人績效 ' + org.name + ' 失敗: ' + e.message);
    }
  }
  return result;
}

// ══════════════════════════════════════════════
//  ★ v4.9 新增：通路名單報到統計（total_csv.php 優先 / total.php 分頁備援）
// ══════════════════════════════════════════════
function buildTotalQuery(params){
  var defaults = { q1:'',q2:'',q3:'',q4:'',q26:'',q27:'',q28:'',q29:'',q5:'',q6:'',q7:'',q8:'',q16:'',q23:'',q24:'',scn:'',ecn:'',q9:'',q25:'',q10:'',q11:'',q12:'',q20:'',q21:'',q22:'',q13:'',q14:'',q15:'',q17:'',q18:'',q19:'0' };
  for (var k in params) defaults[k] = params[k];
  var parts = [];
  for (var key in defaults) parts.push(key + '=' + encodeURIComponent(defaults[key]));
  return parts.join('&');
}

function parseCSV(text){
  var rows = [], row = [], cell = '', inQ = false;
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  for (var i = 0; i < text.length; i++){
    var c = text[i];
    if (inQ){
      if (c === '"'){
        if (text[i+1] === '"'){ cell += '"'; i++; }
        else inQ = false;
      } else cell += c;
    } else if (c === '"'){ inQ = true; }
    else if (c === ','){ row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r'){
      if (c === '\r' && text[i+1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length){ row.push(cell); rows.push(row); }
  return rows;
}

function emptyCounts(){ return { byKey: {}, byAcademy: {}, total: 0 }; }

function addCount(counts, academy, owner){
  academy = (academy || '').trim();
  owner = (owner || '').trim();
  if (!academy && !owner) return;
  var key = academy + '|' + owner;
  counts.byKey[key] = (counts.byKey[key] || 0) + 1;
  if (academy) counts.byAcademy[academy] = (counts.byAcademy[academy] || 0) + 1;
  counts.total++;
}

function countsFromCSV(text){
  var rows = parseCSV(text);
  if (!rows.length) return null;
  var hIdx = -1, idxAcad = -1, idxOwner = -1;
  for (var r = 0; r < Math.min(rows.length, 5); r++){
    var ia = -1, io = -1;
    for (var c = 0; c < rows[r].length; c++){
      var h = String(rows[r][c]).trim();
      if (ia < 0 && h.indexOf('學院') >= 0) ia = c;
      if (io < 0 && h.indexOf('承辦人') >= 0) io = c;
    }
    if (ia >= 0 && io >= 0){ hIdx = r; idxAcad = ia; idxOwner = io; break; }
  }
  if (hIdx < 0) return null;
  var counts = emptyCounts();
  for (var i = hIdx + 1; i < rows.length; i++){
    if (rows[i].length <= Math.max(idxAcad, idxOwner)) continue;
    addCount(counts, rows[i][idxAcad], rows[i][idxOwner]);
  }
  return counts;
}

function countsFromListHtml(html, counts){
  var doc = new DOMParser().parseFromString(html, 'text/html');
  var tables = doc.querySelectorAll('table');
  var table = null, idxAcad = -1, idxOwner = -1;
  for (var t = 0; t < tables.length; t++){
    var rows = getDirectRows(tables[t]);
    if (rows.length < 1) continue;
    var ths = getDirectCells(rows[0]);
    var ia = -1, io = -1;
    for (var c = 0; c < ths.length; c++){
      var h = ths[c].textContent.trim();
      if (ia < 0 && h === '學院') ia = c;
      if (io < 0 && h === '承辦人') io = c;
    }
    if (ia >= 0 && io >= 0){ table = tables[t]; idxAcad = ia; idxOwner = io; break; }
  }
  if (!table) return 0;
  var trs = getDirectRows(table), n = 0;
  for (var i = 1; i < trs.length; i++){
    var tds = getDirectCells(trs[i]);
    if (tds.length <= Math.max(idxAcad, idxOwner)) continue;
    addCount(counts, tds[idxAcad].textContent, tds[idxOwner].textContent);
    n++;
  }
  return n;
}

async function fetchListCounts(params, label){
  var qs = buildTotalQuery(params);
  try {
    var csv = await fetchEipPage('http://eip.appedu.com.tw/outlet/list/total_csv.php?' + qs);
    if (csv && csv.indexOf('<html') < 0 && csv.indexOf('<!DOCTYPE') < 0){
      var counts = countsFromCSV(csv);
      if (counts && counts.total > 0){
        console.log('[EIP] ' + label + ' CSV: ' + counts.total + ' 筆');
        return counts;
      }
    }
    console.warn('[EIP] ' + label + ' CSV 解析無結果，改用 HTML 分頁');
  } catch(e){
    console.warn('[EIP] ' + label + ' CSV 失敗: ' + e.message + '，改用 HTML 分頁');
  }
  var counts2 = emptyCounts();
  var first = await fetchEipPage('http://eip.appedu.com.tw/outlet/list/total.php?' + qs + '&pg=1');
  countsFromListHtml(first, counts2);
  var m = first.match(/共\s*(\d+)\s*頁/);
  var pages = m ? Math.min(parseInt(m[1], 10), 100) : 1;
  for (var p = 2; p <= pages; p++){
    setStatus('⏳ ' + label + ' 第 ' + p + '/' + pages + ' 頁...');
    var html = await fetchEipPage('http://eip.appedu.com.tw/outlet/list/total.php?' + qs + '&pg=' + p);
    countsFromListHtml(html, counts2);
  }
  console.log('[EIP] ' + label + ' HTML 分頁: ' + counts2.total + ' 筆');
  return counts2;
}

function pad2(n){ return String(n).padStart(2, '0'); }

async function fetchCheckin(year, month){
  var monthStart = year + '/' + month + '/01';
  var lastDay = new Date(parseInt(year, 10), parseInt(month, 10), 0).getDate();
  var monthEnd = year + '/' + month + '/' + pad2(lastDay);
  var now = new Date();
  var isCurrentMonth = (now.getFullYear() === parseInt(year, 10) && (now.getMonth() + 1) === parseInt(month, 10));
  var rsStart = isCurrentMonth ? (now.getFullYear() + '/' + pad2(now.getMonth() + 1) + '/' + pad2(now.getDate())) : monthStart;

  setStatus('⏳ 已報到名單 (1/3)...');
  var formal = await fetchListCounts({ q7: monthStart, q16: 'formal' }, '已報到');
  setStatus('⏳ 網路已報到 (2/3)...');
  var net = await fetchListCounts({ q7: monthStart, q16: 'formal', q13: '3' }, '網路已報到');
  setStatus('⏳ 到月底預約報到 (3/3)...');
  var rs = await fetchListCounts({ q7: rsStart, q8: monthEnd, q16: '2' }, '預約報到');

  return { formal: formal, net: net, rs: rs, meta: { year: year, month: month, rsStart: rsStart, rsEnd: monthEnd } };
}

// ══════════════════════════════════════════════
//  ★ v5.0 新增：個人收支業績查詢 → 各通路績效
// ══════════════════════════════════════════════
function buildMoneyQuery(monthStart){
  var keys = ['q1','q2','q3','q4','q5','q6','q7','q8','q25','q26','q27','q9','q10','q11','q23','q29','q12','q13','q14','q15','q18','q19','q20','q21'];
  var parts = [];
  keys.forEach(function(k){ parts.push(k + '=' + (k === 'q1' ? encodeURIComponent(monthStart) : '')); });
  parts.push('btnq=%E6%9F%A5%E8%A9%A2');
  return parts.join('&');
}

function _moneyColMap(headers){
  var NEED = { org:'組織', owner:'業績承辦人', main:'通路來源主類別', sub:'通路來源副類別', note:'狀態備註', item:'收支項目', perf:'業績合計', inDate:'入帳日期' };
  var found = {};
  for (var c = 0; c < headers.length; c++){
    var h = String(headers[c]).trim();
    for (var k in NEED){ if (found[k] === undefined && h.indexOf(NEED[k]) >= 0) found[k] = c; }
  }
  if (found.org !== undefined && found.owner !== undefined && found.perf !== undefined && found.main !== undefined) return found;
  return null;
}

function moneyRowsFromCSV(text, monthStart){
  var rows = parseCSV(text);
  if (!rows.length) return null;
  var hIdx = -1, col = null;
  for (var r = 0; r < Math.min(rows.length, 5); r++){
    col = _moneyColMap(rows[r]);
    if (col){ hIdx = r; break; }
  }
  if (hIdx < 0) return null;
  var out = [];
  var startCmp = monthStart.replace(/\//g, '-');
  for (var i = hIdx + 1; i < rows.length; i++){
    var row = rows[i];
    if (row.length <= col.perf) continue;
    function cell(k){ return col[k] !== undefined && row[col[k]] !== undefined ? String(row[col[k]]).trim() : ''; }
    if (cell('note').indexOf('不計業績') >= 0) continue;
    var val = parseFloat(cell('perf').replace(/,/g, '').replace(/\s/g, '')) || 0;
    var inDate = cell('inDate').replace(/\//g, '-');
    if (val < 0 && inDate && inDate.slice(0, 10) < startCmp) continue;
    out.push({ org: cell('org'), owner: cell('owner'), main: cell('main'), sub: cell('sub'), item: cell('item'), value: val });
  }
  console.log('[EIP] 收支明細 CSV: ' + out.length + ' 筆');
  return out;
}

function moneyRowsFromHtml(html, monthStart, acc){
  var doc = new DOMParser().parseFromString(html, 'text/html');
  var tables = doc.querySelectorAll('table');
  var table = null, col = null;
  for (var t = 0; t < tables.length; t++){
    var rs = getDirectRows(tables[t]);
    if (rs.length < 1) continue;
    var ths = getDirectCells(rs[0]).map(function(x){ return x.textContent; });
    col = _moneyColMap(ths);
    if (col){ table = tables[t]; break; }
  }
  if (!table) return 0;
  var startCmp = monthStart.replace(/\//g, '-');
  var trs = getDirectRows(table), n = 0;
  for (var i = 1; i < trs.length; i++){
    var tds = getDirectCells(trs[i]);
    if (tds.length <= col.perf) continue;
    function cell(k){ return col[k] !== undefined && tds[col[k]] ? tds[col[k]].textContent.trim() : ''; }
    if (cell('note').indexOf('不計業績') >= 0) continue;
    var val = parseFloat(cell('perf').replace(/,/g, '').replace(/\s/g, '')) || 0;
    var inDate = cell('inDate').replace(/\//g, '-');
    if (val < 0 && inDate && inDate.slice(0, 10) < startCmp) continue;
    acc.push({ org: cell('org'), owner: cell('owner'), main: cell('main'), sub: cell('sub'), item: cell('item'), value: val });
    n++;
  }
  return n;
}

async function fetchMoneyRows(year, month){
  var monthStart = year + '/' + month + '/01';
  var qs = buildMoneyQuery(monthStart);
  setStatus('⏳ 收支明細（各通路績效）...');
  try {
    var csv = await fetchEipPage('http://eip.appedu.com.tw/class/report/performance/business_money_csv.php?' + qs);
    if (csv && csv.indexOf('<html') < 0 && csv.indexOf('<!DOCTYPE') < 0){
      var rows = moneyRowsFromCSV(csv, monthStart);
      if (rows && rows.length > 0) return rows;
    }
    console.warn('[EIP] 收支 CSV 解析無結果，改用 HTML 分頁');
  } catch(e){
    console.warn('[EIP] 收支 CSV 失敗: ' + e.message + '，改用 HTML 分頁');
  }
  var acc = [];
  var first = await fetchEipPage('http://eip.appedu.com.tw/class/report/performance/business_money.php?' + qs + '&pg=1');
  moneyRowsFromHtml(first, monthStart, acc);
  var m = first.match(/共\s*(\d+)\s*頁/);
  var pages = m ? Math.min(parseInt(m[1], 10), 150) : 1;
  for (var p = 2; p <= pages; p++){
    setStatus('⏳ 收支明細 第 ' + p + '/' + pages + ' 頁...');
    var html = await fetchEipPage('http://eip.appedu.com.tw/class/report/performance/business_money.php?' + qs + '&pg=' + p);
    moneyRowsFromHtml(html, monthStart, acc);
  }
  console.log('[EIP] 收支明細 HTML 分頁: ' + acc.length + ' 筆');
  return acc;
}

var CH_ORG_RENAME = { '台中學院': '台中一部' };
function computeChannels(moneyRows, perfPData, year, month){
  function renameOrg(o){ return CH_ORG_RENAME[o] || o; }
  var ch = { net:{}, purchase:{}, event:{}, referral:{}, cash:{}, admin:{} };
  var ac = { net:{}, purchase:{}, event:{}, referral:{}, cash:{}, admin:{} };
  function add(bucket, key, v){ if (!key) return; bucket[key] = (bucket[key] || 0) + v; }

  (moneyRows || []).forEach(function(r){
    var keys = [];
    if (r.main === '網際網路') keys.push('net');
    if (r.main === '展場活動') keys.push('event');
    if (r.sub === '學員加購') keys.push('purchase');
    if (r.sub === '學員介紹') keys.push('referral');
    var it = r.item || '';
    if (it === '現金' || it === '匯款' || it.indexOf('一卡通') >= 0 || it.indexOf('綠界') >= 0 || it.indexOf('Line Pay') >= 0) keys.push('cash');
    var org = renameOrg(r.org);
    keys.forEach(function(k){
      add(ch[k], r.owner, r.value);
      add(ac[k], org, r.value);
    });
  });

  if (perfPData && perfPData.orgs){
    for (var orgName in perfPData.orgs){
      var orgOut = renameOrg(orgName);
      perfPData.orgs[orgName].forEach(function(p){
        var nm = p.employee_name;
        if (!nm) return;
        var biz = parseFloat(String(p.business).replace(/,/g, '')) || 0;
        var bizA = parseFloat(String(p.new_perf).replace(/,/g, '')) || 0;
        var adminVal = biz - bizA - (ch.purchase[nm] || 0);
        add(ch.admin, nm, adminVal);
        add(ac.admin, orgOut, adminVal);
      });
    }
  }

  function toRanking(map){
    return Object.keys(map)
      .map(function(n){ return { name: n, value: Math.round(map[n]) }; })
      .filter(function(x){ return x.value !== 0; })
      .sort(function(a, b){ return b.value - a.value; });
  }
  var out = { meta: { year: year, month: month }, channels: {} };
  ['net','purchase','event','referral','admin','cash'].forEach(function(k){
    out.channels[k] = { ranking: toRanking(ch[k]), academies: toRanking(ac[k]) };
  });
  return out;
}

// ── 注入資料到目前開啟的頁面 ──
async function injectData(academyData, salesData, groupData, reserveData, year, month, checkinData, perfPData, channelData, isPartial){
  var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || tabs.length === 0) throw new Error('找不到目前頁面');

  var now = new Date();
  var timeStr = now.getFullYear() + '/' + (now.getMonth()+1) + '/' + now.getDate()
    + ' ' + now.getHours() + ':' + String(now.getMinutes()).padStart(2,'0');

  await chrome.scripting.executeScript({
    target: { tabId: tabs[0].id, allFrames: true }, // ★ v4.9：業績數據中心在 iframe 內，allFrames 才能即時重新渲染
    func: function(academy, sales, groupPerf, reservePerf, periodMeta, updateTime, checkin, perfP, channelData, isPartial){
      var cid = '';
      try { var aid = localStorage.getItem('activeCharacterId'); if(aid) cid = 'char_' + aid + '_'; } catch(e){}

      // 1) 寫入 localStorage（資料 + meta）
      localStorage.setItem(cid + 'motiv_academy_v1', JSON.stringify(academy));
      localStorage.setItem(cid + 'motiv_sales_v1', JSON.stringify(sales));
      localStorage.setItem(cid + 'motiv_group_performance_v1', JSON.stringify(groupPerf || []));
      localStorage.setItem(cid + 'motiv_group_performance_meta', JSON.stringify(periodMeta || {}));
      localStorage.setItem(cid + 'motiv_reserve_performance_v1', JSON.stringify(reservePerf || []));
      localStorage.setItem(cid + 'motiv_reserve_performance_meta', JSON.stringify(periodMeta || {}));
      localStorage.setItem(cid + 'motiv_updated_at', updateTime);
      // ★ v4.9：報到統計 + 七學院個人績效
      try { if (checkin) localStorage.setItem(cid + 'motiv_checkin_v1', JSON.stringify(checkin)); } catch(e){}
      try { if (perfP) localStorage.setItem(cid + 'motiv_perfp_v1', JSON.stringify(perfP)); } catch(e){}
      // ★ v5.0：各通路績效
      try { if (channelData) localStorage.setItem(cid + 'motiv_channel_v1', JSON.stringify(channelData)); } catch(e){}

      // 2) ★ 改呼叫 motivLoadData()（會把 meta 也載入到 window 變數）
      //    之前只手動賦值資料 globals，漏掉 meta globals → 標題顯示舊月份
      if (typeof window.motivLoadData === 'function'){
        window.motivLoadData();
      } else {
        // fallback：頁面沒有 motivLoadData → 至少更新資料 globals
        if (window._motivAcademy !== undefined) window._motivAcademy = academy;
        if (window._motivSales !== undefined) window._motivSales = sales;
        if (window._motivGroupPerf !== undefined) window._motivGroupPerf = groupPerf || [];
        if (window._motivReservePerf !== undefined) window._motivReservePerf = reservePerf || [];
        if (window._motivGroupPerfMeta !== undefined) window._motivGroupPerfMeta = periodMeta || {};
        if (window._motivReservePerfMeta !== undefined) window._motivReservePerfMeta = periodMeta || {};
      }

      // 3) 重新渲染
      if (typeof window.motivRenderAll === 'function') window.motivRenderAll();
      // ★ v4.9：報到排名 / 當月績效 分頁重新渲染
      if (typeof window.ckRenderAll === 'function'){ try{ window.ckRenderAll(); }catch(e){} }
      if (typeof window.ppRenderAll === 'function'){ try{ window.ppRenderAll(); }catch(e){} }
      // ★ v5.0：各通路績效 自動套用 + 重新渲染
      if (typeof window.chApplyAutoSync === 'function'){ try{ window.chApplyAutoSync(); }catch(e){} }

      // 4) ★ 自動儲存到 archive（解決「忘了存」的痛點）— 先行注入(isPartial)時不儲存，避免覆蓋對話框跳兩次
      if (!isPartial && typeof window._motivAutoSaveAfterSync === 'function') {
        try{ window._motivAutoSaveAfterSync(); }catch(e){}
      }
    },
    args: [academyData, salesData, groupData || [], reserveData || [], { year: year, month: month }, timeStr, checkinData || null, perfPData || null, channelData || null, !!isPartial]
  });
}

// ── 主要同步流程 ──
async function doSync(){
  var btn = document.getElementById('btnSync');
  btn.disabled = true;
  btn.textContent = '⏳ 同步中...';
  document.getElementById('result').innerHTML = '';

  var year = document.getElementById('selYear').value;
  var month = document.getElementById('selMonth').value;

  try {
    console.log('[EIP popup] ★ 同步開始 year=' + year + ' month=' + month);
    // 1. 學院排名（★ 加 btnq=查詢，強制 EIP 用我們傳的月份）
    setStatus('⏳ 正在同步學院排名...');
    var aUrl = 'http://eip.appedu.com.tw/class/report/performance/performance_at.php?q1=' + year + '&q2=' + month + '&q3=&btnq=%E6%9F%A5%E8%A9%A2';
    console.log('[EIP popup] 學院 URL:', aUrl);
    var aHtml = await fetchEipPage(aUrl);
    var academyData = extractAcademyDirect(aHtml);

    if (academyData.length <= 1){
      aUrl = aUrl.replace('q3=&', 'q3=0&');
      console.log('[EIP popup] 學院 fallback URL:', aUrl);
      aHtml = await fetchEipPage(aUrl);
      academyData = extractAcademyDirect(aHtml);
    }

    // 2. 業務排名
    setStatus('⏳ 正在同步業務排名...');
    var sUrl = 'http://eip.appedu.com.tw/working/report/performance/performance_p.php?q1=' + year + '&q2=' + month + '&q3=&q4=&q5=&btnq=%E6%9F%A5%E8%A9%A2';
    var sHtml = await fetchEipPage(sUrl);
    var salesData = extractSalesDirect(sHtml);

    if (salesData.length <= 1){
      sUrl = 'http://eip.appedu.com.tw/working/report/performance/performance_p.php?q1=' + year + '&q2=' + month + '&q3=0&q4=&q5=&btnq=%E6%9F%A5%E8%A9%A2';
      sHtml = await fetchEipPage(sUrl);
      salesData = extractSalesDirect(sHtml);
    }

    // 3. 正式小組績效表（performance_d.php）
    setStatus('⏳ 正在同步正式小組績效表...');
    var gUrl = 'http://eip.appedu.com.tw/working/report/performance/performance_d.php?q1=' + year + '&q2=' + month + '&q3=&btnq=%E6%9F%A5%E8%A9%A2';
    var gHtml = await fetchEipPage(gUrl);
    var groupData = extractGroupPerformance(gHtml);

    // 4. 儲備小組績效表（performance_d2.php，結構同上，重用 parser）
    setStatus('⏳ 正在同步儲備小組績效表...');
    var rUrl = 'http://eip.appedu.com.tw/working/report/performance/performance_d2.php?q1=' + year + '&q2=' + month + '&q3=&btnq=%E6%9F%A5%E8%A9%A2';
    var rHtml = await fetchEipPage(rUrl);
    var reserveData = extractGroupPerformance(rHtml);

    // ★ v5.2：核心資料（學院/業務/小組）抓完先立即注入頁面，避免後面慢活拖久 / popup 被關掉導致學院排名沒更新
    setStatus('⏳ 學院/業務/小組已更新，繼續同步報到與通路績效...');
    try {
      await injectData(academyData, salesData, groupData, reserveData, year, month, null, null, null, true);
    } catch(e){ console.warn('[EIP] 核心資料先行注入失敗: ' + e.message); }

    // 5. ★ v4.9：報到統計（已報到/網路/到月底）
    var checkinData = null;
    try { checkinData = await fetchCheckin(year, month); }
    catch(e){ console.warn('[EIP] 報到統計失敗: ' + e.message); }

    // 6. ★ v4.9：七學院個人績效
    var perfPData = null;
    try { perfPData = await fetchPerfP(year, month); }
    catch(e){ console.warn('[EIP] 個人績效失敗: ' + e.message); }
    var perfPTotal = 0;
    if (perfPData){ for (var po in perfPData.orgs) perfPTotal += perfPData.orgs[po].length; }

    // 7. ★ v5.0：收支明細 → 各通路績效
    var channelData = null;
    try {
      var moneyRows = await fetchMoneyRows(year, month);
      channelData = computeChannels(moneyRows, perfPData, year, month);
    } catch(e){ console.warn('[EIP] 各通路績效失敗: ' + e.message); }

    // 8. 注入
    setStatus('⏳ 正在寫入激勵排行榜...');
    await injectData(academyData, salesData, groupData, reserveData, year, month, checkinData, perfPData, channelData);

    setStatus('✅ 同步完成！學院 ' + academyData.length + ' 筆、業務 ' + salesData.length + ' 筆、正式小組 ' + groupData.length + ' 組、儲備小組 ' + reserveData.length + ' 組'
      + (checkinData ? '、報到 ' + checkinData.formal.total + '/' + checkinData.net.total + '/' + checkinData.rs.total : '、報到失敗')
      + (perfPData ? '、個人績效 ' + perfPTotal + ' 人' : '、個人績效失敗')
      + (channelData ? '、通路績效 ✓' : '、通路績效失敗'), 'ok');
    showResult(academyData, salesData, groupData, reserveData, checkinData, perfPData, perfPTotal, channelData);

  } catch(err){
    console.error('[EIP] 同步失敗:', err);
    var msg = err.message || String(err);
    if (msg.indexOf('Failed to fetch') >= 0) setStatus('❌ 無法連線 EIP — 請確認已登入且網路正常', 'err');
    else if (msg.indexOf('401') >= 0 || msg.indexOf('403') >= 0) setStatus('❌ 請先登入 EIP 系統再試', 'err');
    else setStatus('❌ ' + msg, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 同步資料';
  }
}

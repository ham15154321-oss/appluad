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

function showResult(academy, sales){
  var el = document.getElementById('result');
  el.innerHTML =
    '<div class="result-item"><span class="label">🏫 學院排名</span><span class="count">' + academy.length + ' 筆</span></div>' +
    '<div class="result-item"><span class="label">👤 業務排名</span><span class="count">' + sales.length + ' 筆</span></div>';
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

    if (firstTd.getAttribute('rowspan')){
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

// ── 注入資料到目前開啟的頁面 ──
async function injectData(academyData, salesData){
  var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || tabs.length === 0) throw new Error('找不到目前頁面');

  var now = new Date();
  var timeStr = now.getFullYear() + '/' + (now.getMonth()+1) + '/' + now.getDate()
    + ' ' + now.getHours() + ':' + String(now.getMinutes()).padStart(2,'0');

  await chrome.scripting.executeScript({
    target: { tabId: tabs[0].id },
    func: function(academy, sales, updateTime){
      var cid = '';
      try { var aid = localStorage.getItem('activeCharacterId'); if(aid) cid = 'char_' + aid + '_'; } catch(e){}

      localStorage.setItem(cid + 'motiv_academy_v1', JSON.stringify(academy));
      localStorage.setItem(cid + 'motiv_sales_v1', JSON.stringify(sales));
      localStorage.setItem(cid + 'motiv_updated_at', updateTime);

      if (window._motivAcademy !== undefined) window._motivAcademy = academy;
      if (window._motivSales !== undefined) window._motivSales = sales;
      if (typeof window.motivRenderAll === 'function') window.motivRenderAll();
    },
    args: [academyData, salesData, timeStr]
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
    // 1. 學院排名
    setStatus('⏳ 正在同步學院排名...');
    var aUrl = 'http://eip.appedu.com.tw/class/report/performance/performance_at.php?q1=' + year + '&q2=' + month + '&q3=';
    var aHtml = await fetchEipPage(aUrl);
    var academyData = extractAcademyDirect(aHtml);

    if (academyData.length <= 1){
      aUrl += '0';
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

    // 3. 注入
    setStatus('⏳ 正在寫入激勵排行榜...');
    await injectData(academyData, salesData);

    setStatus('✅ 同步完成！學院 ' + academyData.length + ' 筆、業務 ' + salesData.length + ' 筆', 'ok');
    showResult(academyData, salesData);

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

/* ═══════════════════════════════════════════════
   Appedu EIP 激勵同步 — Chrome Extension Popup
   Manifest V3：所有事件用 addEventListener 綁定
   v2: 修正 rowspan 偏移問題
   ═══════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', function(){

  // ── 初始化年月選單 ──
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

  // ── 綁定同步按鈕 ──
  document.getElementById('btnSync').addEventListener('click', doSync);
});

// ── 狀態顯示 ──
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
  console.log('[EIP Sync] 抓取:', url);
  var resp = await fetch(url, { credentials: 'include' });
  if (!resp.ok) throw new Error('HTTP ' + resp.status + ' — 可能未登入 EIP');
  var buf = await resp.arrayBuffer();

  // EIP 系統可能用 Big5 或 UTF-8，兩者都試
  var textBig5 = '', textUtf8 = '';
  try { textBig5 = new TextDecoder('big5').decode(buf); } catch(e){}
  try { textUtf8 = new TextDecoder('utf-8').decode(buf); } catch(e){}

  // 用能找到中文關鍵字的那個
  if (textUtf8.indexOf('學院') >= 0 || textUtf8.indexOf('姓名') >= 0 || textUtf8.indexOf('業績') >= 0){
    console.log('[EIP Sync] 使用 UTF-8 解碼');
    return textUtf8;
  }
  if (textBig5.indexOf('學院') >= 0 || textBig5.indexOf('姓名') >= 0 || textBig5.indexOf('業績') >= 0){
    console.log('[EIP Sync] 使用 Big5 解碼');
    return textBig5;
  }
  console.warn('[EIP Sync] 無法偵測編碼，回傳 UTF-8');
  return textUtf8 || textBig5;
}

// ── 解析 HTML 表格（v2: 處理 rowspan 偏移） ──
function parseTable(html){
  var doc = new DOMParser().parseFromString(html, 'text/html');
  var tables = doc.querySelectorAll('table');
  console.log('[EIP Sync] 找到 ' + tables.length + ' 個 table');

  // 找最大的 table（通常是資料表）
  var bestTable = null;
  var bestRows = 0;
  tables.forEach(function(t){
    var rc = t.querySelectorAll('tr').length;
    if (rc > bestRows){ bestRows = rc; bestTable = t; }
  });
  if (!bestTable){
    console.warn('[EIP Sync] 未找到任何 table');
    return { headers: [], rows: [] };
  }

  var allRows = bestTable.querySelectorAll('tr');
  var headers = [];
  var dataRows = [];

  // 找表頭（第一列的 th 或 td）
  var headerRow = allRows[0];
  if (headerRow){
    headerRow.querySelectorAll('th, td').forEach(function(cell){
      headers.push(cell.textContent.trim());
    });
  }
  var headerCount = headers.length;
  console.log('[EIP Sync] 表頭(' + headerCount + '欄):', headers.join(' | '));

  // ★ 資料列：處理 rowspan 造成的欄位偏移
  // 如果某列的 td 數量比表頭少，代表左側有 rowspan 合併欄位
  // → 在前面補空字串，讓所有列的欄位索引與表頭對齊
  for (var i = 1; i < allRows.length; i++){
    var cells = [];
    allRows[i].querySelectorAll('td').forEach(function(cell){
      cells.push(cell.textContent.trim());
    });
    if (cells.length === 0) continue;

    // 補齊缺少的左側欄位
    var missing = headerCount - cells.length;
    if (missing > 0){
      var padded = [];
      for (var p = 0; p < missing; p++) padded.push('');
      cells = padded.concat(cells);
    }
    dataRows.push(cells);
  }
  console.log('[EIP Sync] 資料列數:', dataRows.length);

  return { headers: headers, rows: dataRows };
}

// ── 從表格提取學院排名資料（v2: 更精確的欄位偵測） ──
function extractAcademyData(parsed){
  var h = parsed.headers;
  var colName = -1, colVal = -1;

  // 精確比對：找「學院」欄和獨立的「業績」欄（非Ⓐ非Ⓑ非小組）
  for (var i = 0; i < h.length; i++){
    var hText = h[i];
    if (hText === '學院' && colName < 0) colName = i;
    if (hText === '業績' && colVal < 0) colVal = i;
  }
  // fallback: 學院欄模糊比對
  if (colName < 0){
    for (var i = 0; i < h.length; i++){
      if (h[i].indexOf('學院') >= 0 && colName < 0) colName = i;
    }
  }
  // fallback: 業績欄模糊比對（排除 Ⓐ Ⓑ 小組）
  if (colVal < 0){
    for (var i = 0; i < h.length; i++){
      if (h[i].indexOf('業績') >= 0
          && h[i].indexOf('Ⓐ') < 0 && h[i].indexOf('Ⓑ') < 0
          && h[i].indexOf('小組') < 0 && h[i].indexOf('個人') < 0){
        colVal = i;
      }
    }
  }
  console.log('[EIP Sync] 學院欄=' + colName + '(' + (h[colName]||'?') + ')' +
              ' 業績欄=' + colVal + '(' + (h[colVal]||'?') + ')');
  if (colName < 0 || colVal < 0) return [];

  var data = [];
  var seenNames = {};
  parsed.rows.forEach(function(row){
    if (row.length <= Math.max(colName, colVal)) return;
    var name = row[colName];
    var valStr = row[colVal].replace(/,/g, '').replace(/\$/g, '').replace(/\s/g, '');
    var val = parseFloat(valStr) || 0;
    // 跳過空名、合計列、區域名（沒有「學院」「部」字樣且值為 0 的）
    if (!name || name === '') return;
    if (name.indexOf('合計') >= 0 || name.indexOf('總計') >= 0 || name.indexOf('小計') >= 0) return;
    if (seenNames[name]) return;
    seenNames[name] = true;
    data.push({ name: name, value: val });
  });
  // ★ 由業績高到低排序
  data.sort(function(a,b){ return b.value - a.value; });
  console.log('[EIP Sync] 學院資料筆數:', data.length);
  if (data.length > 0){
    console.log('[EIP Sync] 前3名:', data.slice(0,3).map(function(d){ return d.name + '=' + d.value; }).join(', '));
  }
  return data;
}

// ── 從表格提取業務排名資料 ──
function extractSalesData(parsed){
  var h = parsed.headers;
  var colName = -1, colVal = -1;

  for (var i = 0; i < h.length; i++){
    if (h[i].indexOf('姓名') >= 0 && colName < 0) colName = i;
    if (h[i].indexOf('合計業績') >= 0) colVal = i;
    if (h[i] === '合計' && colVal < 0) colVal = i;
  }
  // fallback: 找獨立的「業績」
  if (colVal < 0){
    for (var i = 0; i < h.length; i++){
      if (h[i] === '業績' || (h[i].indexOf('業績') >= 0 && h[i].indexOf('Ⓐ') < 0 && h[i].indexOf('Ⓑ') < 0)){
        colVal = i;
      }
    }
  }
  console.log('[EIP Sync] 姓名欄=' + colName + '(' + (h[colName]||'?') + ')' +
              ' 合計業績欄=' + colVal + '(' + (h[colVal]||'?') + ')');
  if (colName < 0 || colVal < 0) return [];

  var data = [];
  parsed.rows.forEach(function(row){
    if (row.length <= Math.max(colName, colVal)) return;
    var name = row[colName];
    var valStr = row[colVal].replace(/,/g, '').replace(/\$/g, '').replace(/\s/g, '');
    var val = parseFloat(valStr) || 0;
    if (!name || name === '') return;
    if (name.indexOf('合計') >= 0 || name.indexOf('總計') >= 0 || name.indexOf('小計') >= 0) return;
    data.push({ name: name, value: val });
  });
  // ★ 由業績高到低排序
  data.sort(function(a,b){ return b.value - a.value; });
  console.log('[EIP Sync] 業務資料筆數:', data.length);
  if (data.length > 0){
    console.log('[EIP Sync] 前3名:', data.slice(0,3).map(function(d){ return d.name + '=' + d.value; }).join(', '));
  }
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
      try {
        var aid = localStorage.getItem('activeCharacterId');
        if (aid) cid = 'char_' + aid + '_';
      } catch(e){}

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
    // 1. 抓學院排名（q3= 空 = 請選擇組織 = 全省）
    setStatus('⏳ 正在抓取學院排名...');
    var academyUrl = 'http://eip.appedu.com.tw/class/report/performance/performance_at.php?q1=' + year + '&q2=' + month + '&q3=';
    var academyHtml = await fetchEipPage(academyUrl);
    var academyParsed = parseTable(academyHtml);
    var academyData = extractAcademyData(academyParsed);

    // 如果抓不到或只有一筆，試 q3=0
    if (academyData.length <= 1){
      console.log('[EIP Sync] 學院資料太少，嘗試 q3=0');
      academyUrl = 'http://eip.appedu.com.tw/class/report/performance/performance_at.php?q1=' + year + '&q2=' + month + '&q3=0';
      academyHtml = await fetchEipPage(academyUrl);
      academyParsed = parseTable(academyHtml);
      academyData = extractAcademyData(academyParsed);
    }

    // 2. 抓業務排名
    setStatus('⏳ 正在抓取業務排名...');
    var salesUrl = 'http://eip.appedu.com.tw/working/report/performance/performance_p.php?q1=' + year + '&q2=' + month + '&q3=&q4=&q5=&btnq=%E6%9F%A5%E8%A9%A2';
    var salesHtml = await fetchEipPage(salesUrl);
    var salesParsed = parseTable(salesHtml);
    var salesData = extractSalesData(salesParsed);

    if (salesData.length <= 1){
      console.log('[EIP Sync] 業務資料太少，嘗試 q3=0');
      salesUrl = 'http://eip.appedu.com.tw/working/report/performance/performance_p.php?q1=' + year + '&q2=' + month + '&q3=0&q4=&q5=&btnq=%E6%9F%A5%E8%A9%A2';
      salesHtml = await fetchEipPage(salesUrl);
      salesParsed = parseTable(salesHtml);
      salesData = extractSalesData(salesParsed);
    }

    // 3. 注入到目前頁面
    setStatus('⏳ 正在寫入激勵排行榜...');
    await injectData(academyData, salesData);

    // 4. 完成
    setStatus('✅ 同步完成！學院 ' + academyData.length + ' 筆、業務 ' + salesData.length + ' 筆', 'ok');
    showResult(academyData, salesData);

  } catch(err){
    console.error('[EIP Sync] 同步失敗:', err);
    var msg = err.message || String(err);
    if (msg.indexOf('Failed to fetch') >= 0){
      setStatus('❌ 無法連線 EIP — 請確認已登入且網路正常', 'err');
    } else if (msg.indexOf('401') >= 0 || msg.indexOf('403') >= 0){
      setStatus('❌ 請先登入 EIP 系統再試', 'err');
    } else {
      setStatus('❌ ' + msg, 'err');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 同步資料';
  }
}

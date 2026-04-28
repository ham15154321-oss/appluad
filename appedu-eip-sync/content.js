/* ═══════════════════════════════════════════════
   Appedu EIP 激勵同步 — Content Script
   v4: 直接索引法 + postMessage 通訊

   在頁面中執行，監聽「同步資料」按鈕
   流程：頁面 postMessage → content script → background fetch → 解析 → 寫入 localStorage → 回傳結果
   ═══════════════════════════════════════════════ */

(function(){
  'use strict';

  // ── 監聯頁面同步請求 + ping/pong ──
  window.addEventListener('message', function(e){
    if (!e.data || e.data.channel !== 'appedu-eip-sync') return;
    // Ping → Pong（偵測 content script 是否可用）
    if (e.data.action === 'ping'){
      window.postMessage({ channel: 'appedu-eip-sync', action: 'pong' }, '*');
      return;
    }
    if (e.data.action !== 'request') return;
    var year = e.data.year || new Date().getFullYear();
    var month = e.data.month || String(new Date().getMonth() + 1).padStart(2, '0');
    console.log('[EIP Content] 收到同步請求 year=' + year + ' month=' + month);
    doSync(year, month);
  });

  // ── 回傳結果給頁面 ──
  function notify(type, data){
    var msg = Object.assign({ channel: 'appedu-eip-sync', action: 'result', type: type }, data || {});
    window.postMessage(msg, '*');
  }

  // ── 透過 background fetch ──
  function fetchViaBackground(url){
    return new Promise(function(resolve, reject){
      chrome.runtime.sendMessage({ action: 'fetchEip', url: url }, function(resp){
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!resp || !resp.ok) return reject(new Error(resp ? resp.error : '無回應'));
        resolve(resp.html);
      });
    });
  }

  // ══════════════════════════════════════
  //  直接子元素工具
  // ══════════════════════════════════════
  function getDirectChildren(parent, tagName){
    var r = [], kids = parent.children;
    for (var i = 0; i < kids.length; i++){
      if (kids[i].tagName === tagName) r.push(kids[i]);
    }
    return r;
  }

  function getDirectRows(table){
    var rows = [];
    var heads = getDirectChildren(table, 'THEAD');
    var bodies = getDirectChildren(table, 'TBODY');
    heads.forEach(function(h){ rows = rows.concat(getDirectChildren(h, 'TR')); });
    bodies.forEach(function(b){ rows = rows.concat(getDirectChildren(b, 'TR')); });
    if (rows.length === 0) rows = getDirectChildren(table, 'TR');
    return rows;
  }

  function getDirectCells(tr){
    var cells = [], kids = tr.children;
    for (var i = 0; i < kids.length; i++){
      if (kids[i].tagName === 'TD' || kids[i].tagName === 'TH') cells.push(kids[i]);
    }
    return cells;
  }

  // ══════════════════════════════════════
  //  找含「學院」+「業績」的主資料表格
  // ══════════════════════════════════════
  function findDataTable(doc){
    var tables = doc.querySelectorAll('table');
    for (var t = 0; t < tables.length; t++){
      var rows = getDirectRows(tables[t]);
      if (rows.length < 2) continue;
      var headerText = rows[0].textContent;
      if (headerText.indexOf('學院') >= 0 && headerText.indexOf('業績') >= 0) return tables[t];
    }
    var best = null, bestCount = 0;
    for (var t = 0; t < tables.length; t++){
      var c = getDirectRows(tables[t]).length;
      if (c > bestCount){ bestCount = c; best = tables[t]; }
    }
    return best;
  }

  // ══════════════════════════════════════
  //  ★ 學院排名（v4 直接索引法）
  //
  //  EIP 表格結構：
  //  Header 17 欄，但「小組個人業績Ⓐ」(col15) 沒有 td
  //
  //  型態 A（有 rowspan 區域）：
  //    td[0]=區域, td[1]=學院, td[12]=業績
  //
  //  型態 B（無區域 td）：
  //    td[0]=學院, td[11]=業績
  // ══════════════════════════════════════
  function extractAcademyDirect(html){
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var table = findDataTable(doc);
    if (!table) return [];

    var rows = getDirectRows(table);
    var data = [], seenNames = {};

    for (var i = 1; i < rows.length; i++){
      var allCells = getDirectCells(rows[i]);
      var tdOnly = [];
      for (var c = 0; c < allCells.length; c++){
        if (allCells[c].tagName === 'TD') tdOnly.push(allCells[c]);
      }
      if (tdOnly.length < 5) continue;

      var firstTd = tdOnly[0];
      var firstText = firstTd.textContent.trim();

      if (firstText.indexOf('合計') >= 0 || firstText.indexOf('總計') >= 0 || firstText.indexOf('小計') >= 0) continue;
      if (firstTd.getAttribute('colspan')) continue;

      var name, valStr;

      if (firstTd.getAttribute('rowspan')){
        // 型態 A：td[1]=學院, td[12]=業績
        if (tdOnly.length < 13) continue;
        name = tdOnly[1].textContent.trim();
        valStr = tdOnly[12].textContent.trim();
      } else {
        // 型態 B：td[0]=學院, td[11]=業績
        if (tdOnly.length < 12) continue;
        name = tdOnly[0].textContent.trim();
        valStr = tdOnly[11].textContent.trim();
      }

      valStr = valStr.replace(/,/g, '').replace(/\$/g, '').replace(/\s/g, '');
      var val = parseFloat(valStr) || 0;

      if (!name) continue;
      if (/^[\d.,\s]+$/.test(name)) continue;
      if (name.indexOf('合計') >= 0 || name.indexOf('總計') >= 0 || name.indexOf('小計') >= 0) continue;
      if (seenNames[name]) continue;
      seenNames[name] = true;
      data.push({ name: name, value: val });
    }

    data.sort(function(a, b){ return b.value - a.value; });
    console.log('[EIP Content] 學院: ' + data.length + ' 筆');
    return data;
  }

  // ══════════════════════════════════════
  //  業務排名
  // ══════════════════════════════════════
  function extractSalesDirect(html){
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var tables = doc.querySelectorAll('table');
    var table = null;
    for (var t = 0; t < tables.length; t++){
      var rows = getDirectRows(tables[t]);
      if (rows.length < 2) continue;
      if (rows[0].textContent.indexOf('姓名') >= 0){ table = tables[t]; break; }
    }
    if (!table){
      var best = null, bc = 0;
      for (var t = 0; t < tables.length; t++){
        var c = getDirectRows(tables[t]).length;
        if (c > bc){ bc = c; best = tables[t]; }
      }
      table = best;
    }
    if (!table) return [];

    var rows = getDirectRows(table);
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
        if (txt === '業績' || (txt.indexOf('業績') >= 0 && txt.indexOf('Ⓐ') < 0 && txt.indexOf('Ⓑ') < 0)) colVal = c;
      }
    }
    if (colName < 0 || colVal < 0) return [];

    var data = [];
    for (var i = 1; i < rows.length; i++){
      var allCells = getDirectCells(rows[i]);
      var tdOnly = [];
      for (var c = 0; c < allCells.length; c++){
        if (allCells[c].tagName === 'TD') tdOnly.push(allCells[c]);
      }
      if (tdOnly.length <= Math.max(colName, colVal)) continue;

      var offset = 0;
      if (tdOnly[0].getAttribute('rowspan')) offset = 0;
      else if (tdOnly[0].getAttribute('colspan')) continue;
      else if (tdOnly.length < headerCells.length) offset = -1;

      var ni = colName + offset, vi = colVal + offset;
      if (ni < 0 || vi < 0 || ni >= tdOnly.length || vi >= tdOnly.length) continue;

      var name = tdOnly[ni].textContent.trim();
      var valStr = tdOnly[vi].textContent.trim().replace(/,/g, '').replace(/\$/g, '').replace(/\s/g, '');
      var val = parseFloat(valStr) || 0;
      if (!name) continue;
      if (name.indexOf('合計') >= 0 || name.indexOf('總計') >= 0 || name.indexOf('小計') >= 0) continue;
      data.push({ name: name, value: val });
    }
    data.sort(function(a, b){ return b.value - a.value; });
    return data;
  }

  // ══════════════════════════════════════
  //  主要同步流程
  // ══════════════════════════════════════
  async function doSync(year, month){
    try {
      notify('status', { msg: '正在同步學院排名...' });

      var aUrl = 'http://eip.appedu.com.tw/class/report/performance/performance_at.php?q1=' + year + '&q2=' + month + '&q3=';
      var aHtml = await fetchViaBackground(aUrl);
      var academyData = extractAcademyDirect(aHtml);

      if (academyData.length <= 1){
        aUrl += '0';
        aHtml = await fetchViaBackground(aUrl);
        academyData = extractAcademyDirect(aHtml);
      }

      notify('status', { msg: '正在同步業務排名...' });
      var sUrl = 'http://eip.appedu.com.tw/working/report/performance/performance_p.php?q1=' + year + '&q2=' + month + '&q3=&q4=&q5=&btnq=%E6%9F%A5%E8%A9%A2';
      var sHtml = await fetchViaBackground(sUrl);
      var salesData = extractSalesDirect(sHtml);

      if (salesData.length <= 1){
        sUrl = sUrl.replace('q3=&', 'q3=0&');
        sHtml = await fetchViaBackground(sUrl);
        salesData = extractSalesDirect(sHtml);
      }

      // 寫入 localStorage
      var cid = '';
      try { var aid = localStorage.getItem('activeCharacterId'); if (aid) cid = 'char_' + aid + '_'; } catch(e){}

      var now = new Date();
      var timeStr = now.getFullYear() + '/' + (now.getMonth()+1) + '/' + now.getDate()
        + ' ' + now.getHours() + ':' + String(now.getMinutes()).padStart(2,'0');

      localStorage.setItem(cid + 'motiv_academy_v1', JSON.stringify(academyData));
      localStorage.setItem(cid + 'motiv_sales_v1', JSON.stringify(salesData));
      localStorage.setItem(cid + 'motiv_updated_at', timeStr);

      notify('done', {
        academy: academyData,
        sales: salesData,
        updateTime: timeStr,
        msg: '同步完成！學院 ' + academyData.length + ' 筆、業務 ' + salesData.length + ' 筆'
      });

    } catch(err){
      console.error('[EIP Content] 同步失敗:', err);
      var msg = err.message || String(err);
      if (msg.indexOf('Failed to fetch') >= 0 || msg.indexOf('NetworkError') >= 0) msg = '無法連線 EIP — 請確認已登入且網路正常';
      notify('error', { msg: msg });
    }
  }

  console.log('[EIP Content] ✅ v4 已載入');
})();

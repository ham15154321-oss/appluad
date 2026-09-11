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
    var mode = e.data.mode || 'motiv';
    if (e.data.region && mode === 'trial') mode = 'trial:' + e.data.region;
    if (mode === 'funnel' && e.data.full) mode = 'funnel:full';
    console.log('[EIP Content] 收到同步請求 year=' + year + ' month=' + month + ' mode=' + mode);
    doSync(year, month, mode);
  });

  // ── 回傳結果給頁面 ──
  function notify(type, data){
    var msg = Object.assign({ channel: 'appedu-eip-sync', action: 'result', type: type }, data || {});
    window.postMessage(msg, '*');
  }

  // ── EIP 請求之間的節流間隔（避免一次對 EIP 灌爆，預設 0.4 秒） ──
  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
  var EIP_THROTTLE_MS = 1000;
  // ★ v5.13：網頁版分頁 fallback 專用節流 — 這是唯一「逐頁連打」EIP 的流程，
  //   刻意放慢到 0.8 秒/頁，把對 EIP 的壓力降到最低（使用者可接受跑久一點）。
  var HTML_PAGE_THROTTLE_MS = 1200;

  // ── 透過 background fetch（單次，不含重試）──
  function _fetchOnce(url){
    return new Promise(function(resolve, reject){
      chrome.runtime.sendMessage({ action: 'fetchEip', url: url }, function(resp){
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!resp || !resp.ok) return reject(new Error(resp ? resp.error : '無回應'));
        resolve(resp.html);
      });
    });
  }
  // ── 透過 background fetch（★ v5.13：加逾時 + 重試）──
  //   MV3 service worker 在連續請求的空檔會被 Chrome 休眠，偶爾把回應「掉包」→
  //   sendMessage 的 callback 永遠不觸發、整條同步吊死。解法：每次請求給 35 秒逾時，
  //   逾時就重發（重發會把睡著的 SW 喚醒）。最多試 3 次，仍失敗才真的報錯。
  // ★ 對 EIP 的總閘門：所有請求都經過這裡，強制「任兩個請求之間至少隔 EIP_MIN_GAP_MS」。
  //   各流程本身還有自己的節流（漏斗 2 秒/頁等），這道閘只是防止任何新程式碼不小心連發。
  var EIP_MIN_GAP_MS = 800, _eipLastAt = 0, _eipGate = Promise.resolve();
  function _eipGateWait(){
    _eipGate = _eipGate.then(async function(){
      var wait = EIP_MIN_GAP_MS - (Date.now() - _eipLastAt);
      if (wait > 0) await sleep(wait);
      _eipLastAt = Date.now();
    });
    return _eipGate;
  }
  function fetchViaBackground(url){
    var MAX_TRY = 3, TIMEOUT_MS = 35000;
    async function attempt(n){
      await _eipGateWait();          // ← 每一個請求都先過閘
      try {
        return await new Promise(function(resolve, reject){
          var done = false;
          var timer = setTimeout(function(){
            if (!done){ done = true; reject(new Error('__TIMEOUT__')); }
          }, TIMEOUT_MS);
          _fetchOnce(url).then(function(html){
            if (!done){ done = true; clearTimeout(timer); resolve(html); }
          }, function(err){
            if (!done){ done = true; clearTimeout(timer); reject(err); }
          });
        });
      } catch(e){
        var msg = (e && e.message) || '';
        // 逾時、SW 掉包、背景 abort、context invalidated → 還有次數就重試
        if (n < MAX_TRY && (msg === '__TIMEOUT__' || msg.indexOf('逾時') >= 0 || msg.indexOf('message channel') >= 0 || msg.indexOf('無回應') >= 0 || msg.indexOf('Receiving end') >= 0)){
          var backoff = n === 1 ? 3000 : 8000;   // 3 秒 → 8 秒（EIP 忙的時候要讓它喘，不是連敲）
          console.warn('[EIP Content] 背景請求第 ' + n + ' 次無回應，' + (backoff/1000) + ' 秒後重試...');
          await sleep(backoff);
          return attempt(n + 1);
        }
        if (msg === '__TIMEOUT__') throw new Error('EIP 背景請求逾時（' + MAX_TRY + ' 次都沒回應）— 請重新整理本頁再試');
        throw e;
      }
    }
    return attempt(1);
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
    console.log('[EIP Content] 學院表頭定位: 學院欄=' + colAcad + ' 業績欄=' + colVal + ' 區域=' + hasRegion + (headerBased ? '' : '（找不到，退回固定索引）'));

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

      if (headerBased){
        // 型態 B（無區域 td、被 rowspan 合併）整列往左移 1 格
        var offset = (hasRegion && !firstTd.getAttribute('rowspan')) ? -1 : 0;
        var ni = colAcad + offset, vi = colVal + offset;
        if (ni < 0 || vi < 0 || ni >= tdOnly.length || vi >= tdOnly.length) continue;
        name = tdOnly[ni].textContent.trim();
        valStr = tdOnly[vi].textContent.trim();
      } else if (firstTd.getAttribute('rowspan')){
        // 舊邏輯型態 A：td[1]=學院, td[12]=業績
        if (tdOnly.length < 13) continue;
        name = tdOnly[1].textContent.trim();
        valStr = tdOnly[12].textContent.trim();
      } else {
        // 舊邏輯型態 B：td[0]=學院, td[11]=業績
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
  //  ★ 正式小組績效表（performance_d.php）
  //  表格結構：<table id="performances">
  //  每列 14 個 td：
  //    td[0]=名次, td[1]=學院, td[2]=正式組別, td[3]=總業績,
  //    td[4]=組長, td[5]=組長業績,
  //    td[6]=組員1, td[7]=組員1業績,
  //    td[8]=組員2, td[9]=組員2業績,
  //    td[10]=組員3, td[11]=組員3業績,
  //    td[12]=組員4, td[13]=組員4業績
  // ══════════════════════════════════════
  function extractGroupPerformance(html){
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var table = doc.getElementById('performances');
    if (!table){
      // fallback：找含「正式組別」標頭的 table
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

    function clean(s){
      return String(s || '').trim();
    }
    function num(s){
      var x = clean(s).replace(/,/g, '').replace(/\$/g, '').replace(/\s/g, '');
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

      // 組員：tds[6..13]，每兩個一組
      var members = [];
      for (var m = 6; m + 1 < tds.length; m += 2){
        var nm = clean(tds[m].textContent);
        var v = num(tds[m+1].textContent);
        if (nm) members.push({ name: nm, value: v });
      }

      data.push({
        rank: rank,
        academy: academy,
        groupName: groupName,
        total: total,
        leader: leader,
        members: members
      });
    }

    // EIP 已按總業績排序，但保險再排一次
    data.sort(function(a, b){ return (b.total || 0) - (a.total || 0); });
    console.log('[EIP Content] 正式小組: ' + data.length + ' 組');
    return data;
  }

  // ══════════════════════════════════════
  //  ★ v4.8 新增：個人績效表（performance_p.php）
  //  頁面內嵌 perfRows = {...} JSON，直接抽出來解析
  // ══════════════════════════════════════
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
    try { return JSON.parse(html.slice(s, j)); } catch(e){ console.warn('[EIP Content] perfRows JSON 解析失敗', e); return null; }
  }

  var PERF_ORG_NAMES = PERF_ORGS.map(function(o){ return o.name; });

  // ★ v5.5：從「全學院 performance_p」那一頁的 perfRows 直接分組出七學院個人績效
  //   不用再分七次打 EIP（11→4 個請求），perfRows 內每筆都帶 hr_organize_name
  function perfPFromAllOrg(html, year, month){
    var result = { orgs: {}, meta: { year: year, month: month } };
    PERF_ORG_NAMES.forEach(function(n){ result.orgs[n] = []; });
    var rows = extractPerfRows(html);
    if (!rows) return null;
    var total = 0;
    for (var key in rows){
      if (!rows.hasOwnProperty(key)) continue;
      var r = rows[key];
      var org = r.hr_organize_name || '';
      if (result.orgs[org]){ result.orgs[org].push(r); total++; }
    }
    var got = PERF_ORG_NAMES.filter(function(n){ return result.orgs[n].length > 0; }).length;
    console.log('[EIP Content] 個人績效（單頁分組）: ' + total + ' 人，涵蓋 ' + got + '/7 學院');
    return { data: result, total: total, covered: got };
  }

  // 備援：逐學院抓（只有單頁分組失敗時才用，含節流）
  async function fetchPerfPPerOrg(year, month){
    var result = { orgs: {}, meta: { year: year, month: month } };
    for (var k = 0; k < PERF_ORGS.length; k++){
      var org = PERF_ORGS[k];
      if (k > 0) await sleep(EIP_THROTTLE_MS);
      notify('status', { msg: '正在補抓個人績效 ' + org.name + ' (' + (k+1) + '/' + PERF_ORGS.length + ')...' });
      var url = 'http://eip.appedu.com.tw/working/report/performance/performance_p.php?q1=' + year + '&q2=' + month + '&q3=' + org.id + '&q4=&q5=&btnq=%E6%9F%A5%E8%A9%A2';
      try {
        var rows = extractPerfRows(await fetchViaBackground(url));
        var arr = [];
        if (rows){ for (var key in rows){ if (rows.hasOwnProperty(key)) arr.push(rows[key]); } }
        result.orgs[org.name] = arr;
      } catch(e){ result.orgs[org.name] = []; }
    }
    return result;
  }

  // ══════════════════════════════════════
  //  ★ v4.8 新增：通路名單報到統計（total_csv.php 優先 / total.php 分頁備援）
  //  回傳 { byKey: {'學院|承辦人': n}, byAcademy: {學院: n}, total: n }
  // ══════════════════════════════════════
  function buildTotalQuery(params){
    var defaults = { q1:'',q2:'',q3:'',q4:'',q26:'',q27:'',q28:'',q29:'',q5:'',q6:'',q7:'',q8:'',q16:'',q23:'',q24:'',scn:'',ecn:'',q9:'',q25:'',q10:'',q11:'',q12:'',q20:'',q21:'',q22:'',q13:'',q14:'',q15:'',q17:'',q18:'',q19:'0' };
    for (var k in params) defaults[k] = params[k];
    var parts = [];
    for (var key in defaults) parts.push(key + '=' + encodeURIComponent(defaults[key]));
    return parts.join('&');
  }

  // 簡易但完整的 CSV 解析（支援引號、逗號、換行）
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
    // 找含「學院」+「承辦人」的標頭列
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

  // ★ v5.12：CSV 抓取加「重試 + 分辨未登入/忙線」
  //   EIP 在連續請求後（報到按鈕會先跑完激勵的 8+ 次請求）常回一頁 HTML，
  //   舊版直接報「未登入或忙線」讓人以為要重新登入。現在：
  //   ① 回傳頁面含登入表單特徵 → 明確說「請重新登入」，不重試
  //   ② 其他 HTML（忙線/逾時頁）→ 等 2 秒、5 秒各重試一次，多半第二次就成功
  function _looksLikeHtml(t){ return !t || t.indexOf('<html') >= 0 || t.indexOf('<!DOCTYPE') >= 0; }
  function _looksLikeLogin(t){
    if (!t) return false;
    var s = String(t);
    return /登入|登錄|帳號|密碼|password|name=["']?(user|account|pwd|passwd)/i.test(s) && s.indexOf('學院') < 0;
  }
  // ★ v5.13：從一頁 HTML 抽出名單列（學院/承辦人 + 整列指紋）→ 給分頁去重用
  function _listRowsFromHtml(html){
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var tables = doc.querySelectorAll('table');
    var table = null, idxAcad = -1, idxOwner = -1, idxSrc = -1;
    for (var t = 0; t < tables.length; t++){
      var rows = getDirectRows(tables[t]);
      if (rows.length < 1) continue;
      var ths = getDirectCells(rows[0]);
      var ia = -1, io = -1, isr = -1;
      for (var c = 0; c < ths.length; c++){
        var h = ths[c].textContent.trim();
        if (ia < 0 && h === '學院') ia = c;
        if (io < 0 && h === '承辦人') io = c;
        if (isr < 0 && h.indexOf('通路來源') >= 0) isr = c;   // 「通路來源(副)」→ 推算網路已報到用
      }
      if (ia >= 0 && io >= 0){ table = tables[t]; idxAcad = ia; idxOwner = io; idxSrc = isr; break; }
    }
    if (!table) return null; // 連名單表都沒有 → 可能無權/登入頁，交給呼叫端判斷
    var out = [];
    var trs = getDirectRows(table);
    for (var i = 1; i < trs.length; i++){
      var tds = getDirectCells(trs[i]);
      if (tds.length <= Math.max(idxAcad, idxOwner)) continue;
      var acad = tds[idxAcad].textContent.trim();
      var owner = tds[idxOwner].textContent.trim();
      var sig = trs[i].textContent.replace(/\s+/g, '').slice(0, 60);
      out.push({ academy: acad, owner: owner, sig: sig,
                 src: (idxSrc >= 0 && tds.length > idxSrc) ? tds[idxSrc].textContent.replace(/\s+/g, ' ').trim() : null });
    }
    return out;
  }

  // ★ v5.13：CSV 被擋時的 fallback — 用「網頁版名單 total.php + pg 分頁」抓完整名單。
  //   權限說明：CSV 匯出(total_csv.php)的權限被關，但網頁版名單(total.php)使用者本人仍有權開啟，
  //   所以這是「用使用者自己的權限、模擬人工翻頁」，不是繞過權限。
  //   安全機制：節流 400ms/頁、去重（同一列不重複算）、遇空頁或無新資料即停、上限 80 頁。
  async function fetchListCountsViaHtml(params, label, info){
    info = info || {};
    info.via = '網頁分頁'; info.pages = 0; info.capped = false;
    var counts = emptyCounts();
    var seen = {};
    var MAX_PAGES = 80;
    var got1stTable = false;
    // ★ v5.14→v5.15：keepalive 改「content 端主動敲」。
    //   content.js 跑在頁面裡永遠不會被休眠 → 由它每 12 秒送一個輕量 ping，
    //   讓 Chrome 一直看到有訊息進來、不把背景 service worker 回收（比背景自己敲可靠）。
    var kaTimer = setInterval(function(){
      try { chrome.runtime.sendMessage({ action: 'keepalive' }, function(){ void chrome.runtime.lastError; }); } catch(e){}
    }, 12000);
    try {
    for (var pg = 1; pg <= MAX_PAGES; pg++){
      if (pg > 1) await sleep(HTML_PAGE_THROTTLE_MS);
      var over = {}; for (var k in params) over[k] = params[k];
      over.pg = String(pg);
      var url = 'http://eip.appedu.com.tw/outlet/list/total.php?' + buildTotalQuery(over);
      var html = await fetchViaBackground(url);
      if (/無權|沒有權限|權限不足/.test(String(html))){
        throw new Error(label + '：EIP 回覆「您無權進入此頁」— 你的帳號連「通路名單網頁版」也沒有權限。請找 EIP 管理員開通（CSV 與網頁版皆被關）');
      }
      var rows = _listRowsFromHtml(html);
      if (rows === null){
        if (_looksLikeLogin(html)) throw new Error(label + '：EIP 顯示登入頁 — 請在瀏覽器重新登入 EIP 後再同步');
        if (pg === 1) throw new Error(label + '：EIP 網頁版沒有名單表格 — 可能忙線，請稍後再試');
        break; // 後面頁數拿不到表格 → 當作結束
      }
      got1stTable = true;
      info.pages = pg;
      var added = 0;
      for (var i = 0; i < rows.length; i++){
        if (seen[rows[i].sig]) continue;      // 去重（保險：pg 超過末頁若回捲也不會重複算）
        seen[rows[i].sig] = 1;
        addCount(counts, rows[i].academy, rows[i].owner);
        if (info.wantRows) (info.rows || (info.rows = [])).push({ academy: rows[i].academy, owner: rows[i].owner, src: rows[i].src });
        added++;
      }
      notify('status', { msg: label + '：網頁版分頁抓取中… 第 ' + pg + ' 頁（累計 ' + counts.total + ' 筆）' });
      if (rows.length === 0 || added === 0) break; // 空頁 or 這頁全是重複 → 結束
      if (pg === MAX_PAGES) info.capped = true;      // 撞到上限＝可能沒抓完，要講出來
    }
    } finally {
      try { clearInterval(kaTimer); } catch(e){}   // 抓完（或出錯）都要停掉 keepalive ping
    }
    if (!got1stTable) return emptyCounts();
    console.log('[EIP Content] ' + label + ' 網頁版分頁: ' + counts.total + ' 筆');
    return counts;
  }

  async function fetchListCounts(params, label, info){
    info = info || {};
    info.via = 'CSV'; info.pages = 1; info.rows = null;
    var qs = buildTotalQuery(params);
    var url = 'http://eip.appedu.com.tw/outlet/list/total_csv.php?' + qs;
    var delays = [0, 2000, 5000];   // 第一次立刻，之後等 2 秒、5 秒
    for (var attempt = 0; attempt < delays.length; attempt++){
      if (delays[attempt]) {
        notify('status', { msg: label + '：EIP 忙線，' + (delays[attempt]/1000) + ' 秒後重試（' + (attempt+1) + '/' + delays.length + '）...' });
        await sleep(delays[attempt]);
      }
      var csv = await fetchViaBackground(url);
      if (!_looksLikeHtml(csv)){
        var counts = countsFromCSV(csv);
        if (!counts) counts = emptyCounts(); // 有 CSV 但解析不出表頭（可能該查詢本月 0 筆）→ 當成 0，不報錯
        console.log('[EIP Content] ' + label + ' CSV: ' + counts.total + ' 筆' + (attempt ? '（第 ' + (attempt+1) + ' 次嘗試成功）' : ''));
        info.tries = attempt + 1;
        return counts;
      }
      // ★ v5.13：CSV 匯出權限被關（「您無權進入此頁」）→ 不重試，直接改用網頁版分頁 fallback。
      if (/無權|沒有權限|權限不足/.test(String(csv))){
        console.warn('[EIP Content] ' + label + ' CSV 無權 → 改用網頁版分頁抓取');
        notify('status', { msg: label + '：CSV 匯出權限已關，改用網頁版分頁抓取（較慢，請稍候）...' });
        return await fetchListCountsViaHtml(params, label, info);
      }
      if (_looksLikeLogin(csv)){
        throw new Error(label + '：EIP 顯示登入頁 — 請在瀏覽器重新登入 EIP 後再同步');
      }
      console.warn('[EIP Content] ' + label + ' 第 ' + (attempt+1) + ' 次拿到 HTML（非 CSV），準備重試');
    }
    // CSV 連續 HTML（忙線）→ 最後也退到網頁版分頁試一次
    console.warn('[EIP Content] ' + label + ' CSV 連續忙線 → 改用網頁版分頁');
    return await fetchListCountsViaHtml(params, label, info);
  }

  function pad2(n){ return String(n).padStart(2, '0'); }

  // ══════════════════════════════════════
  //  ★ v5.0 新增：個人收支業績查詢（business_money）→ 各通路績效
  //  剔除規則：①狀態備註含「不計業績」 ②負向且入帳日期早於當月1號
  // ══════════════════════════════════════
  function buildMoneyQuery(monthStart){
    var keys = ['q1','q2','q3','q4','q5','q6','q7','q8','q25','q26','q27','q9','q10','q11','q23','q29','q12','q13','q14','q15','q18','q19','q20','q21'];
    var parts = [];
    keys.forEach(function(k){ parts.push(k + '=' + (k === 'q1' ? encodeURIComponent(monthStart) : '')); });
    parts.push('btnq=%E6%9F%A5%E8%A9%A2');
    return parts.join('&');
  }

  function moneyRowsFromCSV(text, monthStart){
    var rows = parseCSV(text);
    if (!rows.length) return null;
    var hIdx = -1, col = {};
    var NEED = { org:'組織', owner:'業績承辦人', main:'通路來源主類別', sub:'通路來源副類別', course:'課程名稱', note:'狀態備註', item:'收支項目', perf:'業績合計', inDate:'入帳日期', stu:'學員' };
    for (var r = 0; r < Math.min(rows.length, 5); r++){
      var found = {};
      for (var c = 0; c < rows[r].length; c++){
        var h = String(rows[r][c]).trim();
        for (var k in NEED){ if (found[k] === undefined && h.indexOf(NEED[k]) >= 0) found[k] = c; }
      }
      if (found.org !== undefined && found.owner !== undefined && found.perf !== undefined && found.main !== undefined){
        hIdx = r; col = found; break;
      }
    }
    if (hIdx < 0) return null;
    var out = [], skipNote = 0, skipOld = 0;
    var startCmp = monthStart.replace(/\//g, '-'); // YYYY-MM-DD 字串比較
    for (var i = hIdx + 1; i < rows.length; i++){
      var row = rows[i];
      if (row.length <= col.perf) continue;
      function cell(k){ return col[k] !== undefined && row[col[k]] !== undefined ? String(row[col[k]]).trim() : ''; }
      var note = cell('note');
      if (note.indexOf('不計業績') >= 0){ skipNote++; continue; }
      var val = parseFloat(cell('perf').replace(/,/g, '').replace(/\s/g, '')) || 0;
      var inDate = cell('inDate').replace(/\//g, '-');
      if (val < 0 && inDate && inDate.slice(0, 10) < startCmp){ skipOld++; continue; }
      out.push({ org: cell('org'), owner: cell('owner'), main: cell('main'), sub: cell('sub'), course: cell('course'), item: cell('item'), stu: cell('stu'), value: val });
    }
    console.log('[EIP Content] 收支明細: 取 ' + out.length + ' 筆（剔除 不計業績=' + skipNote + ' 非當月負向=' + skipOld + '）'
      + (col.stu !== undefined ? '，學員欄=第' + col.stu + '欄' : '，⚠️ 沒找到學員欄'));
    out._hasStuCol = (col.stu !== undefined);
    return out;
  }

  function moneyRowsFromHtml(html, monthStart, acc){
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var tables = doc.querySelectorAll('table');
    var table = null, col = null;
    var NEED = { org:'組織', owner:'業績承辦人', main:'通路來源主類別', sub:'通路來源副類別', note:'狀態備註', item:'收支項目', perf:'業績合計', inDate:'入帳日期' };
    for (var t = 0; t < tables.length; t++){
      var rs = getDirectRows(tables[t]);
      if (rs.length < 1) continue;
      var ths = getDirectCells(rs[0]);
      var found = {};
      for (var c = 0; c < ths.length; c++){
        var h = ths[c].textContent.trim();
        for (var k in NEED){ if (found[k] === undefined && h.indexOf(NEED[k]) >= 0) found[k] = c; }
      }
      if (found.org !== undefined && found.owner !== undefined && found.perf !== undefined && found.main !== undefined){
        table = tables[t]; col = found; break;
      }
    }
    if (!table) return 0;
    var startCmp = monthStart.replace(/\//g, '-');
    var trs = getDirectRows(table), n = 0;
    for (var i = 1; i < trs.length; i++){
      var tds = getDirectCells(trs[i]);
      if (tds.length <= col.perf) continue;
      function cell(k){ return col[k] !== undefined && tds[col[k]] ? tds[col[k]].textContent.trim() : ''; }
      var note = cell('note');
      if (note.indexOf('不計業績') >= 0) continue;
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
    notify('status', { msg: '正在同步收支明細（各通路績效）...' });
    // ★ v5.4：只走 CSV（一次拿全月）。失敗就停下來，絕不退回逐頁狂掃 47 頁拖垮 EIP。
    var csv = await fetchViaBackground('http://eip.appedu.com.tw/class/report/performance/business_money_csv.php?' + qs);
    if (!csv || csv.indexOf('<html') >= 0 || csv.indexOf('<!DOCTYPE') >= 0){
      throw new Error('收支明細：EIP 回傳網頁而非 CSV — 多半是未登入或忙線，請稍後再試（不逐頁抓以免拖垮 EIP）');
    }
    var rows = moneyRowsFromCSV(csv, monthStart);
    if (rows === null){
      throw new Error('收支明細 CSV 解析失敗（找不到表頭）— 請稍後再試');
    }
    return rows;
  }

  // 六通路分類 + 班務追回（業績 − 業績Ⓐ − 學員加購）
  var CH_ORG_RENAME = { '台中學院': '台中一部' }; // 各通路績效畫面用「台中一部」命名
  function computeChannels(moneyRows, perfPData, year, month){
    function renameOrg(o){ return CH_ORG_RENAME[o] || o; }
    var ch = { net:{}, purchase:{}, event:{}, referral:{}, cash:{}, admin:{} };   // 個人
    var ac = { net:{}, purchase:{}, event:{}, referral:{}, cash:{}, admin:{} };   // 學院
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

    // 班務追回：靠個人績效（business、new_perf）− 個人學員加購
    if (perfPData && perfPData.orgs){
      for (var orgName in perfPData.orgs){
        var orgOut = renameOrg(orgName);
        perfPData.orgs[orgName].forEach(function(p){
          var nm = p.employee_name;
          if (!nm) return;
          var biz = parseFloat(String(p.business).replace(/,/g, '')) || 0;
          var bizA = parseFloat(String(p.new_perf).replace(/,/g, '')) || 0;
          var purchase = ch.purchase[nm] || 0;
          var adminVal = biz - bizA - purchase;
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

  // ★ v5.8：課程銷售分析 — 用收支明細算「各學院×課程」業績（區域＝頁面端把該區學院相加）
  var COURSE_ACADEMIES = ['站前學院','站二學院','館前學院','板橋學院','站前二部','東區二部','中壢學院','中壢二部','中壢三部','台中學院','台中二部','台中三部','高雄建國'];
  function computeCourses(moneyRows, year, month){
    var byOrg = {}; // 學院 -> 課程 -> { value, count, stuMap:{承辦人|學員: 總額}, owners:{承辦人:{value,count}} }
    (moneyRows || []).forEach(function(r){
      var org = (r.org || '').trim();
      if (COURSE_ACADEMIES.indexOf(org) < 0) return;   // 只收五區的 13 家學院
      var course = (r.course || '').trim();
      if (!course) return;                              // 無課程名稱（介紹費等）略過
      if (!byOrg[org]) byOrg[org] = {};
      if (!byOrg[org][course]) byOrg[org][course] = { value: 0, count: 0, stuMap: {}, _anon: 0, owners: {} };
      var e = byOrg[org][course];
      e.value += r.value;
      e.count += 1;
      var ow = (r.owner || '').trim();
      // ★ v5.11：學員別總繳（同學員多筆收支加總 → 頁面端依門檻算 1 / 0.5 / 0 套）
      var stu = (r.stu || '').trim();
      var stuKey = ow + '|' + (stu || ('#row' + (e._anon++)));   // 沒有學員欄就每筆各自算
      e.stuMap[stuKey] = (e.stuMap[stuKey] || 0) + r.value;
      // ★ v5.10：個人明細 — 業績承辦人 × 課程
      if (ow){
        if (!e.owners[ow]) e.owners[ow] = { value: 0, count: 0 };
        e.owners[ow].value += r.value;
        e.owners[ow].count += 1;
      }
    });
    var out = { meta: { year: year, month: month }, byOrg: {} };
    Object.keys(byOrg).forEach(function(org){
      out.byOrg[org] = Object.keys(byOrg[org])
        .map(function(c){
          var e = byOrg[org][c];
          var owners = {};
          Object.keys(e.owners).forEach(function(o){ owners[o] = { value: Math.round(e.owners[o].value), count: e.owners[o].count, stu: [] }; });
          var stuAll = [];
          Object.keys(e.stuMap).forEach(function(k){
            var amt = Math.round(e.stuMap[k]);
            stuAll.push(amt);
            var o = k.slice(0, k.indexOf('|'));
            if (o && owners[o]) owners[o].stu.push(amt);
          });
          return { name: c, value: Math.round(e.value), count: e.count, stu: stuAll, owners: owners };
        })
        .filter(function(x){ return x.value !== 0; });
    });
    return out;
  }


  // ══════════════════════════════════════════════════════════════
  //  ★ v5.34 報到排名：不要每次都整月重抓
  //   ① 過去的月份 → 數字已經凍結，抓過一次就永久快取，之後 0 個請求。
  //   ② 本月「已報到 / 網路已報到」→ 把月初到「七天前」切成一週一塊存起來，
  //      每次只重抓最近這幾天。七天的緩衝是為了接住補登。
  //   ③ 「預約報到」不切：它查的是今天到月底的預約，今天新約的可能落在下週，
  //      切段一定會漏，所以永遠整段重抓。
  //   ④ 上線前會自我驗證：同一組條件「切段加總」跟「整段」抓一次比對，
  //      完全一致才啟用；只要對不上就永久停用切段並回報 —— 寧可慢也不要算錯。
  //      （EIP 的 q8 迄日對某些狀態可能不生效，那會讓兩段各自回傳整月 → 數字變兩倍。）
  // ══════════════════════════════════════════════════════════════
  var CK_SEG_KEY = 'eip_ck_seg_v1';
  function _ckSegLoad(){
    try {
      var o = JSON.parse(localStorage.getItem(CK_SEG_KEY) || 'null');
      if (o && o.v === 1){
        // 只留最近 6 個月，不然這份快取會一直長大（每個 key 存的是學院×承辦人的筆數表）
        try {
          var t = new Date(), keep = {};
          for (var i = 0; i < 6; i++){ var d = new Date(t.getFullYear(), t.getMonth() - i, 1); keep[d.getFullYear() + '-' + pad2(d.getMonth() + 1)] = 1; }
          var drop = 0;
          Object.keys(o.seg || {}).forEach(function(k){ var pt = k.split('|'); if (pt.length > 1 && !keep[pt[1]]){ delete o.seg[k]; drop++; } });
          if (drop) _ckSegSave(o);
        } catch(e2){}
        return o;
      }
    } catch(e){}
    return { v:1, lab:{}, seg:{} };
  }
  function _ckSegSave(o){ try { localStorage.setItem(CK_SEG_KEY, JSON.stringify(o)); } catch(e){ console.warn('[EIP Content] 報到快取寫入失敗', e); } }
  function _ckCloneCounts(c){ return { byKey: Object.assign({}, c.byKey), byAcademy: Object.assign({}, c.byAcademy), total: c.total }; }
  function _ckAddCounts(a, b){
    for (var k in b.byKey) a.byKey[k] = (a.byKey[k] || 0) + b.byKey[k];
    for (var g in b.byAcademy) a.byAcademy[g] = (a.byAcademy[g] || 0) + b.byAcademy[g];
    a.total += b.total;
    return a;
  }
  function _ckSameCounts(a, b){
    if (a.total !== b.total) return false;
    var ka = Object.keys(a.byKey), kb = Object.keys(b.byKey);
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < ka.length; i++){ if (a.byKey[ka[i]] !== b.byKey[ka[i]]) return false; }
    return true;
  }
  function _ckDay(year, month, d){ return year + '/' + pad2(month) + '/' + pad2(d); }
  // 本月切段計畫：回傳 { chunks:[{k,from,to,endDay}], freshFrom, settledEnd } —— chunk 的結束日必須離今天 ≥ 7 天
  function _ckSegPlan(year, month, todayDay){
    var chunks = [], settledEnd = 0;
    for (var k = 0; k < 4; k++){
      var endDay = (k + 1) * 7;
      if (endDay > todayDay - 7) break;          // 還沒滿七天緩衝 → 不算凍結
      chunks.push({ k:k, from:_ckDay(year, month, k * 7 + 1), to:_ckDay(year, month, endDay), endDay:endDay });
      settledEnd = endDay;
    }
    if (!chunks.length) return null;
    return { chunks: chunks, settledEnd: settledEnd, freshFrom: _ckDay(year, month, settledEnd + 1) };
  }
  // ── 網路已報到＝已報到的子集（主類別「網際網路」）──
  //   名單表格只有「通路來源(副)」，但每個副類別只屬於一個主類別 → 學一次對照表就好：
  //   某副類別出現在網路那份結果 ⇒ 它是網際網路；出現在已報到卻沒出現在網路 ⇒ 不是。
  //   學完之後，整段抓已報到時直接推算網路，省掉一整段查詢（那段每頁要 3.7 秒，最貴）。
  //   安全機制：推算值要跟實查完全一致才啟用；遇到沒學過的副類別那次照抓；每 7 天強制重驗。
  var CK_NET_RECHECK_MS = 7 * 24 * 3600 * 1000;
  function _ckNetState(box){ return box.net || (box.net = { ok:null, yes:{}, no:{}, checkedAt:0, why:'' }); }
  function _ckNetDerive(st, rows){
    if (!rows || !rows.length) return null;
    var acc = emptyCounts(), unknown = {};
    for (var i = 0; i < rows.length; i++){
      var sc = rows[i].src;
      if (sc === null || sc === undefined) return null;          // 這頁沒有通路來源欄 → 推算不了
      if (st.yes[sc]) addCount(acc, rows[i].academy, rows[i].owner);
      else if (!st.no[sc]) unknown[sc] = 1;
    }
    var uk = Object.keys(unknown);
    if (uk.length) return { unknown: uk };
    return { counts: acc };
  }
  function _ckNetLearn(st, formalRows, netRows){
    var yes = {}, seen = {};
    netRows.forEach(function(r){ if (r.src != null) yes[r.src] = 1; });
    formalRows.forEach(function(r){ if (r.src != null) seen[r.src] = 1; });
    st.yes = yes; st.no = {};
    Object.keys(seen).forEach(function(sc){ if (!yes[sc]) st.no[sc] = 1; });
  }
  function _ckWith(params, over){ var o = {}; for (var k in params) o[k] = params[k]; for (var j in over) o[j] = over[j]; return o; }

  async function fetchCheckin(year, month){
    var monthStart = year + '/' + month + '/01';
    var lastDay = new Date(parseInt(year, 10), parseInt(month, 10), 0).getDate();
    var monthEnd = year + '/' + month + '/' + pad2(lastDay);
    var now = new Date();
    var isCurrentMonth = (now.getFullYear() === parseInt(year, 10) && (now.getMonth() + 1) === parseInt(month, 10));
    var rsStart = isCurrentMonth ? (now.getFullYear() + '/' + pad2(now.getMonth() + 1) + '/' + pad2(now.getDate())) : monthStart;

    var ym = year + '-' + pad2(month);
    var todayDay = isCurrentMonth ? now.getDate() : 99;
    var box = _ckSegLoad();
    var stat = [], t0;

    var step = async function(n, label, params, splitable, opt){
      opt = opt || {};
      notify('status', { msg: '正在同步' + label + ' (' + n + '/3)...' });
      t0 = Date.now();
      var info = { wantRows: !!opt.wantRows }, note = '', pages = 0;
      var keepRows = function(){ if (opt.wantRows) opt.out.rows = info.rows || null; };
      var rec = function(c, via){
        keepRows();
        stat.push({ label: label, n: c.total, sec: Math.round((Date.now() - t0) / 100) / 10,
                    via: via, pages: pages, capped: !!info.capped, note: note });
        return c;
      };

      // ① 過去的月份：整段抓一次就永久快取（數字不會再變）
      if (!isCurrentMonth){
        var fk = label + '|' + ym + '|FULL';
        if (box.seg[fk]){ note = '整月快取（過去月份，0 個請求）'; return rec(_ckCloneCounts(box.seg[fk].counts), '快取'); }
        var cFull0 = await fetchListCounts(params, label, info);
        pages = info.pages || 1;
        box.seg[fk] = { counts: _ckCloneCounts(cFull0), at: Date.now() }; _ckSegSave(box);
        note = '已存成整月快取，這個月以後不用再抓';
        return rec(cFull0, info.via || 'CSV');
      }

      var st = box.lab[label] || (box.lab[label] = { ok: null });
      var plan = splitable ? _ckSegPlan(year, month, todayDay) : null;

      // ② 已驗證通過 → 快取段 ＋ 只抓最近這幾天
      if (plan && st.ok === 1){
        var acc = emptyCounts(), missing = [], netAcc = emptyCounts(), netOk = true;
        var nSt = _ckNetState(box);
        for (var i = 0; i < plan.chunks.length; i++){
          var ch = plan.chunks[i], key = label + '|' + ym + '|' + ch.k;
          if (box.seg[key]){
            _ckAddCounts(acc, box.seg[key].counts);
            if (box.seg[key].net) _ckAddCounts(netAcc, box.seg[key].net); else netOk = false;
          } else missing.push(ch);
        }
        // 缺的那幾塊補抓（一塊只會抓這一次，之後永遠命中）
        for (var j = 0; j < missing.length; j++){
          var m2 = missing[j], i2 = { wantRows: !!opt.wantRows };
          var cm = await fetchListCounts(_ckWith(params, { q7: m2.from, q8: m2.to }), label + '（補 ' + m2.from + '~' + m2.to + '）', i2);
          pages += i2.pages || 1;
          var ent = { counts: _ckCloneCounts(cm), at: Date.now() };
          if (opt.wantRows && i2.rows){
            var dv2 = _ckNetDerive(nSt, i2.rows);
            if (dv2 && dv2.counts){ ent.net = _ckCloneCounts(dv2.counts); _ckAddCounts(netAcc, dv2.counts); }
            else netOk = false;
          } else netOk = false;
          box.seg[label + '|' + ym + '|' + m2.k] = ent;
          _ckAddCounts(acc, cm);
          await sleep(EIP_THROTTLE_MS);
        }
        if (missing.length) _ckSegSave(box);
        var iF = { wantRows: !!opt.wantRows };
        var fresh = await fetchListCounts(_ckWith(params, { q7: plan.freshFrom }), label + '（' + plan.freshFrom + ' 起）', iF);
        pages += iF.pages || 1; info.capped = info.capped || iF.capped; info.rows = iF.rows || null;
        if (opt.wantRows && netOk && info.rows) opt.out.netChunks = netAcc;    // 切段時的網路推算底子
        note = '切段：1~' + plan.settledEnd + ' 號用快取' + (missing.length ? '（本次補 ' + missing.length + ' 塊）' : '') + '，只重抓 ' + plan.freshFrom + ' 起';
        return rec(_ckAddCounts(acc, fresh), missing.length ? '切段＋補抓' : '切段');
      }

      // ③ 還沒驗證 / 驗證失敗 / 不能切 → 整段抓（這是權威值）
      var cFull = await fetchListCounts(params, label, info);
      pages = info.pages || 1;

      // 沒驗過、可以切、而且這段真的在翻網頁分頁（走 CSV 的話切了也省不到）→ 順便驗一次
      if (plan && st.ok === null && info.via === '網頁分頁'){
        notify('status', { msg: label + '：第一次啟用切段，正在跟整段對帳（只有這一次會多抓）...' });
        try {
          var accV = emptyCounts(), okAll = true, tmp = {}, nSt2 = _ckNetState(box);
          for (var v = 0; v < plan.chunks.length && okAll; v++){
            var cv = plan.chunks[v], iv = { wantRows: !!opt.wantRows };
            await sleep(EIP_THROTTLE_MS);
            var cc = await fetchListCounts(_ckWith(params, { q7: cv.from, q8: cv.to }), label + '（對帳 ' + cv.from + '~' + cv.to + '）', iv);
            pages += iv.pages || 1;
            tmp[cv.k] = { counts: _ckCloneCounts(cc) };
            // 順手把這一塊的網路筆數也算好存著，之後切段時網路照樣推算得出來
            if (opt.wantRows && iv.rows && nSt2.ok === 1){
              var dv3 = _ckNetDerive(nSt2, iv.rows);
              if (dv3 && dv3.counts) tmp[cv.k].net = _ckCloneCounts(dv3.counts);
            }
            _ckAddCounts(accV, cc);
          }
          await sleep(EIP_THROTTLE_MS);
          var iv2 = {};
          var cvF = await fetchListCounts(_ckWith(params, { q7: plan.freshFrom }), label + '（對帳 ' + plan.freshFrom + ' 起）', iv2);
          pages += iv2.pages || 1;
          _ckAddCounts(accV, cvF);
          if (_ckSameCounts(accV, cFull)){
            st.ok = 1; st.checkedAt = Date.now(); st.why = '';
            for (var w in tmp) box.seg[label + '|' + ym + '|' + w] = { counts: tmp[w].counts, net: tmp[w].net || null, at: Date.now() };
            note = '✅ 切段對帳通過（' + accV.total + ' = ' + cFull.total + '），下次開始只抓最近幾天';
          } else {
            st.ok = 0; st.why = '切段 ' + accV.total + ' ≠ 整段 ' + cFull.total;
            note = '⛔ 切段對帳不符（' + st.why + '）→ 已永久停用切段，維持整月重抓';
          }
        } catch(eV){
          st.ok = 0; st.why = '對帳時出錯：' + (eV.message || eV);
          note = '⛔ 切段對帳失敗（' + st.why + '）→ 已永久停用切段';
        }
        _ckSegSave(box);
      } else if (plan && st.ok === 0){
        note = '切段已停用（' + (st.why || '對帳不符') + '）';
      } else if (!splitable){
        note = (label === '預約報到') ? '不切段：查的是今天到月底的預約，切了會漏掉新預約'
                                      : '今天是定期重驗日 → 整段抓，好跟推算值對帳（每 7 天一次）';
      } else if (!plan){
        note = '本月還沒有滿七天緩衝的區段，先整段抓';
      }
      return rec(cFull, info.via || 'CSV');
    };

    var nst0 = _ckNetState(box);
    // 每 7 天要跟實查對帳一次 → 那天連已報到也整段抓，才有完整名單可以比
    var dueRecheck = !nst0.checkedAt || (Date.now() - nst0.checkedAt > CK_NET_RECHECK_MS);
    var fOut = {};
    var formal = await step(1, '已報到', { q7: monthStart, q16: 'formal' }, !(nst0.ok === 1 && dueRecheck), { wantRows: true, out: fOut });
    await sleep(EIP_THROTTLE_MS);

    // ── 網路已報到：能推算就不要再查一次 ──
    var nst = nst0, net = null, netNote = '';
    var fullFormalRows = (fOut.rows && fOut.rows.length && formal.total === fOut.rows.length) ? fOut.rows : null;  // 只有「整段抓」時列數才等於總數
    if (nst.ok === 1 && !dueRecheck){
      // 整段抓 → 直接推算；切段抓 → 快取塊的網路數 ＋ 只推算最近這幾天
      var base = fullFormalRows ? null : (fOut.netChunks || null);
      var rowsForDerive = fullFormalRows || fOut.rows;
      if (rowsForDerive && (fullFormalRows || base)){
        var dv = _ckNetDerive(nst, rowsForDerive);
        if (dv && dv.counts){
          net = base ? _ckAddCounts(_ckCloneCounts(base), dv.counts) : dv.counts;
          netNote = base ? '快取段的網路數 ＋ 最近這幾天推算（省掉一整段查詢）' : '從已報到推算（省掉一整段查詢）';
          stat.push({ label:'網路已報到', n: net.total, sec: 0, via:'推算', pages: 0, capped: false, note: netNote });
        } else if (dv && dv.unknown){
          netNote = '出現沒學過的通路來源「' + dv.unknown.slice(0, 3).join('、') + '」→ 這次照抓並學起來';
        }
      }
    }
    if (!net){
      var nOut = {};
      net = await step(2, '網路已報到', { q7: monthStart, q16: 'formal', q13: '3' }, true, { wantRows: true, out: nOut });
      // 兩邊都是整段、都有列 → 學對照表並對帳
      var fullNetRows = (nOut.rows && nOut.rows.length && net.total === nOut.rows.length) ? nOut.rows : null;
      if (fullFormalRows && fullNetRows){
        var prevOk = nst.ok;
        _ckNetLearn(nst, fullFormalRows, fullNetRows);
        var chk = _ckNetDerive(nst, fullFormalRows);
        if (chk && chk.counts && _ckSameCounts(chk.counts, net)){
          nst.ok = 1; nst.checkedAt = Date.now(); nst.why = '';
          var st2 = stat[stat.length - 1];
          st2.note = (st2.note ? st2.note + '　' : '') + (netNote ? netNote + '　' : '')
            + '✅ 推算對帳通過（' + chk.counts.total + ' = ' + net.total + '）'
            + (prevOk === 1 ? '（定期重驗）' : '，下次開始不用再查這一段');
        } else {
          nst.ok = 0; nst.checkedAt = Date.now();
          nst.why = '推算 ' + ((chk && chk.counts) ? chk.counts.total : '?') + ' ≠ 實查 ' + net.total;
          var st3 = stat[stat.length - 1];
          st3.note = (st3.note ? st3.note + '　' : '') + '⛔ 推算對帳不符（' + nst.why + '）→ 已停用推算，維持實際查詢';
        }
      } else if (netNote){
        var st4 = stat[stat.length - 1];
        st4.note = (st4.note ? st4.note + '　' : '') + netNote;
      }
      _ckSegSave(box);
    }
    await sleep(EIP_THROTTLE_MS);
    var rs = await step(3, '預約報到', { q7: rsStart, q8: monthEnd, q16: '2' }, false);

    return { formal: formal, net: net, rs: rs, stat: stat, meta: { year: year, month: month, rsStart: rsStart, rsEnd: monthEnd } };
  }

  // ══════════════════════════════════════
  //  主要同步流程
  // ══════════════════════════════════════
  function _cid(){
    try { var aid = localStorage.getItem('activeCharacterId'); if (aid) return 'char_' + aid + '_'; } catch(e){}
    return '';
  }
  function _safeSet(k, v){
    try { localStorage.setItem(k, v); return true; }
    catch(e){ console.error('[EIP Content] localStorage 寫入失敗 (quota?):', k, e.message); return false; }
  }
  // ★ 2026/09 空殼防呆：EIP 偶爾回空表（逾時／權限／改版），照寫會把好資料蓋成 0。
  //   規則：抓到空的、而本機同月已有非空資料 → 保留舊資料，並在完成訊息提醒重跑。
  function _sameYm(d, year, month){
    return !!(d && d.meta && String(d.meta.year) === String(year) && parseInt(d.meta.month, 10) === parseInt(month, 10));
  }
  function _perfpRows(d){ var n = 0; if (d && d.orgs) for (var o in d.orgs) n += (d.orgs[o] || []).length; return n; }
  function _checkinRows(d){ var n = 0, f = d && d.formal && d.formal.byAcademy; if (f) for (var k in f) n += (parseInt(f[k], 10) || 0); return n; }
  function _keepIfEmpty(key, incoming, year, month, countFn){
    if (countFn(incoming) > 0) return { data: incoming, kept: false };
    var old = null; try { old = JSON.parse(localStorage.getItem(key) || 'null'); } catch(e){}
    if (old && _sameYm(old, year, month) && countFn(old) > 0){
      console.warn('[EIP Content] ⚠️ 抓到空表，保留本機既有資料：' + key);
      return { data: old, kept: true };
    }
    return { data: incoming, kept: false };
  }
  function _nowStr(){
    var now = new Date();
    return now.getFullYear() + '/' + (now.getMonth()+1) + '/' + now.getDate()
      + ' ' + now.getHours() + ':' + String(now.getMinutes()).padStart(2,'0');
  }

  // ── 模式 A：激勵（學院/業務/正式組/儲備組）+ 當月績效（七學院 perfP） ──
  async function syncMotiv(year, month){
    notify('status', { msg: '正在同步學院排名...' });
    var aUrl = 'http://eip.appedu.com.tw/class/report/performance/performance_at.php?q1=' + year + '&q2=' + month + '&q3=&btnq=%E6%9F%A5%E8%A9%A2';
    var aHtml = await fetchViaBackground(aUrl);
    var academyData = extractAcademyDirect(aHtml);
    if (academyData.length <= 1){
      aHtml = await fetchViaBackground(aUrl.replace('q3=&', 'q3=0&'));
      academyData = extractAcademyDirect(aHtml);
    }

    notify('status', { msg: '正在同步業務排名...' });
    var sUrl = 'http://eip.appedu.com.tw/working/report/performance/performance_p.php?q1=' + year + '&q2=' + month + '&q3=&q4=&q5=&btnq=%E6%9F%A5%E8%A9%A2';
    var sHtml = await fetchViaBackground(sUrl);
    var salesData = extractSalesDirect(sHtml);
    if (salesData.length <= 1){
      sHtml = await fetchViaBackground(sUrl.replace('q3=&', 'q3=0&'));
      salesData = extractSalesDirect(sHtml);
    }

    notify('status', { msg: '正在同步正式小組績效表...' });
    var gHtml = await fetchViaBackground('http://eip.appedu.com.tw/working/report/performance/performance_d.php?q1=' + year + '&q2=' + month + '&q3=&btnq=%E6%9F%A5%E8%A9%A2');
    var groupData = extractGroupPerformance(gHtml);

    notify('status', { msg: '正在同步儲備小組績效表...' });
    var rHtml = await fetchViaBackground('http://eip.appedu.com.tw/working/report/performance/performance_d2.php?q1=' + year + '&q2=' + month + '&q3=&btnq=%E6%9F%A5%E8%A9%A2');
    var reserveData = extractGroupPerformance(rHtml);

    // ★ v5.5：七學院個人績效直接從上面「全學院業務頁」的 perfRows 分組（不再多打 7 個請求）
    var perfPData = null;
    var grouped = perfPFromAllOrg(sHtml, year, month);
    if (grouped && grouped.total > 0 && grouped.covered >= 4){
      perfPData = grouped.data;   // 單頁分組成功（至少涵蓋 4 個學院，視為完整）
    } else {
      console.warn('[EIP Content] 單頁分組個人績效不足（covered=' + (grouped?grouped.covered:0) + '），改逐學院補抓');
      perfPData = await fetchPerfPPerOrg(year, month);
    }
    var cid = _cid(), ts = _nowStr();
    var _perfPKeep = _keepIfEmpty(cid + 'motiv_perfp_v1', perfPData || { orgs:{}, meta:{ year: year, month: month } }, year, month, _perfpRows);
    var perfPTotal = _perfpRows(_perfPKeep.data);
    var pairs = [
      [cid + 'motiv_academy_v1', JSON.stringify(academyData)],
      [cid + 'motiv_sales_v1', JSON.stringify(salesData)],
      [cid + 'motiv_group_performance_v1', JSON.stringify(groupData)],
      [cid + 'motiv_group_performance_meta', JSON.stringify({ year: year, month: month })],
      [cid + 'motiv_reserve_performance_v1', JSON.stringify(reserveData)],
      [cid + 'motiv_reserve_performance_meta', JSON.stringify({ year: year, month: month })],
      [cid + 'motiv_perfp_v1', JSON.stringify(_perfPKeep.data || { orgs:{}, meta:{ year: year, month: month } })],
      [cid + 'motiv_updated_at', ts],
      [cid + 'motiv_synced_motiv', ts]
    ];
    pairs.forEach(function(p){ _safeSet(p[0], p[1]); });

    notify('done', {
      mode: 'motiv',
      academy: academyData, sales: salesData,
      groupPerformance: groupData, groupMeta: { year: year, month: month },
      reservePerformance: reserveData, reserveMeta: { year: year, month: month },
      perfP: perfPData, updateTime: ts,
      msg: '🏆 激勵同步完成！學院 ' + academyData.length + ' / 業務 ' + salesData.length + ' / 正式 ' + groupData.length + ' 組 / 儲備 ' + reserveData.length + ' 組 / 個人績效 ' + perfPTotal + ' 人'
        + (_perfPKeep.kept ? '　⚠️ 這次個人績效抓到空表（EIP 可能逾時或權限問題），已保留上一次的資料，請稍後再同步一次' : '')
    });
  }

  // ── 模式 B：報到排名（已報到 / 網路已報到 / 到月底預約報到，全走 CSV） ──
  async function syncCheckin(year, month){
    var checkinData = await fetchCheckin(year, month);
    var cid = _cid(), ts = _nowStr();
    var _ckKeep = _keepIfEmpty(cid + 'motiv_checkin_v1', checkinData, year, month, _checkinRows);
    checkinData = _ckKeep.data;
    _safeSet(cid + 'motiv_checkin_v1', JSON.stringify(checkinData));
    _safeSet(cid + 'motiv_synced_checkin', ts);
    _safeSet(cid + 'motiv_updated_at', ts);
    notify('done', {
      mode: 'checkin', checkin: checkinData, updateTime: ts,
      msg: '🚪 報到排名同步完成！已報到 ' + checkinData.formal.total + ' / 網路 ' + checkinData.net.total + ' / 到月底 ' + checkinData.rs.total + ' 筆'
        + (checkinData.stat ? '\n' + checkinData.stat.map(function(x){
            return '　' + x.label + '：' + x.n + ' 筆・' + x.via + (x.pages > 1 ? ' ' + x.pages + ' 頁' : '') + '・' + x.sec + ' 秒'
              + (x.capped ? '　⚠️ 翻到上限 80 頁，可能沒抓完' : '') + (x.note ? '\n　　└ ' + x.note : '');
          }).join('\n') : '')
        + (_ckKeep.kept ? '　⚠️ 這次抓到空表，已保留上一次的資料，請稍後再同步一次' : '')
    });
  }

  // ── 模式 C：各通路績效（收支明細，走 CSV；班務追回重用快取的 perfP） ──
  async function syncChannel(year, month){
    var cid = _cid();
    var perfPData = null;
    try { var ps = localStorage.getItem(cid + 'motiv_perfp_v1'); if (ps) perfPData = JSON.parse(ps); } catch(e){}
    if (!perfPData || !perfPData.orgs || Object.keys(perfPData.orgs).length === 0){
      throw new Error('找不到個人績效快取 — 班務追回需要它，請先按一次「🏆 激勵」同步再做通路績效');
    }
    var moneyRows = await fetchMoneyRows(year, month);
    var channelData = computeChannels(moneyRows, perfPData, year, month);
    var courseData = computeCourses(moneyRows, year, month);   // ★ v5.7：同一份收支明細順便算課程銷售分析
    var ts = _nowStr();
    _safeSet(cid + 'motiv_channel_v1', JSON.stringify(channelData));
    _safeSet(cid + 'motiv_course_v1', JSON.stringify(courseData));
    _safeSet(cid + 'motiv_synced_channel', ts);
    _safeSet(cid + 'motiv_updated_at', ts);
    var nChan = 0; for (var ck in channelData.channels){ if (channelData.channels[ck].ranking.length) nChan++; }
    // ★ v5.11 診斷：學員欄有沒有抓到（主打課程套數門檻規則需要它）
    var stuDiag = (moneyRows && moneyRows._hasStuCol) ? '，學員欄 ✓（套數門檻規則生效）' : '，⚠️ 學員欄沒抓到 — 套數改用筆數估算';
    notify('done', {
      mode: 'channel', channel: channelData, course: courseData, updateTime: ts,
      msg: '📋 各通路績效同步完成！' + nChan + '/6 通路、共 ' + (moneyRows ? moneyRows.length : 0) + ' 筆收支' + stuDiag
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  ★ v5.16 模式 D：🔀 漏斗（月度漏斗總結的逐人資料）
  //   兩張 EIP 逐人明細，七家各抓一次，用「姓名」合併：
  //   ① 面談紀錄總表 class/student/student/interview/total.php
  //      q1=組織、q5~q6=建檔日期（本月 + 往回 3 個月，追回/收割池要看前幾個月談的人）
  //      欄：建檔日期、姓名、行動電話、承辦人、購買課程(報名/註冊狀態)、備註、總實繳
  //   ② 營業收支查詢 class/report/performance/business.php
  //      q12=組織、q1~q2=收支日期（本月）
  //      欄：姓名、副類別(學員加購要排除)、繳費狀態(只留 報名/註冊)、業績合計、收支日期、承辦人
  //   兩頁都是 pg= 翻頁、每頁 30 筆，跟報到排名的網頁版 fallback 同一套做法（0.8 秒/頁、去重、空頁即停）。
  //   分類（當下/試聽後/追回/經營中）不在擴充算，交給頁面（規則可改、不用重抓）。
  // ══════════════════════════════════════════════════════════════
  var FUNNEL_LOOKBACK_MONTHS = 3;
  // ★ 對 EIP 的保護：漏斗是全擴充裡翻頁最多的流程（七家約 180 頁），刻意比報到再慢一倍 —
  //   每頁間隔 2 秒、每家之間再停 4 秒、永遠一次只有一個請求在跑（跟一個人手動翻頁一樣，只是更慢）。
  //   總時間約 7～9 分鐘，換取對公司 EIP 幾乎零感的負載。
  var FUNNEL_PAGE_THROTTLE_MS = 2000;
  var FUNNEL_ORG_GAP_MS = 4000;
  function _fnPad2(n){ return String(n).padStart(2, '0'); }
  function _fnLastDay(y, m){ return new Date(y, m, 0).getDate(); }   // m: 1-12
  function _fnTxt(el){ return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }

  // 面談紀錄總表：一頁 → rows
  function _fnParseInterviewPage(html){
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var table = doc.getElementById('students');
    if (!table){
      // 找表頭含「建檔日期」「姓名」「購買課程」的表
      var tables = doc.querySelectorAll('table');
      for (var t = 0; t < tables.length; t++){
        var h = _fnTxt(getDirectRows(tables[t])[0] || null);
        if (h.indexOf('建檔日期') >= 0 && h.indexOf('購買課程') >= 0){ table = tables[t]; break; }
      }
    }
    if (!table) return null;
    var trs = getDirectRows(table);
    if (!trs.length) return null;
    var ths = getDirectCells(trs[0]).map(function(c){ return _fnTxt(c); });
    var ix = {};
    ths.forEach(function(h, i){
      if (h === '建檔日期') ix.date = i;
      else if (h === '通路建檔日期') ix.src0 = i;
      else if (h === '姓名') ix.name = i;
      else if (h === '行動電話') ix.phone = i;
      else if (h === '承辦人') ix.owner = i;
      else if (h === '想學課程') ix.want = i;
      else if (h === '購買課程') ix.bought = i;
      else if (h === '備註') ix.note = i;
      else if (h === '總實繳') ix.paid = i;
      else if (h === '通路來源(副)') ix.src = i;
    });
    if (ix.date == null || ix.name == null) return null;
    var out = [];
    for (var i = 1; i < trs.length; i++){
      var tds = getDirectCells(trs[i]);
      if (tds.length <= ix.date) continue;
      var name = _fnTxt(tds[ix.name]); if (!name) continue;
      var bought = tds[ix.bought], app = 0, reg = 0, courses = [];
      if (bought){
        var divs = bought.querySelectorAll('div');
        for (var d = 0; d < divs.length; d++){
          var cls = divs[d].className || '';
          var cn = _fnTxt(divs[d]).replace(/\s*(未登記|登記上課|登記未出席|使用未過 1\/3|出席.*)$/, '');
          if (/pay_status1/.test(cls)){ app++; courses.push(cn + '(報名)'); }
          else if (/pay_status2/.test(cls)){ reg++; courses.push(cn + '(註冊)'); }
        }
      }
      out.push({
        d: _fnTxt(tds[ix.date]),                       // 建檔日期 = 面談日 YYYY/MM/DD
        sd: ix.src0 != null ? _fnTxt(tds[ix.src0]) : '',  // 通路建檔日期 = 名單進來的日期（EIP Ⓐ/Ⓑ 用這個分：當月＝Ⓐ 新名單、更早＝Ⓑ 舊名單）
        n: name,
        p: ix.phone != null ? _fnTxt(tds[ix.phone]) : '',
        o: ix.owner != null ? _fnTxt(tds[ix.owner]) : '',
        s: ix.src != null ? _fnTxt(tds[ix.src]) : '',
        w: ix.want != null ? _fnTxt(tds[ix.want]).slice(0, 40) : '',
        a: app,                                         // 報名中的課程數（報未註）
        r: reg,                                         // 已註冊課程數
        c: courses.slice(0, 4).join('、'),
        m: ix.note != null ? _fnTxt(tds[ix.note]).slice(0, 200) : '',
        id: _trialRowId(trs[i]),                        // 學員 id（深挖狀態歷史記錄用）
        t: ix.paid != null ? parseFloat(_fnTxt(tds[ix.paid]).replace(/,/g, '')) || 0 : 0
      });
    }
    return out;
  }

  // 營業收支查詢：一頁 → rows（只留 報名/註冊）
  function _fnParseBusinessPage(html){
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var table = doc.getElementById('performances');
    if (!table){
      var tables = doc.querySelectorAll('table');
      for (var t = 0; t < tables.length; t++){
        var h = _fnTxt(getDirectRows(tables[t])[0] || null);
        if (h.indexOf('繳費狀態') >= 0 && h.indexOf('收支日期') >= 0){ table = tables[t]; break; }
      }
    }
    if (!table) return null;
    var trs = getDirectRows(table);
    if (!trs.length) return null;
    var ths = getDirectCells(trs[0]).map(function(c){ return _fnTxt(c); });
    var ix = {};
    ths.forEach(function(h, i){
      if (h === '姓名') ix.name = i;
      else if (h === '通路來源副類別') ix.sub = i;
      else if (h === '課程名稱') ix.course = i;
      else if (h === '繳費狀態') ix.state = i;
      else if (h === '業績合計') ix.perf = i;
      else if (h === '收支日期') ix.date = i;
      else if (h === '承辦人') ix.owner = i;
      else if (h === '收據編號') ix.sn = i;
    });
    if (ix.name == null || ix.state == null || ix.date == null) return null;
    var out = { rows: [], total: 0 };
    for (var i = 1; i < trs.length; i++){
      var tds = getDirectCells(trs[i]);
      if (tds.length <= Math.max(ix.state, ix.date)) continue;
      out.total++;
      var st = _fnTxt(tds[ix.state]);
      if (st !== '報名' && st !== '註冊') continue;
      out.rows.push({
        n: _fnTxt(tds[ix.name]),
        st: st,
        sub: ix.sub != null ? _fnTxt(tds[ix.sub]) : '',
        k: ix.course != null ? _fnTxt(tds[ix.course]).slice(0, 30) : '',
        d: _fnTxt(tds[ix.date]),
        v: ix.perf != null ? parseFloat(_fnTxt(tds[ix.perf]).replace(/,/g, '')) || 0 : 0,
        o: ix.owner != null ? _fnTxt(tds[ix.owner]) : '',
        sn: ix.sn != null ? _fnTxt(tds[ix.sn]) : ''
      });
    }
    return out;
  }

  // 通用：pg 翻頁抓到底（去重、空頁即停）
  async function _fnFetchPaged(baseUrl, label, parsePage, maxPages, prog, opts){
    var all = [], seen = {}, gotTable = false;
    var startPg = (opts && opts.startPg) || 1;
    if (opts && opts.seed && opts.seed.length){          // 第 1 頁已經抓過 → 直接沿用，不重抓
      opts.seed.forEach(function(r){ var sg = JSON.stringify(r); if (!seen[sg]){ seen[sg] = 1; all.push(r); } });
      gotTable = true;
    }
    for (var pg = startPg; pg <= maxPages; pg++){
      if (pg > startPg || startPg > 1) await sleep(FUNNEL_PAGE_THROTTLE_MS);
      var html = await fetchViaBackground(baseUrl + '&pg=' + pg);
      if (/無權|沒有權限|權限不足/.test(String(html))) throw new Error(label + '：EIP 回覆「無權進入此頁」— 請找 EIP 管理員開通');
      var parsed = parsePage(html);
      if (parsed === null){
        if (_looksLikeLogin(html)) throw new Error(label + '：EIP 顯示登入頁 — 請重新登入 EIP 後再同步');
        if (pg === 1) throw new Error(label + '：找不到資料表格 — EIP 可能忙線，請稍後再試');
        break;
      }
      gotTable = true;
      var rows = parsed.rows || parsed, rawCount = parsed.total != null ? parsed.total : rows.length;
      var added = 0;
      for (var i = 0; i < rows.length; i++){
        var sig = JSON.stringify(rows[i]);
        if (seen[sig]) continue;
        seen[sig] = 1; all.push(rows[i]); added++;
      }
      notify('status', { msg: label + ' 第 ' + pg + ' 頁（累計 ' + all.length + ' 筆）', prog: Object.assign({}, prog || {}, { page: pg, rows: all.length }) });
      if (rawCount === 0 || rawCount < 30) break;          // 不滿 30 筆 = 最後一頁
      if (rows.length && added === 0) break;                // 整頁重複 = 回捲，結束
    }
    return gotTable ? all : [];
  }

  // ── FunnelDB（跟頁面共用的 IndexedDB）讀寫：漏斗逐人資料太大，不走 localStorage ──
  var FN_DB = { name:'FunnelDB', ver:1, store:'kv' };
  function _fnDbOpen(){
    return new Promise(function(res, rej){
      try {
        var q = indexedDB.open(FN_DB.name, FN_DB.ver);
        q.onupgradeneeded = function(){ var db = q.result; if (!db.objectStoreNames.contains(FN_DB.store)) db.createObjectStore(FN_DB.store); };
        q.onsuccess = function(){ res(q.result); };
        q.onerror = function(){ rej(q.error); };
      } catch(e){ rej(e); }
    });
  }
  async function _fnDbGet(key){
    try {
      var db = await _fnDbOpen();
      if (!db.objectStoreNames.contains(FN_DB.store)){ db.close(); return null; }
      return await new Promise(function(res){
        var g = db.transaction(FN_DB.store, 'readonly').objectStore(FN_DB.store).get(key);
        g.onsuccess = function(){ var v = g.result; db.close(); try { res(typeof v === 'string' ? JSON.parse(v) : (v || null)); } catch(e){ res(null); } };
        g.onerror = function(){ db.close(); res(null); };
      });
    } catch(e){ return null; }
  }
  async function _fnDbPut(key, obj){
    try {
      var db = await _fnDbOpen();
      await new Promise(function(res, rej){
        var tx = db.transaction(FN_DB.store, 'readwrite');
        tx.objectStore(FN_DB.store).put(JSON.stringify(obj), key);
        tx.oncomplete = function(){ db.close(); res(); };
        tx.onerror = function(){ db.close(); rej(tx.error); };
      });
      return true;
    } catch(e){ console.warn('[EIP Content] FunnelDB 寫入失敗', e); return false; }
  }
  // 上次的漏斗資料（LS 優先，其次 FunnelDB）
  async function _fnPrevData(){
    var cid = _cid();
    try { var s = localStorage.getItem(cid + 'motiv_funnel_v1'); if (s) return JSON.parse(s); } catch(e){}
    return await _fnDbGet(cid + 'motiv_funnel_v1');
  }
  var FUNNEL_PAY_BACKDAYS = 2;                 // 收支只補「上次同步日往前 2 天」到月底
  // 前 3 個月的面談紀錄：同一個月裡抓過一次就永久沿用（面談日不會變）。
  // 會變的只有那些人的「備註」（最新追蹤情形）→ 用總表的「編輯日期」篩選，只抓上次同步後被改過的列。
  var _fnEditParams = null;   // { from:'qX', to:'qY' }，從總表表單探測；探不到就不補
  function _fnFindEditParams(html){
    if (_fnEditParams) return _fnEditParams;
    try {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var trs = doc.querySelectorAll('tr');
      for (var i = 0; i < trs.length; i++){
        var first = trs[i].querySelector('td, th');
        var lab = first ? (first.textContent || '').replace(/\s+/g, '') : '';
        if (lab.indexOf('編輯日期') !== 0) continue;
        var ins = trs[i].querySelectorAll('input[name]');
        var names = [];
        for (var j = 0; j < ins.length; j++){ var ty = (ins[j].type || 'text').toLowerCase(); if (ty === 'text' || ty === 'date') names.push(ins[j].name); }
        if (names.length >= 2){ _fnEditParams = { from: names[0], to: names[1] }; return _fnEditParams; }
      }
    } catch(e){}
    return null;
  }
  function _fnMergeRows(cached, fresh){
    // 以「姓名＋面談日」當 key：有變動的列蓋掉舊的，新列追加
    var map = {}, order = [];
    (cached || []).forEach(function(r){ var k = r.n + '|' + r.d; if (!(k in map)) order.push(k); map[k] = r; });
    (fresh || []).forEach(function(r){ var k = r.n + '|' + r.d; if (!(k in map)) order.push(k); map[k] = r; });
    return order.map(function(k){ return map[k]; });
  }
  function _fnDedupe(list){
    var seen = {}, out = [];
    (list || []).forEach(function(r){ var sig = JSON.stringify(r); if (seen[sig]) return; seen[sig] = 1; out.push(r); });
    return out;
  }
  function _fnDStr(d){ return d.getFullYear() + '/' + _fnPad2(d.getMonth() + 1) + '/' + _fnPad2(d.getDate()); }

  // ── 收支明細：跟「📋 通路」共用同一支 CSV（一個請求拿全月七家），取代 business.php 逐頁 ──
  //   欄位不齊、或解析出來的筆數明顯少於逐頁版 → 自動回退舊路徑，判定規則不受影響。
  function _fnPayFromCsvText(text, mStart, mEnd){
    var rows = parseCSV(text);
    if (!rows.length) return null;
    // 表頭：漏斗要 姓名／繳費狀態／收支日期／業績合計／組織；有 副類別・課程・承辦人 更好
    // ★ 日期只認「收支日期」，不接受「入帳日期」代打 —— 兩者可能差好幾天，
    //   而「當下註冊」是用「註冊日 − 面談日 ≤ 3 天」判的，日期一歪分類就跟著歪。
    //   CSV 沒有收支日期 → 直接回退逐頁 business.php（那張表一定有收支日期）。
    var NEED = { org:['組織'], name:['學員','姓名'], state:['繳費狀態'], date:['收支日期'],
                 perf:['業績合計'], sub:['通路來源副類別'], course:['課程名稱'], owner:['業績承辦人','承辦人'], note:['狀態備註'] };
    var hIdx = -1, col = {};
    for (var r = 0; r < Math.min(rows.length, 5); r++){
      var found = {};
      for (var c = 0; c < rows[r].length; c++){
        var h = String(rows[r][c]).trim();
        for (var k in NEED){
          if (found[k] !== undefined) continue;
          for (var v = 0; v < NEED[k].length; v++){
            if (k === 'note' ? (h === NEED[k][v]) : (h.indexOf(NEED[k][v]) >= 0 && h !== '狀態備註')){ found[k] = c; break; }
          }
        }
      }
      if (found.org !== undefined && found.name !== undefined && found.state !== undefined && found.date !== undefined && found.perf !== undefined){
        hIdx = r; col = found; break;
      }
    }
    if (hIdx < 0) return null;                       // 欄位不齊 → 回退逐頁
    var byOrg = {}, nAll = 0, nKeep = 0, badState = 0;
    var norm = function(d){ return String(d || '').replace(/-/g, '/').slice(0, 10); };
    for (var i = hIdx + 1; i < rows.length; i++){
      var row = rows[i];
      if (row.length <= col.perf) continue;
      var cell = function(k){ return col[k] !== undefined && row[col[k]] !== undefined ? String(row[col[k]]).trim() : ''; };
      var st = cell('state');
      nAll++;
      if (st !== '報名' && st !== '註冊'){ if (st) badState++; continue; }
      var d = norm(cell('date'));
      if (!d) return null;                            // 沒有收支日期 → 不採用整份 CSV，回退逐頁
      if (d < mStart || d > mEnd) continue;           // 只留本月（CSV 可能含跨月列）
      var org = cell('org');
      if (!org) continue;
      (byOrg[org] || (byOrg[org] = [])).push({
        n: cell('name'), st: st, sub: cell('sub'), k: cell('course').slice(0, 30), d: d,
        v: parseFloat(cell('perf').replace(/,/g, '').replace(/\s/g, '')) || 0, o: cell('owner'), sn: ''
      });
      nKeep++;
    }
    // 完全沒有 報名/註冊 → 這支 CSV 的狀態欄不是我們要的，回退
    if (!nKeep && badState) return null;
    return { byOrg: byOrg, nAll: nAll, nKeep: nKeep };
  }
  async function _fnPayCsvAll(year, month, mStart, mEnd){
    try {
      notify('status', { msg: '💵 收支明細：改用 CSV 一次拿全月七家（1 個請求，取代逐頁抓）…', prog: { phase: 'pay' } });
      var qs = buildMoneyQuery(mStart);
      var csv = await fetchViaBackground('http://eip.appedu.com.tw/class/report/performance/business_money_csv.php?' + qs);
      if (!csv || csv.indexOf('<html') >= 0 || csv.indexOf('<!DOCTYPE') >= 0) return null;
      var got = _fnPayFromCsvText(csv, mStart, mEnd);
      if (!got || !Object.keys(got.byOrg).length) return null;
      // 組織名可能是別名（各通路績效畫面把「台中學院」叫「台中一部」）→ 先還原
      var ALIAS = { '台中一部': '台中學院' };
      Object.keys(ALIAS).forEach(function(a){
        if (got.byOrg[a] && !got.byOrg[ALIAS[a]]){ got.byOrg[ALIAS[a]] = got.byOrg[a]; delete got.byOrg[a]; }
      });
      // ★ 對不到我們的七家 → 整份不採用，回退逐頁（避免組織名不合就靜默變成 0 筆）
      var hit = PERF_ORG_NAMES.filter(function(n){ return got.byOrg[n] && got.byOrg[n].length; });
      if (!hit.length){
        console.warn('[EIP Content] 收支 CSV 的組織名對不到七學院（CSV 裡有：' + Object.keys(got.byOrg).slice(0, 8).join('、') + '）→ 回退逐頁');
        return null;
      }
      console.log('[EIP Content] 收支 CSV：' + got.nKeep + '/' + got.nAll + ' 筆（報名/註冊），對到 ' + hit.length + '/' + PERF_ORG_NAMES.length + ' 家');
      return got.byOrg;
    } catch(e){ console.warn('[EIP Content] 收支 CSV 失敗，回退逐頁', e); return null; }
  }

  // 中途存檔：還沒跑到的學院沿用上一輪的資料，避免中斷後畫面少掉幾家
  async function _fnSavePartial(key, data, cache, partial){
    var merged = { meta: Object.assign({}, data.meta, { partial: !!partial }), orgs: {} };
    Object.keys(cache || {}).forEach(function(o){ merged.orgs[o] = cache[o]; });
    Object.keys(data.orgs || {}).forEach(function(o){ merged.orgs[o] = data.orgs[o]; });
    return await _fnDbPut(key, merged);
  }
  async function fetchFunnel(year, month, opts){
    var y = parseInt(year, 10), m = parseInt(month, 10);
    var fy = y, fm = m - FUNNEL_LOOKBACK_MONTHS; while (fm < 1){ fm += 12; fy--; }
    var from = fy + '/' + _fnPad2(fm) + '/01';
    var mStart = y + '/' + _fnPad2(m) + '/01', mEnd = y + '/' + _fnPad2(m) + '/' + _fnPad2(_fnLastDay(y, m));
    var full = !!(opts && opts.full);
    var prev = await _fnPrevData();
    var sameMonth = !!(prev && prev.meta && parseInt(prev.meta.year, 10) === y && parseInt(prev.meta.month, 10) === m);
    var cache = (!full && prev && prev.orgs) ? prev.orgs : {};
    var nowMs = Date.now();
    var today = new Date(); var todayStr = _fnDStr(today);
    var prevEndStr = _fnDStr(new Date(y, m - 1, 0));                 // 上個月最後一天（舊月份範圍的尾）
    var covToNow = (todayStr < mEnd) ? todayStr : mEnd;               // 這次抓完後，資料涵蓋到哪一天
    var data = { meta: { year: y, month: m, lookback: FUNNEL_LOOKBACK_MONTHS, from: from, to: mEnd, syncedAt: _nowStr(), incremental: !full }, orgs: {} };
    var cid0 = _cid(), fnKey = cid0 + 'motiv_funnel_v1';
    var nFullOrg = 0, nIncOrg = 0, nSeg = 0;
    // 舊版快取沒有 cov（涵蓋範圍）→ 用當時的 meta 推：from ～ min(to, 當時同步日)
    function _covOf(oc, prevMeta){
      if (!oc || !oc.itv || !oc.itv.length) return null;
      if (oc.cov && oc.cov.from && oc.cov.to) return oc.cov;
      if (!prevMeta || !prevMeta.from) return null;
      var sd = prevMeta.syncedAt ? String(prevMeta.syncedAt).split(' ')[0].replace(/(\d+)\/(\d+)\/(\d+)/, function(_, a, b, c){ return a + '/' + _fnPad2(+b) + '/' + _fnPad2(+c); }) : null;
      var to = (sd && sd < prevMeta.to) ? sd : prevMeta.to;
      return { from: prevMeta.from, to: to };
    }
    function _dayAfter(str){ var mm = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(str); var dt = new Date(+mm[1], +mm[2]-1, +mm[3] + 1); return _fnDStr(dt); }
    function _dayBefore(str){ var mm = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(str); var dt = new Date(+mm[1], +mm[2]-1, +mm[3] - 1); return _fnDStr(dt); }
    var kaTimer = setInterval(function(){
      try { chrome.runtime.sendMessage({ action: 'keepalive' }, function(){ void chrome.runtime.lastError; }); } catch(e){}
    }, 12000);
    var payCsv = null;
    try {
      payCsv = await _fnPayCsvAll(y, m, mStart, mEnd);
      if (payCsv) data.meta.paySrc = 'csv';
      await sleep(FUNNEL_PAGE_THROTTLE_MS);
      for (var k = 0; k < PERF_ORGS.length; k++){
        var org = PERF_ORGS[k];
        var lab = '🔀 ' + org.name + '（' + (k+1) + '/' + PERF_ORGS.length + '）';
        data.nIncOrg = nIncOrg; data.nFullOrg = nFullOrg; data.nSeg = nSeg;
        var oc = cache[org.name] || null;
        var cov = _covOf(oc, prev && prev.meta);
        var itvUrlBase = 'http://eip.appedu.com.tw/class/student/student/interview/total.php?q1=' + org.id;
        // ── ① 面談紀錄：只抓「還沒涵蓋」的日期段 ──
        //    需要的範圍 = from ～ mEnd。已涵蓋 cov.from～cov.to 的一律不重抓（面談日不會變）。
        //    本月（mStart～mEnd）永遠會補到今天；舊月份只補「涵蓋範圍以外」的那幾天。
        var segs = [];   // [{a,b,label}]
        if (!cov){
          segs.push({ a: from, b: mEnd, label: '面談紀錄（完整 ' + FUNNEL_LOOKBACK_MONTHS + ' 個月）' });
          nFullOrg++;
        } else {
          nIncOrg++;
          if (cov.from > from) segs.push({ a: from, b: _dayBefore(cov.from), label: '補更早的月份 ' + from.slice(5) + '～' + _dayBefore(cov.from).slice(5) });
          if (cov.to < prevEndStr) segs.push({ a: _dayBefore(cov.to), b: prevEndStr, label: '補舊月份尾巴 ' + _dayBefore(cov.to).slice(5) + '～' + prevEndStr.slice(5) });
          var curFrom = (cov.to >= mStart) ? _dayBefore(cov.to) : mStart;   // 本月：從上次涵蓋到的那天往前一天重抓（重疊一天防漏）
          segs.push({ a: curFrom, b: mEnd, label: '本月面談 ' + curFrom.slice(5) + ' 起' });
        }
        var fetched = [];
        for (var si = 0; si < segs.length; si++){
          if (si > 0) await sleep(FUNNEL_PAGE_THROTTLE_MS);
          var sg = segs[si];
          var rows = await _fnFetchPaged(itvUrlBase + '&q5=' + encodeURIComponent(sg.a) + '&q6=' + encodeURIComponent(sg.b), lab + ' ' + sg.label, _fnParseInterviewPage, 60, { org: k + 1, total: PERF_ORGS.length, name: org.name, phase: 'itv' });
          fetched = fetched.concat(rows); nSeg++;
        }
        // 快取裡「需要範圍內」的舊列 + 這次抓到的（同一人同面談日 → 新的蓋舊的）
        var keep = (oc && oc.itv ? oc.itv : []).filter(function(r){ var d = String(r.d || ''); return d >= from && d <= mEnd; });
        var itv = _fnMergeRows(keep, fetched);
        // 舊月份裡「上次同步後被編輯過」的列（備註／狀態有變）→ 用總表的「編輯日期」篩選，只抓這幾個人
        if (!_fnEditParams){
          try { var probe = await fetchViaBackground(itvUrlBase + '&q5=' + encodeURIComponent(mStart) + '&q6=' + encodeURIComponent(mEnd) + '&pg=1'); _fnFindEditParams(probe); } catch(eP){}
          if (_fnEditParams) console.log('[EIP Content] 編輯日期欄位：', _fnEditParams);
        }
        if (cov && _fnEditParams && oc.payAt){
          await sleep(FUNNEL_PAGE_THROTTLE_MS);
          var editFrom = _fnDStr(new Date(oc.payAt - 86400000));
          var itvUrlE = itvUrlBase + '&q5=' + encodeURIComponent(from) + '&q6=' + encodeURIComponent(prevEndStr)
            + '&' + _fnEditParams.from + '=' + encodeURIComponent(editFrom) + '&' + _fnEditParams.to + '=' + encodeURIComponent(mEnd);
          var changed = await _fnFetchPaged(itvUrlE, lab + ' 舊月份有變動的列', _fnParseInterviewPage, 10, { org: k + 1, total: PERF_ORGS.length, name: org.name, phase: 'itv' });
          if (changed.length){ itv = _fnMergeRows(itv, changed); data.nChanged = (data.nChanged || 0) + changed.length; }
        }
        itv = _fnDedupe(itv);
        // ── ② 營業收支：優先用 CSV（已經一次拿到七家）；沒有才逐頁抓 ──
        var pay = null;
        if (payCsv){
          pay = payCsv[org.name] || null;
          // 安全網：這家在 CSV 裡完全沒出現 → 不當成「0 筆」，改走逐頁確認
          if (!pay){
            console.warn('[EIP Content] ' + org.name + ' 在收支 CSV 裡沒有任何列 → 改走逐頁確認');
          }
          // 安全網：CSV 抓到的筆數比上次少一半以上 → 不信任，改走逐頁
          var prevN = (oc && oc.pay) ? oc.pay.length : 0;
          if (pay && prevN >= 10 && pay.length < prevN * 0.5){
            console.warn('[EIP Content] ' + org.name + ' CSV 收支只有 ' + pay.length + ' 筆（上次 ' + prevN + '），改走逐頁');
            pay = null;
          } else {
            notify('status', { msg: lab + ' 收支 ' + pay.length + ' 筆（CSV，免翻頁）', prog: { org: k + 1, total: PERF_ORGS.length, name: org.name, phase: 'pay', rows: pay.length } });
          }
        }
        if (pay){
          data.orgs[org.name] = { itv: itv, pay: pay, cov: { from: from, to: covToNow }, oldAt: nowMs, payAt: nowMs };
          await _fnSavePartial(fnKey, data, (prev && prev.orgs) || {}, k < PERF_ORGS.length - 1);
          if (k < PERF_ORGS.length - 1){ notify('status', { msg: lab + ' 完成，停 4 秒讓 EIP 喘口氣…', prog: { org: k + 1, total: PERF_ORGS.length, name: org.name, phase: 'done' } }); await sleep(FUNNEL_ORG_GAP_MS); }
          continue;
        }
        await sleep(FUNNEL_PAGE_THROTTLE_MS);
        var payFrom = mStart;
        if (sameMonth && oc && oc.pay && oc.payAt){
          var back = new Date(oc.payAt - FUNNEL_PAY_BACKDAYS * 86400000);
          var ms = new Date(y, m - 1, 1);
          if (back > ms) payFrom = _fnDStr(back);
        }
        var bizUrl = 'http://eip.appedu.com.tw/class/report/performance/business.php?q12=' + org.id
          + '&q1=' + encodeURIComponent(payFrom) + '&q2=' + encodeURIComponent(mEnd) + '&btnq=' + encodeURIComponent('查詢');
        var payNew = await _fnFetchPaged(bizUrl, lab + ' 收支明細' + (payFrom !== mStart ? '（' + payFrom.slice(5) + ' 起）' : ''), _fnParseBusinessPage, 60, { org: k + 1, total: PERF_ORGS.length, name: org.name, phase: 'pay' });
        if (payFrom !== mStart){
          var keepPay = (oc.pay || []).filter(function(r){ return String(r.d || '') < payFrom; });
          pay = _fnDedupe(keepPay.concat(payNew));
        } else pay = payNew;
        data.orgs[org.name] = { itv: itv, pay: pay, cov: { from: from, to: covToNow }, oldAt: nowMs, payAt: nowMs };
        // ★ 每家抓完就存一次：中途關掉頁面也不會整批白跑，下次接著跑
        await _fnSavePartial(fnKey, data, (prev && prev.orgs) || {}, k < PERF_ORGS.length - 1);
        if (k < PERF_ORGS.length - 1){ notify('status', { msg: lab + ' 完成，停 4 秒讓 EIP 喘口氣…', prog: { org: k + 1, total: PERF_ORGS.length, name: org.name, phase: 'done' } }); await sleep(FUNNEL_ORG_GAP_MS); }
      }
    } finally {
      try { clearInterval(kaTimer); } catch(e){}
    }
    data.nIncOrg = nIncOrg; data.nFullOrg = nFullOrg; data.nSeg = nSeg;
    return data;
  }

  async function syncFunnel(year, month, opts){
    notify('status', { msg: '🔀 漏斗：開始抓七家的面談紀錄＋收支明細。' + ((opts && opts.full) ? '這次是「全部重抓」（本月＋往回 3 個月），約 7～9 分鐘。' : '同一個月第二次以後只補本月新資料＋前 3 個月有改過的列，通常 1～3 分鐘。') + '為了不影響 EIP，刻意放慢：每頁 2 秒、一次只發一個請求…', prog: { org: 0, total: PERF_ORGS.length, phase: 'start' } });
    var data = await fetchFunnel(year, month, opts);
    var cid = _cid(), ts = _nowStr();
    var nI = 0, nP = 0; for (var o in data.orgs){ nI += data.orgs[o].itv.length; nP += data.orgs[o].pay.length; }
    var okIdb = await _fnDbPut(cid + 'motiv_funnel_v1', data);
    if (!okIdb) _safeSet(cid + 'motiv_funnel_v1', JSON.stringify(data));   // IDB 不能用才退回 localStorage
    _safeSet(cid + 'motiv_synced_funnel', ts);
    _safeSet(cid + 'motiv_updated_at', ts);
    notify('done', {
      mode: 'funnel', funnel: data, updateTime: ts,
      msg: '🔀 漏斗同步完成！面談紀錄 ' + nI + ' 人（含往回 3 個月）／ 報名・註冊明細 ' + nP + ' 筆'
        + (data.meta.paySrc === 'csv' ? '　💵 收支走 CSV（1 個請求，省下逐頁）' : '')
        + (data.meta.incremental ? '　⚡ 增量：' + data.nIncOrg + ' 家沿用快取、只補沒涵蓋的日期' + (data.nChanged ? '（另更新 ' + data.nChanged + ' 列有變動的舊紀錄）' : '') + (data.nFullOrg ? '、' + data.nFullOrg + ' 家第一次完整抓' : '') : '　（完整重抓）')
    });
  }

  // ══════════════════════════════════════════════════════════════
  // 🔎 模式 E：試聽深挖（狀態歷史記錄）— v5.19
  //   面談紀錄總表的「備註」只有最新一筆追蹤情形，業務把試聽日寫在更早的紀錄裡就看不到。
  //   這個模式會逐人打開「新增狀態記錄」視窗，把 狀態歷史記錄 裡每一筆「追蹤情形」抓回來，
  //   交給頁面判斷（關鍵字與日期規則寫在頁面，改規則不用重抓）。
  //   為了不影響公司 EIP：
  //     ① 只挖「本月面談」的人（不是三個月）
  //     ② 已註冊、已繳報名費的人跳過（答案已定）
  //     ③ 增量：備註沒變、上次挖過的人跳過
  //     ④ 可以只挖一個區（中區／桃區／南區）
  //     ⑤ 每人間隔 2 秒，一次一個請求
  // ══════════════════════════════════════════════════════════════
  var TRIAL_THROTTLE_MS = 2000, TRIAL_ORG_GAP_MS = 3000;
  var TRIAL_REGIONS = {
    all:     { label: '全省七家', orgs: ['台中學院','台中二部','台中三部','中壢學院','中壢二部','中壢三部','高雄建國'] },
    central: { label: '中區',     orgs: ['台中學院','台中二部','台中三部'] },
    taoyuan: { label: '桃區',     orgs: ['中壢學院','中壢二部','中壢三部'] },
    south:   { label: '南區',     orgs: ['高雄建國'] }
  };
  // 從列表的一列裡找出學員 id（新增按鈕的 onclick / href 參數）
  function _trialRowId(tr){
    try {
      var h = tr.innerHTML || '';
      var m = /(?:onclick|href)\s*=\s*["'][^"']*?(?:\(|[?&][a-z_0-9]{1,12}=)\s*'?"?(\d{3,12})/i.exec(h);
      if (m) return m[1];
      var m2 = /\b(?:id|sid|student_id|q1)\s*=\s*["']?(\d{3,12})/i.exec(h);
      return m2 ? m2[1] : '';
    } catch(e){ return ''; }
  }
  // 自動探測「新增狀態記錄」的網址樣板（{id} 會被換成學員 id）
  var _trialUrlTpl = null, _trialDiag = '';
  function _trialFindTpl(listHtml, sampleId){
    var cands = [];
    // ① 列表裡直接寫的 href
    var re = /href\s*=\s*["']([^"']*(?:status|interview|record|call|track)[^"']*\.php[^"']*)["']/ig, m;
    while ((m = re.exec(listHtml))) cands.push(m[1]);
    // ② onclick 呼叫的函式 → 找函式本體裡的 .php 路徑
    var fns = {}, re2 = /onclick\s*=\s*["']\s*([A-Za-z_$][\w$]*)\s*\(/g;
    while ((m = re2.exec(listHtml))) fns[m[1]] = 1;
    Object.keys(fns).forEach(function(fn){
      var i = listHtml.indexOf('function ' + fn);
      if (i < 0) return;
      var body = listHtml.slice(i, i + 1200);
      var re3 = /["']([^"']*\.php[^"']*)["']/g, m3;
      while ((m3 = re3.exec(body))) cands.push(m3[1]);
    });
    // 整理成樣板
    var out = [];
    cands.forEach(function(u){
      if (!u || /login|logout|\.js|\.css/i.test(u)) return;
      var abs = u.indexOf('http') === 0 ? u : ('http://eip.appedu.com.tw/' + String(u).replace(/^\.?\//, ''));
      abs = abs.replace(/(\?|&)([a-z_0-9]{1,14})=(\d{3,12})/i, '$1$2={id}');
      if (abs.indexOf('{id}') < 0) abs += (abs.indexOf('?') > 0 ? '&' : '?') + 'id={id}';
      if (out.indexOf(abs) < 0) out.push(abs);
    });
    // 常見備援樣板
    ['class/student/student/interview/status.php?id={id}',
     'class/student/student/interview/add.php?id={id}',
     'class/student/student/interview/record.php?id={id}',
     'class/student/student/status.php?id={id}'].forEach(function(u){
      var abs = 'http://eip.appedu.com.tw/' + u;
      if (out.indexOf(abs) < 0) out.push(abs);
    });
    _trialDiag = '候選：' + out.slice(0, 6).join(' ｜ ');
    return out;
  }
  // 解析「狀態歷史記錄」：回傳 [{d:撥打日期, s:狀態, m:追蹤情形}]（最多 8 筆，新到舊）
  function _trialParseHistory(html){
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var body = doc.body ? doc.body.innerText || doc.body.textContent || '' : '';
    if (body.indexOf('狀態歷史記錄') < 0) return null;
    var out = [];
    // 表格式：每筆一個小表，欄位是「撥打日期 / 狀態 / 追蹤情形 / 承辦人 / 時間(狀態值) / 修改人」
    var tables = doc.querySelectorAll('table');
    for (var t = 0; t < tables.length; t++){
      var txt = tables[t].innerText || tables[t].textContent || '';
      if (txt.indexOf('撥打日期') < 0 && txt.indexOf('追蹤情形') < 0) continue;
      var cells = tables[t].querySelectorAll('td, th');
      var rec = { d:'', s:'', m:'' }, got = false;
      for (var c = 0; c < cells.length - 1; c++){
        var lab = (cells[c].innerText || cells[c].textContent || '').replace(/\s+/g, '');
        var val = (cells[c+1].innerText || cells[c+1].textContent || '').replace(/\s+/g, ' ').trim();
        if (lab === '撥打日期'){ if (got && (rec.m || rec.d)) { out.push(rec); rec = { d:'', s:'', m:'' }; } rec.d = val; got = true; }
        else if (lab === '狀態') rec.s = val;
        else if (lab === '追蹤情形') rec.m = val.slice(0, 160);
        else if (lab === '時間(狀態值)' && !rec.t) rec.t = val;
      }
      if (got && (rec.m || rec.d)) out.push(rec);
    }
    // ★ 2026/09：原本這裡有一段「純文字備援」，用 /追蹤情形 …/ 去刮整頁文字。
    //   問題是這個視窗是 JavaScript 畫出來的，抓回來的 HTML 只有腳本沒有表格 →
    //   備援就刮到腳本原始碼，存了一堆「姓名」「狀態歸類」「").appendTo($tr3);」當成追蹤情形。
    //   而且它「看起來成功」，所以錯了好幾天都沒人發現。寧可失敗，不要吞垃圾。
    out = out.filter(_trialRecOk);
    if (!out.length){
      _trialDiag = '視窗抓到了但解析不出紀錄（可能是 JS 動態產生）。前 300 字：' + String(body).replace(/\s+/g, ' ').slice(0, 300);
      return null;
    }
    return out.slice(0, 8);
  }
  // 一筆紀錄長得像不像真的追蹤情形（擋掉欄位標籤與腳本殘渣）
  var TRIAL_LABELS = /^(姓名|狀態|狀態歸類|撥打日期|追蹤情形|承辦人|修改人|行銷人員|時間|時間\(狀態值\)|備註|學員狀況)$/;
  function _trialRecOk(r){
    var m = String((r && r.m) || '').trim();
    var d = String((r && r.d) || '').trim();
    if (!m && !d) return false;
    if (TRIAL_LABELS.test(m)) return false;
    if (/appendTo|\$\(|\$tr|function\s*\(|var\s+\w|=>|\)\s*;\s*$|<\/?[a-z]+[\s>]/i.test(m)) return false;
    // 真的紀錄一定有撥打日期（YYYY/MM/DD）
    if (!/^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/.test(d)) return false;
    return true;
  }
  // 挖一個人
  var _trialTplLocked = false;   // 已經確認可用的樣板 → 之後每個人只打 1 個請求
  async function _trialFetchOne(id, tpls){
    if (_trialTplLocked){
      try {
        var html0 = await fetchViaBackground(tpls[0].replace('{id}', id));
        if (_looksLikeLogin(html0)) throw new Error('EIP 顯示登入頁 — 請重新登入 EIP 後再挖');
        return _trialParseHistory(html0);
      } catch(e){ if (String(e.message||'').indexOf('登入頁') >= 0) throw e; return null; }
    }
    // 還沒鎖定 → 逐一試候選，每個之間也停 1 秒，不要連發
    for (var i = 0; i < tpls.length; i++){
      if (i > 0) await sleep(1000);
      var url = tpls[i].replace('{id}', id);
      var html;
      try { html = await fetchViaBackground(url); } catch(e){ continue; }
      if (_looksLikeLogin(html)) throw new Error('EIP 顯示登入頁 — 請重新登入 EIP 後再挖');
      var h = _trialParseHistory(html);
      if (h){
        if (i > 0) tpls.unshift(tpls.splice(i, 1)[0]);   // 成功的樣板排到最前面
        _trialTplLocked = true;                          // 之後不再試其他候選
        try { localStorage.setItem(TRIAL_TPL_KEY, tpls[0]); } catch(eT){}   // 記起來：下次重抓一個人只要 1 個請求
        console.log('[EIP Content] 狀態歷史記錄網址已鎖定：' + tpls[0]);
        return h;
      }
    }
    return null;
  }
  // ── 🔎 只重抓一個人的狀態歷史記錄 ──
  //   組長在核對名單時，發現某個人的備註是舊的 → 按一下就去 EIP 把他最新的追蹤情形讀回來。
  //   樣板記住的話只要 1 個請求；沒記住就多抓一次總表第一頁去探測。
  var TRIAL_TPL_KEY = 'eip_trial_tpl_v1';
  async function syncTrialOne(year, month, orgName, name, id, itvDate){
    var y = parseInt(year, 10), m = parseInt(month, 10);
    var org = PERF_ORGS.filter(function(o){ return o.name === orgName; })[0];
    if (!org) throw new Error('找不到學院「' + orgName + '」');
    notify('status', { msg: '🔎 正在讀 ' + name + ' 的狀態歷史記錄…' });
    // 舊版抓回來的列沒有存 EIP 編號 → 用「他的面談日」把那一天的名單叫出來，從裡面找他
    var lookupHtml = null;
    if (!id){
      if (!itvDate) throw new Error(name + '：本機沒有他的 EIP 編號，也沒有面談日可以查。請先按一次「🔀 漏斗」再試');
      var oneUrl = 'http://eip.appedu.com.tw/class/student/student/interview/total.php?q1=' + org.id
        + '&q5=' + encodeURIComponent(itvDate) + '&q6=' + encodeURIComponent(itvDate) + '&pg=1';
      lookupHtml = await fetchViaBackground(oneUrl);
      if (_looksLikeLogin(lookupHtml)) throw new Error('EIP 顯示登入頁 — 請重新登入 EIP 後再試');
      var lr = _fnParseInterviewPage(lookupHtml) || [];
      for (var li = 0; li < lr.length; li++){ if (lr[li].n === name && lr[li].id){ id = lr[li].id; break; } }
      if (!id) throw new Error(name + '：在 ' + itvDate + ' 的面談名單裡找不到他的 EIP 編號');
      await sleep(1000);
    }
    if (!_trialUrlTpl){
      var saved = null; try { saved = localStorage.getItem(TRIAL_TPL_KEY); } catch(e){}
      if (saved){ _trialUrlTpl = [saved]; _trialTplLocked = true; }
    }
    if (!_trialUrlTpl){
      var lh = lookupHtml;
      if (!lh){
        var mStart = y + '/' + _fnPad2(m) + '/01', mEnd = y + '/' + _fnPad2(m) + '/' + _fnPad2(_fnLastDay(y, m));
        var listUrl = 'http://eip.appedu.com.tw/class/student/student/interview/total.php?q1=' + org.id
          + '&q5=' + encodeURIComponent(mStart) + '&q6=' + encodeURIComponent(mEnd) + '&pg=1';
        lh = await fetchViaBackground(listUrl);
        if (_looksLikeLogin(lh)) throw new Error('EIP 顯示登入頁 — 請重新登入 EIP 後再試');
        await sleep(1000);
      }
      _trialUrlTpl = _trialFindTpl(lh, id);
    }
    var hist = await _trialFetchOne(id, _trialUrlTpl);
    if (!hist) throw new Error(name + '：讀不到他的狀態歷史記錄。' + (_trialDiag ? '診斷 → ' + _trialDiag : '（抓不到那個視窗）'));
    var cid = _cid(), key = cid + 'motiv_trial_v2';
    var store = null;
    try { store = JSON.parse(localStorage.getItem(key) || 'null'); } catch(e){}
    if (!store) store = await _fnDbGet(key);
    if (!store || !store.people) store = { meta: {}, people: {} };
    var slot = store.people[orgName] || (store.people[orgName] = {});
    slot[name] = { sig: (slot[name] && slot[name].sig) || '', h: hist, at: _nowStr(), ts: Date.now(), ym: y + '-' + _fnPad2(m) };
    var okOne = await _fnDbPut(key, store);
    if (!okOne) _safeSet(key, JSON.stringify(store));
    notify('done', {
      mode: 'trialone', trial: store, one: { org: orgName, name: name, n: hist.length, at: _nowStr() }, updateTime: _nowStr(),
      msg: '🔎 ' + name + '：讀到 ' + hist.length + ' 筆追蹤情形' + (hist.length ? '，最新一筆「' + String(hist[0].m || '').slice(0, 24) + '」' : '')
    });
  }
  async function syncTrial(year, month, region){
    var y = parseInt(year, 10), m = parseInt(month, 10);
    var reg = TRIAL_REGIONS[region] || TRIAL_REGIONS.all;
    var orgs = PERF_ORGS.filter(function(o){ return reg.orgs.indexOf(o.name) >= 0; });
    var mStart = y + '/' + _fnPad2(m) + '/01', mEnd = y + '/' + _fnPad2(m) + '/' + _fnPad2(_fnLastDay(y, m));
    // ★ v5.23：狀態歷史記錄是「人」的屬性，不會因為換月就失效 → 跨月永久保留，只挖備註有變動的人。
    //   結構：{ meta, people: { 學院: { 姓名: { sig, h, at, ym } } } }（舊版 orgs 會自動併過來）
    var cid = _cid(), key = cid + 'motiv_trial_v2';
    var store = null;
    try { store = JSON.parse(localStorage.getItem(key) || 'null'); } catch(e){}
    if (!store) store = await _fnDbGet(key);
    if (!store || !store.people){
      var old = null;
      try { old = JSON.parse(localStorage.getItem(cid + 'motiv_trial_v1') || 'null'); } catch(e){}
      if (!old) old = await _fnDbGet(cid + 'motiv_trial_v1');
      store = { meta: {}, people: (old && old.orgs) ? old.orgs : {} };
      if (old && old.meta) store.meta.migratedFrom = old.meta.year + '/' + old.meta.month;
    }
    store.meta.year = y; store.meta.month = m;
    store.meta.syncedAt = _nowStr(); store.meta.lastRegion = reg.label;

    notify('status', { msg: '🔎 試聽深挖（' + reg.label + '）：先抓本月面談名單…', prog: { org:0, total:orgs.length, phase:'start' } });
    var kaTimer = setInterval(function(){ try { chrome.runtime.sendMessage({ action:'keepalive' }, function(){ void chrome.runtime.lastError; }); } catch(e){} }, 12000);
    var nScan = 0, nSkip = 0, nFail = 0, nPeople = 0;
    try {
      for (var k = 0; k < orgs.length; k++){
        var org = orgs[k];
        var lab = '🔎 ' + org.name + '（' + (k+1) + '/' + orgs.length + '）';
        var url = 'http://eip.appedu.com.tw/class/student/student/interview/total.php?q1=' + org.id
          + '&q5=' + encodeURIComponent(mStart) + '&q6=' + encodeURIComponent(mEnd);
        // 順便留一份第一頁 HTML 給網址探測用
        var firstHtml = await fetchViaBackground(url + '&pg=1');
        if (_looksLikeLogin(firstHtml)) throw new Error('EIP 顯示登入頁 — 請重新登入 EIP 後再挖');
        var rows = _fnParseInterviewPage(firstHtml) || [];
        if (rows.length >= 30){
          await sleep(TRIAL_THROTTLE_MS);
          // 第 1 頁已經在上面抓過了 → 從第 2 頁接著抓，不重複打 EIP
          var more = await _fnFetchPaged(url, lab + ' 本月面談', _fnParseInterviewPage, 20, { org:k+1, total:orgs.length, name:org.name, phase:'itv' }, { startPg:2, seed:rows });
          if (more.length > rows.length) rows = more;
        }
        var prev = store.people[org.name] || {};
        var cur = {};
        // 篩出「需要挖」的人：未註冊、未繳報名費、備註 sig 有變或沒挖過
        var todo = [];
        rows.forEach(function(r){
          if (!r.n) return;
          nPeople++;
          var old = prev[r.n];
          if (r.r > 0 || r.a > 0){ cur[r.n] = old || { skip:'已註冊/已繳報名費' }; nSkip++; return; }   // 答案已定
          var sig = (r.m || '') + '|' + (r.d || '');
          // ★ v5.31：一個人挖過一次就夠了。歷史視窗裡「只有它看得到」的是更早那幾筆；
          //   之後新增的追蹤情形會變成名單頁的「備註」，每次同步就自動收進來（頁面會累積），不必再挖一次。
          //   （舊規則是「備註有變就重挖」，業務每打一次電話就重挖一輪，月底會多花好幾倍時間。）
          if (old && old.h && old.h.length){ cur[r.n] = old; nSkip++; return; }
          todo.push({ n:r.n, id:r.id, sig:sig, o:r.o, d:r.d });
        });
        if (!_trialUrlTpl) _trialUrlTpl = _trialFindTpl(firstHtml, todo.length ? todo[0].id : '');
        notify('status', { msg: lab + '：本月面談 ' + rows.length + ' 人，要挖 ' + todo.length + ' 人（其餘已確定或沒變動）', prog: { org:k+1, total:orgs.length, name:org.name, phase:'scan', rows:todo.length } });
        for (var i = 0; i < todo.length; i++){
          var t = todo[i];
          if (i > 0) await sleep(TRIAL_THROTTLE_MS);
          var hist = null;
          if (t.id){ try { hist = await _trialFetchOne(t.id, _trialUrlTpl); } catch(eOne){ if (String(eOne.message||'').indexOf('登入頁') >= 0) throw eOne; } }
          if (hist){ cur[t.n] = { sig:t.sig, h:hist, at:_nowStr(), ts:Date.now(), ym:y + '-' + _fnPad2(m) }; nScan++; }
          else {
            cur[t.n] = { sig:t.sig, h:[], at:_nowStr(), ts:Date.now(), ym:y + '-' + _fnPad2(m), fail:1 }; nFail++;
            // ★ 還沒鎖定樣板、又已經連續失敗 3 個人 → 代表網址猜不中，立刻停手（不要每個人都去試一輪候選壓 EIP）
            if (!_trialTplLocked && nFail >= 3){
              store.people[org.name] = cur;
              await _fnDbPut(key, store);
              throw new Error('找不到「狀態歷史記錄」視窗的網址（已試 ' + nFail + ' 人就停手，避免壓到 EIP）。請把這行回報給開發者 → ' + _trialDiag);
            }
          }
          notify('status', { msg: lab + ' 挖第 ' + (i+1) + '/' + todo.length + ' 人：' + t.n, prog: { org:k+1, total:orgs.length, name:org.name, phase:'dig', page:i+1, rows:todo.length } });
        }
        // ★ 跨月保留：這個月沒出現的人不刪掉（下個月他還在經營池，備註沒變就不用再挖）
        Object.keys(prev).forEach(function(nm){ if (!cur[nm]) cur[nm] = prev[nm]; });
        store.people[org.name] = cur;
        var okT = await _fnDbPut(key, store);            // 每家存一次，中途關掉也不會全白跑
        if (!okT) _safeSet(key, JSON.stringify(store));
        if (k < orgs.length - 1){ notify('status', { msg: lab + ' 完成，停 3 秒讓 EIP 喘口氣…', prog: { org:k+1, total:orgs.length, name:org.name, phase:'done' } }); await sleep(TRIAL_ORG_GAP_MS); }
      }
    } finally { try { clearInterval(kaTimer); } catch(e){} }

    _safeSet(cid + 'motiv_synced_trial', _nowStr());
    _safeSet(cid + 'motiv_updated_at', _nowStr());
    if (nScan === 0 && nFail > 0){
      notify('error', { mode:'trial', msg:'🔎 深挖失敗：抓不到「狀態歷史記錄」視窗（' + nFail + ' 人）。請把這行回報給開發者 → ' + _trialDiag });
      return;
    }
    notify('done', {
      mode: 'trial', trial: store, updateTime: _nowStr(),
      msg: '🔎 試聽深挖完成（' + reg.label + '）！本月面談 ' + nPeople + ' 人，新挖 ' + nScan + ' 人、跳過 ' + nSkip + ' 人（已註冊/已繳費，或先前挖過）' + (nFail ? '、失敗 ' + nFail + ' 人' : '')
    });
  }

  // ★ 跨分頁鎖：_syncBusy 只鎖得住自己這個分頁。同一台電腦開兩個分頁各按一次，
  //   EIP 就會被兩條線同時打。用 localStorage 當跨分頁鎖，每 5 秒心跳一次，30 秒沒心跳視為死鎖自動解開。
  var EIP_LOCK_KEY = 'eip_sync_lock_v1', EIP_LOCK_STALE_MS = 30000;
  var _lockId = Math.random().toString(36).slice(2), _lockTimer = null;
  function _lockRead(){ try { return JSON.parse(localStorage.getItem(EIP_LOCK_KEY) || 'null'); } catch(e){ return null; } }
  function _lockAcquire(mode){
    var cur = _lockRead();
    if (cur && cur.id !== _lockId && (Date.now() - (cur.ts || 0)) < EIP_LOCK_STALE_MS) return cur;   // 別的分頁正在跑
    try { localStorage.setItem(EIP_LOCK_KEY, JSON.stringify({ id: _lockId, mode: mode, ts: Date.now() })); } catch(e){}
    if (_lockTimer) clearInterval(_lockTimer);
    _lockTimer = setInterval(function(){
      try { localStorage.setItem(EIP_LOCK_KEY, JSON.stringify({ id: _lockId, mode: mode, ts: Date.now() })); } catch(e){}
    }, 5000);
    return null;
  }
  function _lockRelease(){
    if (_lockTimer){ clearInterval(_lockTimer); _lockTimer = null; }
    try { var cur = _lockRead(); if (cur && cur.id === _lockId) localStorage.removeItem(EIP_LOCK_KEY); } catch(e){}
  }
  var _syncBusy = false; // ★ v5.5：全域單一同步鎖 — 同時間只允許一個模式抓 EIP
  async function doSync(year, month, mode){
    mode = mode || 'motiv';
    if (_syncBusy){
      console.warn('[EIP Content] 已有同步進行中，拒絕新請求 mode=' + mode);
      notify('error', { mode: String(mode).split(':')[0], msg: '已有另一個同步正在進行，請等它跑完再按（避免同時抓 EIP）' });
      return;
    }
    var held = _lockAcquire(mode);
    if (held){
      notify('error', { mode: String(mode).split(':')[0], msg: '另一個分頁正在同步「' + (held.mode || '?') + '」，同時抓會壓到 EIP。請等它跑完，或關掉那個分頁再試。' });
      return;
    }
    _syncBusy = true;
    try {
      console.log('[EIP Content] ★ doSync 開始 year=' + year + ' month=' + month + ' mode=' + mode);
      if (mode === 'motiv') await syncMotiv(year, month);
      else if (mode === 'checkin') await syncCheckin(year, month);
      else if (mode === 'channel') await syncChannel(year, month);
      else if (mode === 'funnel') await syncFunnel(year, month, {});
      else if (mode === 'funnel:full') await syncFunnel(year, month, { full: true });
      else if (mode.indexOf('trialone:') === 0){
        var oneArg = JSON.parse(decodeURIComponent(mode.slice(9)));
        await syncTrialOne(year, month, oneArg.org, oneArg.name, oneArg.id, oneArg.d);
      }
      else if (mode === 'trial' || mode.indexOf('trial:') === 0) await syncTrial(year, month, mode.indexOf(':') > 0 ? mode.split(':')[1] : 'all');
      else throw new Error('未知的同步模式: ' + mode);
    } catch(err){
      console.error('[EIP Content] 同步失敗:', err);
      var msg = err.message || String(err);
      if (msg.indexOf('context invalidated') >= 0 || msg.indexOf('Extension context') >= 0)
        msg = '擴充剛更新過 — 請把這個頁面重新整理（Cmd+R）一次再同步';
      else if (msg.indexOf('Failed to fetch') >= 0 || msg.indexOf('NetworkError') >= 0)
        msg = '無法連線 EIP — 請確認已登入且網路正常';
      notify('error', { mode: String(mode).split(':')[0], msg: msg });
    } finally {
      _syncBusy = false;
      _lockRelease();
    }
  }

  // 顯示真實 manifest 版本，方便驗證有沒有正確 reload 擴充包
  try{
    var ver = chrome.runtime.getManifest().version;
    console.log('[EIP Content] ✅ 已載入 v' + ver);
  }catch(e){
    console.log('[EIP Content] ✅ 已載入');
  }
})();

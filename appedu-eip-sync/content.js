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
  var EIP_THROTTLE_MS = 400;

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

  async function fetchListCounts(params, label){
    var qs = buildTotalQuery(params);
    // ★ v5.4：只走 CSV（不限筆數一次拿全部）。CSV 失敗就停下來，絕不退回逐頁狂掃 EIP（避免拖垮）。
    var csv = await fetchViaBackground('http://eip.appedu.com.tw/outlet/list/total_csv.php?' + qs);
    if (!csv || csv.indexOf('<html') >= 0 || csv.indexOf('<!DOCTYPE') >= 0){
      throw new Error(label + '：EIP 回傳網頁而非 CSV — 多半是未登入或忙線，請稍後再試（不逐頁抓以免拖垮 EIP）');
    }
    var counts = countsFromCSV(csv);
    if (!counts) counts = emptyCounts(); // 有 CSV 但解析不出表頭（可能該查詢本月 0 筆）→ 當成 0，不報錯
    console.log('[EIP Content] ' + label + ' CSV: ' + counts.total + ' 筆');
    return counts;
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
    var NEED = { org:'組織', owner:'業績承辦人', main:'通路來源主類別', sub:'通路來源副類別', course:'課程名稱', note:'狀態備註', item:'收支項目', perf:'業績合計', inDate:'入帳日期' };
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
      out.push({ org: cell('org'), owner: cell('owner'), main: cell('main'), sub: cell('sub'), course: cell('course'), item: cell('item'), value: val });
    }
    console.log('[EIP Content] 收支明細: 取 ' + out.length + ' 筆（剔除 不計業績=' + skipNote + ' 非當月負向=' + skipOld + '）');
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
    var byOrg = {}; // 學院 -> 課程 -> { value, count }
    (moneyRows || []).forEach(function(r){
      var org = (r.org || '').trim();
      if (COURSE_ACADEMIES.indexOf(org) < 0) return;   // 只收五區的 13 家學院
      var course = (r.course || '').trim();
      if (!course) return;                              // 無課程名稱（介紹費等）略過
      if (!byOrg[org]) byOrg[org] = {};
      if (!byOrg[org][course]) byOrg[org][course] = { value: 0, count: 0 };
      byOrg[org][course].value += r.value;
      byOrg[org][course].count += 1;
    });
    var out = { meta: { year: year, month: month }, byOrg: {} };
    Object.keys(byOrg).forEach(function(org){
      out.byOrg[org] = Object.keys(byOrg[org])
        .map(function(c){ return { name: c, value: Math.round(byOrg[org][c].value), count: byOrg[org][c].count }; })
        .filter(function(x){ return x.value !== 0; });
    });
    return out;
  }

  async function fetchCheckin(year, month){
    var monthStart = year + '/' + month + '/01';
    var lastDay = new Date(parseInt(year, 10), parseInt(month, 10), 0).getDate();
    var monthEnd = year + '/' + month + '/' + pad2(lastDay);
    var now = new Date();
    var isCurrentMonth = (now.getFullYear() === parseInt(year, 10) && (now.getMonth() + 1) === parseInt(month, 10));
    var rsStart = isCurrentMonth ? (now.getFullYear() + '/' + pad2(now.getMonth() + 1) + '/' + pad2(now.getDate())) : monthStart;

    notify('status', { msg: '正在同步已報到名單 (1/3)...' });
    var formal = await fetchListCounts({ q7: monthStart, q16: 'formal' }, '已報到');
    await sleep(EIP_THROTTLE_MS);
    notify('status', { msg: '正在同步網路已報到 (2/3)...' });
    var net = await fetchListCounts({ q7: monthStart, q16: 'formal', q13: '3' }, '網路已報到');
    await sleep(EIP_THROTTLE_MS);
    notify('status', { msg: '正在同步到月底預約報到 (3/3)...' });
    var rs = await fetchListCounts({ q7: rsStart, q8: monthEnd, q16: '2' }, '預約報到');

    return { formal: formal, net: net, rs: rs, meta: { year: year, month: month, rsStart: rsStart, rsEnd: monthEnd } };
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
    var perfPTotal = 0;
    if (perfPData){ for (var po in perfPData.orgs) perfPTotal += perfPData.orgs[po].length; }

    var cid = _cid(), ts = _nowStr();
    var pairs = [
      [cid + 'motiv_academy_v1', JSON.stringify(academyData)],
      [cid + 'motiv_sales_v1', JSON.stringify(salesData)],
      [cid + 'motiv_group_performance_v1', JSON.stringify(groupData)],
      [cid + 'motiv_group_performance_meta', JSON.stringify({ year: year, month: month })],
      [cid + 'motiv_reserve_performance_v1', JSON.stringify(reserveData)],
      [cid + 'motiv_reserve_performance_meta', JSON.stringify({ year: year, month: month })],
      [cid + 'motiv_perfp_v1', JSON.stringify(perfPData || { orgs:{}, meta:{ year: year, month: month } })],
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
    });
  }

  // ── 模式 B：報到排名（已報到 / 網路已報到 / 到月底預約報到，全走 CSV） ──
  async function syncCheckin(year, month){
    var checkinData = await fetchCheckin(year, month);
    var cid = _cid(), ts = _nowStr();
    _safeSet(cid + 'motiv_checkin_v1', JSON.stringify(checkinData));
    _safeSet(cid + 'motiv_synced_checkin', ts);
    _safeSet(cid + 'motiv_updated_at', ts);
    notify('done', {
      mode: 'checkin', checkin: checkinData, updateTime: ts,
      msg: '🚪 報到排名同步完成！已報到 ' + checkinData.formal.total + ' / 網路 ' + checkinData.net.total + ' / 到月底 ' + checkinData.rs.total + ' 筆'
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
    notify('done', {
      mode: 'channel', channel: channelData, course: courseData, updateTime: ts,
      msg: '📋 各通路績效同步完成！' + nChan + '/6 通路、共 ' + (moneyRows ? moneyRows.length : 0) + ' 筆收支'
    });
  }

  var _syncBusy = false; // ★ v5.5：全域單一同步鎖 — 同時間只允許一個模式抓 EIP
  async function doSync(year, month, mode){
    mode = mode || 'motiv';
    if (_syncBusy){
      console.warn('[EIP Content] 已有同步進行中，拒絕新請求 mode=' + mode);
      notify('error', { mode: mode, msg: '已有另一個同步正在進行，請等它跑完再按（避免同時抓 EIP）' });
      return;
    }
    _syncBusy = true;
    try {
      console.log('[EIP Content] ★ doSync 開始 year=' + year + ' month=' + month + ' mode=' + mode);
      if (mode === 'motiv') await syncMotiv(year, month);
      else if (mode === 'checkin') await syncCheckin(year, month);
      else if (mode === 'channel') await syncChannel(year, month);
      else throw new Error('未知的同步模式: ' + mode);
    } catch(err){
      console.error('[EIP Content] 同步失敗:', err);
      var msg = err.message || String(err);
      if (msg.indexOf('context invalidated') >= 0 || msg.indexOf('Extension context') >= 0)
        msg = '擴充剛更新過 — 請把這個頁面重新整理（Cmd+R）一次再同步';
      else if (msg.indexOf('Failed to fetch') >= 0 || msg.indexOf('NetworkError') >= 0)
        msg = '無法連線 EIP — 請確認已登入且網路正常';
      notify('error', { mode: mode, msg: msg });
    } finally {
      _syncBusy = false;
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

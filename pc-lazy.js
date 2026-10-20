/* pc-lazy.js — 業績數據中心「按到才載」的功能（提案 2，10/19）。
   由 performance-compare 拆出；改這些功能請改這個檔。
   內含：90 秒回顧、績效盤點、榮譽卡、通路 Excel 匯入、教學視窗、每日總結下載／複製、人均收入 PNG、激勵匯入、知識庫、編輯追蹤儀表板、檢討報告 */
function _invYmOf(m){ var hit = null; _fnYmList().forEach(function(y){ if (+y.slice(5) === m) hit = y; }); return hit; }
function _invShift(ym, k){ var y = +ym.slice(0,4), m = +ym.slice(5) + k; while (m < 1){ m += 12; y--; } while (m > 12){ m -= 12; y++; } return y + '-' + _ckPad2(m); }
function _invD(s){ var mm = /(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/.exec(String(s || '')); return mm ? mm[1] + '-' + _ckPad2(+mm[2]) + '-' + _ckPad2(+mm[3]) : ''; }
function _invCls(sub, ym){
      sub = String(sub || '').trim(); var ymU = ym.replace('-', '_');
      if (/^(FB|部落格|Google)/i.test(sub) || /億捷/.test(sub)) return 'net';
      var mm = /^(\d{4})_(\d{2})/.exec(sub); if (mm) return (mm[1] + '_' + mm[2] === ymU) ? 'fairCur' : 'fairOld';
      if (/^\d{4}/.test(sub)) return 'fairOld';
      if (/學員加購/.test(sub)) return 'buy';
      if (/學員介紹/.test(sub)) return 'intro';
      return 'other';
    }
function _invPool(org, ym){
      var pay = {}, itv = {}, meta = null;
      [0, -1, -2].forEach(function(k){
        var y2 = _invShift(ym, k), raw = null; try { raw = _fnRawFor(y2); } catch(e){}
        if (!raw || !raw.orgs) return; if (k === 0) meta = raw.meta || null;
        var o = raw.orgs[org] || {};
        (o.pay || []).forEach(function(p){ var key = [p.n, p.k, p.d, p.v, p.o, p.sub].join('|'); if (!pay[key]) pay[key] = p; });
        (o.itv || []).forEach(function(x){ var key = (x.id || '') + '|' + x.n + '|' + x.d; if (!itv[key]) itv[key] = x; });
      });
      return { pay:Object.keys(pay).map(function(k){ return pay[k]; }), itv:Object.keys(itv).map(function(k){ return itv[k]; }), meta:meta };
    }
function _invMoney(v){ return v ? Math.round(v).toLocaleString() : '<span class="inv-z">0</span>'; }
function _invCalc(org, ym){
      var P = _invPool(org, ym), m0 = ym + '-01', m1 = _invShift(ym, 1) + '-01', p2 = _invShift(ym, -2) + '-01';
      var inM = function(d){ return d >= m0 && d < m1; }, inPrev = function(d){ return d >= p2 && d < m0; };
      var month = P.pay.filter(function(p){ return inM(_invD(p.d)) && (+p.v || 0) !== 0; });
      var prevBy = {}; P.pay.forEach(function(p){ var d = _invD(p.d); if (inPrev(d)) prevBy[p.n] = (prevBy[p.n] || 0) + (+p.v || 0); });
      var sdBy = {}; P.itv.forEach(function(x){ var sd = _invD(x.sd); if (!sd) return; if (!sdBy[x.n] || sd < sdBy[x.n]) sdBy[x.n] = sd; });
      var seen = {}; P.itv.forEach(function(x){ seen[x.n] = 1; });
      var rows = {}, other = {}, q = [], stu = {};
      var row = function(o){ return rows[o] || (rows[o] = { o:o, net:0, fairCur:0, fairOld:0, buy:0, intro:0, total:0, rc:0, rcN:{}, rcSd:0, rcSdN:{}, rcFair:0, rcFairN:{} }); };
      month.forEach(function(p){ var c = _invCls(p.sub, ym); if (c === 'other'){ other[p.sub || '（空白）'] = 1; c = 'intro'; } var r = row(p.o || '（沒有承辦人）'); r[c] += +p.v || 0; r.total += +p.v || 0;
        var s = stu[p.n] || (stu[p.n] = { n:p.n, rows:[], old:false, viaSd:false, viaFair:false }); s.rows.push(Object.assign({ cls:c }, p)); });
      // 追回：以學生為單位
      var rc = { amt:0, names:{}, sdNames:{}, fairNames:{} };
      Object.keys(stu).forEach(function(n){
        var s = stu[n], sd = sdBy[n] || '';
        s.viaSd = !!(sd && sd < m0); s.viaFair = s.rows.some(function(p){ return _invCls(p.sub, ym) === 'fairOld'; });
        if (!s.viaSd && !s.viaFair) return;
        var prev = prevBy[n] || 0, allBuy = s.rows.every(function(p){ return /學員加購/.test(p.sub || ''); });
        if (allBuy && sd && sd < p2) prev = Math.max(prev, 20000);
        var mark = '';
        if (prev >= 20000) return;
        if (prev > 2000) mark = '?';
        s.rc = true; s.mark = mark; s.prev = prev; if (mark) q.push(n + '（之前繳 ' + Math.round(prev).toLocaleString() + '）');
        var src = s.viaSd ? 'sd' : 'fair';
        s.rows.forEach(function(p){ var r = row(p.o || '（沒有承辦人）'), v = +p.v || 0; r.rc += v; r.rcN[n] = 1; if (src === 'sd'){ r.rcSd += v; r.rcSdN[n] = 1; } else { r.rcFair += v; r.rcFairN[n] = 1; } rc.amt += v; rc.names[n] = 1; (src === 'sd' ? rc.sdNames : rc.fairNames)[n] = 1; });
      });
      var list = Object.keys(rows).map(function(k){ return rows[k]; }).sort(function(a,b){ return b.total - a.total; });
      return { org:org, ym:ym, rows:list, other:Object.keys(other), q:q, rc:rc, meta:P.meta, hasData:month.length > 0, stu:stu };
    }
function _invSide(org, ym){
      try {
        var d = _fnDataFor(ym), st = _fnOrgStats(d, org, ym), a = st.auto || {}, ck = d.checkin || {};
        var net = _ckNum(((ck.net || {}).byAcademy || {})[org]), rs = _ckNum(((ck.rs || {}).byAcademy || {})[org]);
        var pc = function(n, m){ return m ? (Math.round(n / m * 1000) / 10) + '%' : '—'; };
        return [ ['網路報到', net], ['目前總報到', st.checkin, 'hi'], ['到月底報到', rs], ['面談', st.interview], ['面談 → 報名', pc(st.signup, st.interview)], ['面談 → 試聽', pc(st.trial, st.interview)],
          ['當下註冊', st.onsite, 'hi'], ['追回（非當月試聽後）', (st.harvest != null ? st.harvest + ' 位' : '—'), 'hi'], ['經營中／經營池', (a.mgmt ? a.mgmt.length : st.mgmt) + '／' + (a.pool ? a.pool.length : '—')], ['流失', a.lost ? a.lost.length : '—'] ];
      } catch(e){ console.warn('[inv side]', e); return null; }
    }
function _invBottom(org, ym){
      try {
        var pp = _fnDataFor(ym).perfp, rows = (pp && pp.orgs && pp.orgs[org]) || []; if (!rows.length) return '';
        var t = { c1:0, c2:0, c3:0, c4:0, bizA:0, bizB:0, goal:0, biz:0, pb:0 };
        rows.forEach(function(r){ var bA = _ckNum(r.new_perf), b = _ckNum(r.business); t.c1 += _ckNum(r.count1); t.c2 += _ckNum(r.count2); t.c3 += _ckNum(r.count3); t.c4 += _ckNum(r.count4); t.bizA += bA; t.biz += b; t.bizB += b - bA; t.goal += _ckNum(r.goal); t.pb += _ckNum(r.pay_back); });
        var r1 = t.c1 ? Math.round(t.c2 / t.c1 * 100) : 0, r2 = t.c1 ? Math.round(t.c3 / t.c1 * 100) : 0, r3 = Math.round(r1 * r2 / 100), r4 = t.goal ? Math.round(t.biz / t.goal * 100) : 0;
        var td = function(v){ return '<td>' + v + '</td>'; }, f = function(v){ return Math.round(v).toLocaleString(); };
        return '<table class="inv-b"><thead><tr><th>學院</th><th>面談</th><th>報名</th><th>註冊Ⓐ</th><th>業績Ⓐ</th><th>面談率</th><th>註冊率</th><th>成功率</th><th>註冊Ⓑ</th><th>業績Ⓑ</th><th>個人目標</th><th>業績</th><th>達成率</th><th>退費金額</th></tr></thead>'
          + '<tbody><tr>' + td('<b>' + _fnEsc(org) + '</b>') + td(t.c1) + td(t.c2) + td(t.c3) + td(f(t.bizA)) + td(r1 + '%') + td(r2 + '%') + td(r3 + '%') + td(t.c4) + td(f(t.bizB)) + td(f(t.goal)) + td(f(t.biz)) + td(r4 + '%') + td(f(t.pb)) + '</tr></tbody></table>';
      } catch(e){ console.warn('[inv bottom]', e); return ''; }
    }
function _invTable(C){
      var ym = C.ym, M = +ym.slice(5), y = +ym.slice(0,4), dim = new Date(y, M, 0).getDate(), now = new Date();
      var endD = (now.getFullYear() === y && now.getMonth() + 1 === M) ? now.getDate() : dim;
      var head = '<div class="inv-card"><div class="inv-h"><b>' + _fnEsc(C.org) + ' ' + M + ' 月績效盤點</b><small>通路區間：' + M + '/1–' + M + '/' + endD + '</small></div>';
      if (!C.hasData) return head + '<div class="ck-empty">這個月沒有入帳明細</div></div>';
      var side = _invSide(C.org, ym), sideH = side ? '<div class="inv-side"><h5>報到與漏斗<small>（代替通路筆數）</small></h5>' + side.map(function(x){ return '<div class="inv-kv' + (x[2] ? ' hi' : '') + '"><span>' + x[0] + '</span><b>' + x[1] + '</b></div>'; }).join('') + '</div>' : '';
      var T = { net:0, fairCur:0, fairOld:0, buy:0, intro:0, total:0, rc:0, rcSd:0, rcFair:0 };
      var cell = function(v){ return '<td class="inv-n">' + _invMoney(v) + '</td>'; };
      var rcCell = function(amt, nN, sdA, sdN, fA, fN){ if (!amt) return '<td class="inv-rc"><span class="inv-z">0</span></td>'; return '<td class="inv-rc"><b>' + Math.round(amt).toLocaleString() + '・' + nN + ' 位</b><small>' + (sdN ? '查得到報到 ' + _invW(sdA) + ' 萬・' + sdN + ' 位' : '') + (sdN && fN ? '／' : '') + (fN ? '舊展場 ' + _invW(fA) + ' 萬・' + fN + ' 位' : '') + '</small></td>'; };
      var body = C.rows.map(function(r){ ['net','fairCur','fairOld','buy','intro','total','rc','rcSd','rcFair'].forEach(function(k){ T[k] += r[k]; });
        return '<tr><td class="inv-o">' + _fnEsc(r.o) + '</td>' + cell(r.net) + cell(r.fairCur) + cell(r.fairOld) + cell(r.buy) + cell(r.intro) + '<td class="inv-n inv-t">' + _invMoney(r.total) + '</td>' + rcCell(r.rc, Object.keys(r.rcN).length, r.rcSd, Object.keys(r.rcSdN).length, r.rcFair, Object.keys(r.rcFairN).length) + '</tr>'; }).join('');
      var tot = '<tr class="inv-sum"><td>總計</td>' + cell(T.net) + cell(T.fairCur) + cell(T.fairOld) + cell(T.buy) + cell(T.intro) + '<td class="inv-n inv-t">' + _invMoney(T.total) + '</td>' + rcCell(C.rc.amt, Object.keys(C.rc.names).length, T.rcSd, Object.keys(C.rc.sdNames).length, T.rcFair, Object.keys(C.rc.fairNames).length) + '</tr>';
      var notes = '<div class="inv-notes"><div>同步時間：' + _fnEsc((C.meta && C.meta.syncedAt) || '—') + '</div>'
        + '<div>通路對應：網際網路＝FB IG 廣告、部落格、Google、億捷；當月展場＝' + ym.replace('-', '_') + ' 開頭；當月以前展場＝其他年份開頭的展場；基本通路＝學員加購；其它通路＝學員介紹' + (C.other.length ? '；對不到的也歸其它通路：' + _fnEsc(C.other.join('、')) : '') + '</div>'
        + '<div>追回＝這位學生當月以前就報到過、或是舊展場名單，而且之前合計繳費在 2,000 元內，這個月繳的錢全算，含記成學員加購的；之前已繳 2 萬以上的是舊生加購不算</div>'
        + (C.q.length ? '<div>「?」＝之前繳 2,000～20,000 之間，先算追回，要再看：' + _fnEsc(C.q.join('、')) + '</div>' : '') + '</div>';
      return head + '<div class="inv-grid">' + sideH + '<div class="inv-main"><table class="inv-t"><thead><tr><th>業績承辦人</th><th>網際網路</th><th>當月展場</th><th>當月以前展場</th><th>基本通路<small>學員加購</small></th><th>其它通路<small>學員介紹</small></th><th>總計</th><th>報未註追回<small>已含在左邊各欄・之前繳 2 千內才算</small></th></tr></thead><tbody>' + body + tot + '</tbody></table></div></div>' + _invBottom(C.org, ym) + notes + '</div>';
    }
function invPrint(){ _invPrintPrep(); setTimeout(function(){ window.print(); }, 80); }
// ★ 10/20 楚門回報：存 PDF 會切成兩頁、還印出 11 頁空白
//   改法：把盤點卡片複製到一個獨立的列印框（其他畫面一律不印＝不會有空白頁），
//   版面固定成 A4 橫式可印寬度，量每張卡片的高度，太高就整張等比例縮小 → 一個學院一定只佔一頁。
//   按「🖨 列印 / 存 PDF」或直接 ⌘P 都會走這套。
function _invPrintPrep(){
  var panel = document.getElementById('inventoryPanel'); if (!panel || !panel.offsetParent) return false;
  _invPrintDone();
  var st = document.createElement('style'); st.id = 'invPrintStyle';
  st.textContent = '@page { size:A4 landscape; margin:7mm; }'
    + '@media print { body.printing-inv > *:not(#invPrintBox){ display:none !important; } body.printing-inv { background:#fff !important; } }'
    + '#invPrintBox { position:absolute; left:-99999px; top:0; width:1069px; background:#fff; }'
    + '@media print { #invPrintBox { position:static; left:auto; } }'
    + '#invPrintBox .inv-bar { display:none !important; }'
    + '#invPrintBox .inv-card { box-sizing:border-box; width:1069px; margin:0; border:0; box-shadow:none; break-after:page; page-break-after:always; break-inside:avoid; }'
    + '#invPrintBox .inv-card:last-child { break-after:auto; page-break-after:auto; }'
    + '#invPrintBox .inv-main { overflow:visible !important; }'
    + '#invPrintBox, #invPrintBox * { visibility:visible !important; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }';
  document.head.appendChild(st);
  var box = document.createElement('div'); box.id = 'invPrintBox'; box.innerHTML = panel.innerHTML;
  document.body.appendChild(box);
  document.body.classList.add('printing-inv');
  var PAGE_H = 735;   // A4 橫式扣掉 7mm 邊界 ≈ 196mm ≈ 740px，留一點餘裕
  [].forEach.call(box.querySelectorAll('.inv-card'), function(c){
    // 第一輪：寬或高超出就算縮放比；把卡片版面寬度放大成 1069÷縮放比，縮完剛好填滿頁寬、表格不會被擠出右邊
    var z = Math.min(1, PAGE_H / c.scrollHeight, 1069 / c.scrollWidth);
    for (var pass = 0; pass < 3 && z < 1; pass++){
      c.style.width = Math.ceil(1069 / z) + 'px';
      var z2 = Math.min(1, PAGE_H / c.scrollHeight, (1069 / z) / c.scrollWidth * z);
      if (Math.abs(z2 - z) < 0.005){ z = z2; break; } z = z2;
    }
    if (z < 1){ z = Math.floor(z * 1000) / 1000; c.style.width = Math.ceil(1069 / z) + 'px'; c.style.zoom = String(z); }
  });
  return true;
}
function _invPrintDone(){
  document.body.classList.remove('printing-inv');
  var a = document.getElementById('invPrintStyle'); if (a) a.remove();
  var b = document.getElementById('invPrintBox'); if (b) b.remove();
}
window.addEventListener('beforeprint', function(){ if (!document.getElementById('invPrintBox')) _invPrintPrep(); });
window.addEventListener('afterprint', function(){ _invPrintDone(); });
function invRender(){
      var m = parseInt(document.getElementById('rcMonth').value, 10) || 1, acSel = document.getElementById('rcAcademy').value;
      var cont = document.getElementById('reportCardContainer'); if (!cont) return;
      var panel = document.getElementById('inventoryPanel'); if (!panel){ panel = document.createElement('div'); panel.id = 'inventoryPanel'; cont.parentNode.insertBefore(panel, cont); }
      var ym = _invYmOf(m);
      var orgs = acSel ? [INV_ORG_MAP[acSel] || acSel] : CK_ORG_LIST.slice();
      var mSel = '<select onchange="document.getElementById(\'rcMonth\').value=this.value;renderReportCard();invRender()">' + [1,2,3,4,5,6,7,8,9,10,11,12].map(function(x){ return '<option value="' + x + '"' + (x === m ? ' selected' : '') + '>' + x + ' 月</option>'; }).join('') + '</select>';
      var aSel = '<select onchange="document.getElementById(\'rcAcademy\').value=this.value;renderReportCard();invRender()"><option value=""' + (acSel ? '' : ' selected') + '>全部學院</option>' + Array.prototype.map.call(document.getElementById('rcAcademy').options, function(o){ return o.value ? '<option value="' + _fnEsc(o.value) + '"' + (o.value === acSel ? ' selected' : '') + '>' + _fnEsc(o.textContent) + '</option>' : ''; }).join('') + '</select>';
      var h = '<div class="inv-bar"><b>📋 績效盤點</b>' + mSel + aSel + '<small>切月份、切學院會直接重畫</small><button class="archive-btn" onclick="invPrint()">🖨 列印 / 存 PDF</button><button class="archive-btn" onclick="document.getElementById(\'inventoryPanel\').remove()">✕ 收起</button></div>';
      if (!ym){ panel.innerHTML = h + '<div class="inv-card"><div class="inv-h"><b>' + m + ' 月績效盤點</b></div><div class="ck-empty">這個月沒有入帳明細</div></div>'; return; }
      h += orgs.map(function(org){ try { return _invTable(_invCalc(org, ym)); } catch(e){ console.error('[inv]', org, e); return '<div class="inv-card"><div class="inv-h"><b>' + _fnEsc(org) + '</b></div><div class="ck-empty">算不出來：' + _fnEsc(e.message || e) + '</div></div>'; } }).join('');
      panel.innerHTML = h;
    }
function downloadChTemplate() {
      // Build template Excel with SheetJS
      const wb = XLSX.utils.book_new();
      const channels = [
        { name: '網際網路', targetType: '目標', target: 1500000 },
        { name: '學員加購', targetType: '目標', target: 500000 },
        { name: '展場活動', targetType: '低標', target: 500000 },
        { name: '學員介紹', targetType: '低標', target: 500000 },
        { name: '班務追回', targetType: '低標', target: 500000 },
        { name: '現＋刷',   targetType: '低標', target: 500000 }
      ];
      channels.forEach(ch => {
        const rows = [
          ['名次', '姓名', ch.name],
          [1, '（範例）王小明', 278993],
          [2, '（範例）陳大華', 251611],
          [3, '', ''],
          [4, '', ''],
          [5, '', ''],
          [6, '', ''],
          [7, '', ''],
          [8, '', ''],
          [9, '', ''],
          [10, '', ''],
          [],
          ['← 可往下新增更多人'],
          [],
          [],
          [ch.targetType, ch.target],
          ['學院', ch.name],
          ['高雄建國', ''],
          ['中壢學院', ''],
          ['中壢二部', ''],
          ['台中一部', ''],
          ['中壢三部', ''],
          ['台中三部', ''],
          ['台中二部', ''],
        ];
        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = [{ wch: 16 }, { wch: 18 }, { wch: 16 }];
        XLSX.utils.book_append_sheet(wb, ws, ch.name);
      });
      // Add instruction sheet at front
      const instrRows = [
        ['📋 各通路績效 Excel 匯入範本'],
        [''],
        ['【使用方式】'],
        ['1. 每個工作表（Sheet）對應一個通路'],
        ['2. 上半部填入個人排名：名次、姓名、數字（填原始數字，系統自動顯示為「萬」）'],
        ['3. 下半部填入學院合計：先填 目標/低標 + 目標數值，再填 學院名 + 數字'],
        ['4. 範本中的（範例）資料請覆蓋或刪除'],
        ['5. 可以往下新增更多列'],
        ['6. 填完後儲存，在系統中按「📥 匯入 Excel」上傳即可'],
        [''],
        ['【注意事項】'],
        ['• 數字請填原始數字（例如 278993），不要填「萬」'],
        ['• 工作表名稱不要修改（網際網路、學員加購...等）'],
        ['• 名次欄可以不填，系統會自動排序'],
      ];
      const instrWs = XLSX.utils.aoa_to_sheet(instrRows);
      instrWs['!cols'] = [{ wch: 60 }];
      XLSX.utils.book_append_sheet(wb, instrWs, '使用說明');
      // Move instruction sheet to front
      wb.SheetNames.unshift(wb.SheetNames.pop());
      XLSX.writeFile(wb, '各通路績效匯入範本.xlsx');
    }
function openChImport() {
      chParsedExcel = null;
      document.getElementById('chExcelInput').value = '';
      document.getElementById('chExcelFileName').textContent = '支援 .xlsx / .xls（Numbers 請先輸出為 Excel）';
      document.getElementById('chImportPreview').innerHTML = '';
      document.getElementById('chDoImportBtn').disabled = true;
      // Show month picker when in quarter view
      const picker = document.getElementById('chImportMonthPicker');
      if (chQuarterView) {
        const ms = chQuarterView.months;
        picker.innerHTML = '<div style="font-size:.85rem;color:#ffd700;margin-bottom:6px;">📅 匯入範圍</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
          `<label style="display:flex;align-items:center;gap:4px;padding:6px 12px;background:rgba(255,215,0,.12);border:1px solid #ffd700;border-radius:8px;cursor:pointer;font-size:.85rem;color:#ffd700;font-weight:700;"><input type="radio" name="chImportMonth" value="all" style="accent-color:#ffd700;" checked> 整季（${ms.map(m=>m+'月').join('+')}）</label>` +
          ms.map(m => `<label style="display:flex;align-items:center;gap:4px;padding:6px 12px;background:rgba(74,234,255,.06);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:.85rem;color:var(--text);"><input type="radio" name="chImportMonth" value="${m}" style="accent-color:#ffd700;"> 僅${m}月</label>`).join('') +
          '</div>';
        picker.style.display = 'block';
      } else {
        picker.style.display = 'none';
        picker.innerHTML = '';
      }
      document.getElementById('chImportModal').classList.add('open');
    }
function closeChImport() {
      document.getElementById('chImportModal').classList.remove('open');
    }
function chExcelSelected(inp) {
      const f = inp.files[0];
      if (!f) return;
      document.getElementById('chExcelFileName').textContent = f.name;
      const reader = new FileReader();
      reader.onload = function(e) {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array' });
          chParsedExcel = parseChExcel(wb);
          showChImportPreview(chParsedExcel);
          document.getElementById('chDoImportBtn').disabled = false;
        } catch (err) {
          document.getElementById('chImportPreview').innerHTML = '<div style="color:#ff6b6b;">❌ 檔案讀取失敗：' + err.message + '</div>';
        }
      };
      reader.readAsArrayBuffer(f);
    }
function parseChExcel(wb) {
      let result = {};
      let savedColMap = null;

      // === Strategy 1: Multi-sheet (one sheet per channel) ===
      if (wb.SheetNames.length >= 2) {
        wb.SheetNames.forEach(sheetName => {
          let chKey = null;
          const sn = sheetName.trim();
          if (CH_SHEET_MAP[sn]) chKey = CH_SHEET_MAP[sn];
          else { for (const [k, v] of Object.entries(CH_SHEET_MAP)) { if (sn.includes(k)) { chKey = v; break; } } }
          if (!chKey) return;
          const parsed = parseSingleChannelSheet(wb.Sheets[sheetName], chKey);
          if (parsed) result[chKey] = parsed;
        });
        if (Object.keys(result).length >= 2) return result;
      }

      // === Strategy 2: Single-sheet side-by-side (like Numbers export) ===
      // Approach: find ALL "名次" cells in header rows → detect column groups → identify channels
      result = {}; // reset
      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (!rows.length) continue;

        // Step 1: Find all "名次" cells in first 5 rows → each marks a column group start
        const groups = []; // [{rankCol, nameCol, valCol, headerRow, chKey}]
        for (let ri = 0; ri < Math.min(rows.length, 5); ri++) {
          const row = rows[ri] || [];
          for (let ci = 0; ci < row.length; ci++) {
            const cell = String(row[ci] || '').trim();
            if (cell === '名次') {
              // Found a column group: 名次(ci), 姓名(ci+1), value(ci+2)
              const nextCell = ci + 1 < row.length ? String(row[ci + 1] || '').trim() : '';
              if (nextCell === '姓名' || nextCell === '') {
                // Check ci+2 for channel name (same row or rows above/below)
                let chKey = null;
                // Check same row ci+2
                const valHeader = ci + 2 < row.length ? String(row[ci + 2] || '').trim() : '';
                if (valHeader) {
                  for (const [k, v] of Object.entries(CH_SHEET_MAP)) {
                    if (valHeader === k || valHeader.includes(k)) { chKey = v; break; }
                  }
                }
                // Check row above for channel name spanning this area
                if (!chKey && ri > 0) {
                  for (let ck = ci; ck <= ci + 2 && ck < (rows[ri-1]||[]).length; ck++) {
                    const above = String((rows[ri-1]||[])[ck] || '').trim();
                    if (!above) continue;
                    for (const [k, v] of Object.entries(CH_SHEET_MAP)) {
                      if (above === k || above.includes(k)) { chKey = v; break; }
                    }
                    if (chKey) break;
                  }
                }
                // Avoid duplicates
                if (chKey && !groups.find(g => g.chKey === chKey)) {
                  groups.push({ rankCol: ci, nameCol: ci + 1, valCol: ci + 2, headerRow: ri, chKey });
                } else if (!chKey) {
                  // Unknown channel — assign later by position order
                  groups.push({ rankCol: ci, nameCol: ci + 1, valCol: ci + 2, headerRow: ri, chKey: null });
                }
              }
            }
          }
        }

        // Step 1b: If no "名次" found, try finding channel names directly in headers
        if (groups.length === 0) {
          for (let ri = 0; ri < Math.min(rows.length, 5); ri++) {
            const row = rows[ri] || [];
            for (let ci = 0; ci < row.length; ci++) {
              const cell = String(row[ci] || '').trim();
              if (!cell) continue;
              let matchedKey = null;
              for (const [k, v] of Object.entries(CH_SHEET_MAP)) {
                if (cell === k || cell.includes(k)) { matchedKey = v; break; }
              }
              if (matchedKey && !groups.find(g => g.chKey === matchedKey)) {
                // Assume pattern: 名次(ci-2), 姓名(ci-1), value(ci)
                const ll = ci >= 2 ? String(row[ci-2] || '').trim() : '';
                const l = ci >= 1 ? String(row[ci-1] || '').trim() : '';
                if (ll === '名次' && l === '姓名') {
                  groups.push({ rankCol: ci-2, nameCol: ci-1, valCol: ci, headerRow: ri, chKey: matchedKey });
                }
              }
            }
          }
        }

        // Step 1c: Assign unidentified groups to channels by position order
        if (groups.length >= 2) {
          groups.sort((a, b) => a.rankCol - b.rankCol);
          const usedKeys = new Set(groups.filter(g => g.chKey).map(g => g.chKey));
          const availKeys = CH_CHANNELS.map(c => c.key).filter(k => !usedKeys.has(k));
          let ai = 0;
          groups.forEach(g => {
            if (!g.chKey && ai < availKeys.length) { g.chKey = availKeys[ai++]; }
          });
          // Remove groups still without a key
          const validGroups = groups.filter(g => g.chKey);
          if (validGroups.length < 2) continue;

          savedColMap = validGroups;
          const detectedHeaderRow = Math.max(...validGroups.map(g => g.headerRow));
          const dataStartRow = detectedHeaderRow + 1;

          // Step 2: Find where ranking data ends
          let rankEndRow = rows.length;
          for (let ri = dataStartRow; ri < rows.length; ri++) {
            const row = rows[ri] || [];
            const allVals = row.map(c => String(c || '').trim());
            if (allVals.includes('目標') || allVals.includes('低標')) { rankEndRow = ri; break; }
            // Check for mostly empty row followed by academy markers
            const filled = allVals.filter(v => v !== '').length;
            if (filled === 0) {
              let foundAcad = false;
              for (let rj = ri + 1; rj < Math.min(ri + 4, rows.length); rj++) {
                const rr = (rows[rj] || []).map(c => String(c || '').trim());
                if (rr.includes('目標') || rr.includes('低標') || rr.includes('學院')) { foundAcad = true; break; }
              }
              if (foundAcad) { rankEndRow = ri; break; }
            }
          }

          // Step 3: Parse ranking for each channel group
          validGroups.forEach(cm => {
            const ranking = [];
            for (let ri = dataStartRow; ri < rankEndRow; ri++) {
              const row = rows[ri] || [];
              const name = String(row[cm.nameCol] || '').trim();
              const valRaw = String(row[cm.valCol] || '').replace(/,/g, '');
              const value = parseFloat(valRaw) || 0;
              if (name && value && !/^(名次|姓名)$/.test(name)) {
                ranking.push({ name, value });
              }
            }
            ranking.sort((a, b) => b.value - a.value);
            const chInfo = CH_CHANNELS.find(c => c.key === cm.chKey);
            result[cm.chKey] = { ranking, academies: [], target: chInfo?.target || 0, targetType: chInfo?.targetType || 'low' };
          });

          // Step 4: Parse academy sections (below ranking area)
          // Strategy A: Channel-name-driven — find each channel's academy block by scanning
          //   for rows containing the channel name near 目標/低標/學院 markers
          const acadBlocks = []; // [{chKey, targetRow, acadStartRow, col}]
          for (let ri = rankEndRow; ri < rows.length; ri++) {
            const row = (rows[ri] || []).map(c => String(c || '').trim());
            for (let ci = 0; ci < row.length; ci++) {
              // Look for channel names anywhere in academy area
              const cell = row[ci];
              if (!cell) continue;
              let foundKey = null;
              for (const [k, v] of Object.entries(CH_SHEET_MAP)) {
                if (cell === k || cell.includes(k)) { foundKey = v; break; }
              }
              if (foundKey && result[foundKey] && !acadBlocks.find(b => b.chKey === foundKey)) {
                // Found a channel name — look for CLOSEST 目標/低標 nearby
                let targetRow = -1, targetCol = -1, tType = '', tVal = 0, bestDist = 999;
                for (let rr = Math.max(rankEndRow, ri - 2); rr <= Math.min(ri + 1, rows.length - 1); rr++) {
                  const r = (rows[rr] || []).map(c => String(c || '').trim());
                  for (let cc = Math.max(0, ci - 3); cc <= ci + 3 && cc < r.length; cc++) {
                    if (r[cc] === '目標' || r[cc] === '低標') {
                      const dist = Math.abs(cc - ci) + Math.abs(rr - ri);
                      if (dist < bestDist) {
                        bestDist = dist;
                        targetRow = rr;
                        targetCol = cc;
                        tType = r[cc] === '目標' ? 'goal' : 'low';
                        tVal = parseFloat(String(r[cc + 1] || '0').replace(/,/g, '')) || 0;
                      }
                    }
                  }
                }
                // Determine academy data column — the column where academy names will be
                // It's typically at targetCol or the column where the channel name's 學院 label is
                const acadCol = targetCol >= 0 ? targetCol : ci;
                // Find the first academy data row (skip header rows with 目標/低標/學院)
                let startRow = ri + 1;
                // Scan a few rows to find the first actual academy name
                for (let aj = Math.max(rankEndRow, ri - 1); aj < Math.min(rows.length, ri + 4); aj++) {
                  const ar = (rows[aj] || []).map(c => String(c || '').trim());
                  const cellAt = ar[acadCol] || '';
                  if (cellAt && !['目標','低標','學院'].includes(cellAt) && DEFAULT_ACADEMIES.includes(cellAt)) {
                    startRow = aj;
                    break;
                  }
                  // Also check if it's a non-keyword, non-channel name with a numeric value next to it
                  if (cellAt && !['目標','低標','學院',''].includes(cellAt)) {
                    let isChName = false;
                    for (const k of Object.keys(CH_SHEET_MAP)) { if (cellAt.includes(k)) { isChName = true; break; } }
                    if (!isChName) {
                      const testVal = parseFloat(String((rows[aj] || [])[acadCol + 1] || '0').replace(/,/g, '')) || 0;
                      if (testVal > 0) { startRow = aj; break; }
                    }
                  }
                }
                acadBlocks.push({ chKey: foundKey, targetRow, acadCol, startRow, tType, tVal });
              }
            }
          }

          // Parse academy rows for each detected block
          acadBlocks.forEach(block => {
            if (!result[block.chKey]) return;
            if (block.tVal) {
              result[block.chKey].target = block.tVal;
              result[block.chKey].targetType = block.tType;
            }
            const academies = [];
            for (let aj = block.startRow; aj < rows.length; aj++) {
              const ar = rows[aj] || [];
              const aName = String(ar[block.acadCol] || '').trim();
              const aVal = parseFloat(String(ar[block.acadCol + 1] || '0').replace(/,/g, '')) || 0;
              if (!aName) break;
              // Stop if hitting another section marker
              if (['目標','低標','學院'].includes(aName)) break;
              // Stop if hitting another channel name
              let isChName = false;
              for (const k of Object.keys(CH_SHEET_MAP)) { if (aName.includes(k)) { isChName = true; break; } }
              if (isChName) break;
              academies.push({ name: aName, value: aVal });
            }
            if (academies.length > 0) result[block.chKey].academies = academies;
          });

          // Strategy B: Column-proximity fallback for channels still missing academies
          function findNearestCh(ci) {
            let best = null, bestDist = 999;
            validGroups.forEach(cm => {
              const dist = Math.min(Math.abs(ci - cm.rankCol), Math.abs(ci - cm.valCol));
              if (dist < bestDist) { bestDist = dist; best = cm.chKey; }
            });
            return bestDist <= 3 ? best : null;
          }

          const missingAcad = validGroups.filter(cm => !result[cm.chKey]?.academies?.length);
          if (missingAcad.length > 0) {
            for (let ri = rankEndRow; ri < rows.length; ri++) {
              const row = (rows[ri] || []).map(c => String(c || '').trim());
              for (let ci = 0; ci < row.length; ci++) {
                if (row[ci] === '目標' || row[ci] === '低標') {
                  const matchKey = findNearestCh(ci);
                  if (matchKey && result[matchKey] && (!result[matchKey].academies || result[matchKey].academies.length === 0)) {
                    const tType = row[ci] === '目標' ? 'goal' : 'low';
                    const tVal = parseFloat(String(row[ci + 1] || '0').replace(/,/g, '')) || 0;
                    result[matchKey].target = tVal;
                    result[matchKey].targetType = tType;
                    let acadStart = ri + 1;
                    for (let aj = ri + 1; aj < Math.min(ri + 3, rows.length); aj++) {
                      const ar = (rows[aj] || []).map(c => String(c || '').trim());
                      if (ar[ci] === '學院') { acadStart = aj + 1; break; }
                      const testVal = parseFloat(String(rows[aj]?.[ci + 1] || '0').replace(/,/g, '')) || 0;
                      if (ar[ci] && !['目標','低標','學院'].includes(ar[ci]) && testVal > 0) { acadStart = aj; break; }
                    }
                    const academies = [];
                    for (let aj = acadStart; aj < rows.length; aj++) {
                      const ar = rows[aj] || [];
                      const aName = String(ar[ci] || '').trim();
                      const aVal = parseFloat(String(ar[ci + 1] || '0').replace(/,/g, '')) || 0;
                      if (!aName || ['目標','低標','學院'].includes(aName)) break;
                      academies.push({ name: aName, value: aVal });
                    }
                    if (academies.length > 0) result[matchKey].academies = academies;
                  }
                }
              }
            }
          }

          // Strategy C: Scan for DEFAULT_ACADEMIES names by column proximity
          validGroups.forEach(cm => {
            if (result[cm.chKey]?.academies?.length > 0) return;
            const academies = [];
            for (let ri = rankEndRow; ri < rows.length; ri++) {
              const row = rows[ri] || [];
              for (let ci = Math.max(0, cm.rankCol - 1); ci <= cm.valCol + 1 && ci < row.length; ci++) {
                const cell = String(row[ci] || '').trim();
                if (DEFAULT_ACADEMIES.includes(cell)) {
                  const val = parseFloat(String(row[ci + 1] || '0').replace(/,/g, '')) || 0;
                  if (!academies.find(a => a.name === cell)) academies.push({ name: cell, value: val });
                }
              }
            }
            if (academies.length > 0 && result[cm.chKey]) result[cm.chKey].academies = academies;
          });

          break; // done with side-by-side
        }
      }

      // === Strategy 3: Content-based sheet scanning for academy data ===
      // Numbers exports each academy table as a separate sheet with generic names.
      // Scan ALL sheets: if a sheet starts with 目標/低標 and row 2 has 學院 + channel name,
      // it's an academy sheet. Parse it and merge into result.
      wb.SheetNames.forEach(sheetName => {
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (!rows || rows.length < 3) return;
        const r0 = (rows[0] || []).map(c => String(c || '').trim());
        const r1 = (rows[1] || []).map(c => String(c || '').trim());
        // Check if first row starts with 目標/低標
        if (r0[0] !== '目標' && r0[0] !== '低標') return;
        // Check if second row has 學院 + channel name
        if (r1[0] !== '學院') return;
        // Identify channel from row 1
        let chKey = null;
        for (let ci = 0; ci < r1.length; ci++) {
          const cell = r1[ci];
          if (!cell || cell === '學院') continue;
          for (const [k, v] of Object.entries(CH_SHEET_MAP)) {
            if (cell === k || cell.includes(k)) { chKey = v; break; }
          }
          if (chKey) break;
        }
        if (!chKey) return;
        // Parse target
        const tType = r0[0] === '目標' ? 'goal' : 'low';
        const tVal = parseFloat(String(r0[1] || '0').replace(/,/g, '')) || 0;
        // Parse academy rows (from row 2 onward)
        const academies = [];
        for (let ri = 2; ri < rows.length; ri++) {
          const row = rows[ri] || [];
          const aName = String(row[0] || '').trim();
          const aVal = parseFloat(String(row[1] || '0').replace(/,/g, '')) || 0;
          if (!aName) continue;
          if (['目標','低標','學院'].includes(aName)) continue;
          academies.push({ name: aName, value: aVal });
        }
        // Merge into result
        if (!result[chKey]) {
          const chInfo = CH_CHANNELS.find(c => c.key === chKey);
          result[chKey] = { ranking: [], academies, target: tVal, targetType: tType };
        } else {
          result[chKey].academies = academies;
          result[chKey].target = tVal;
          result[chKey].targetType = tType;
        }
      });

      // === Strategy 4: fallback — assign sheets by index ===
      if (Object.keys(result).length === 0) {
        wb.SheetNames.forEach((sheetName, idx) => {
          if (idx < CH_CHANNELS.length) {
            const parsed = parseSingleChannelSheet(wb.Sheets[sheetName], CH_CHANNELS[idx].key);
            if (parsed && parsed.ranking.length > 0) result[CH_CHANNELS[idx].key] = parsed;
          }
        });
      }

      return result;
    }
function parseSingleChannelSheet(ws, chKey) {
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      const ranking = [];
      const academies = [];
      let target = 0, targetType = '';
      let inAcademy = false;

      for (let ri = 0; ri < rows.length; ri++) {
        const row = rows[ri];
        if (!row || row.length === 0) continue;
        const c0 = String(row[0] || '').trim();
        const c1 = String(row[1] || '').trim();

        if (c0 === '目標' || c0 === '低標') {
          inAcademy = true;
          targetType = c0 === '目標' ? 'goal' : 'low';
          target = parseFloat(String(row[1] || '0').replace(/,/g, '')) || 0;
          continue;
        }
        if (c0 === '學院' || c1 === '學院') continue;

        if (inAcademy) {
          const val = parseFloat(String(row[1] || '0').replace(/,/g, '')) || 0;
          if (c0 && c0 !== '名次' && c0 !== '姓名') academies.push({ name: c0, value: val });
        } else {
          if (c0 === '名次' || c0 === '姓名') continue;
          let name, value;
          if (row.length >= 3 && /^\d+$/.test(c0)) {
            name = String(row[1] || '').trim();
            value = parseFloat(String(row[2] || '0').replace(/,/g, '')) || 0;
          } else if (row.length >= 2) {
            name = c0;
            value = parseFloat(String(row[row.length - 1] || '0').replace(/,/g, '')) || 0;
          }
          if (name && value) ranking.push({ name, value });
        }
      }

      ranking.sort((a, b) => b.value - a.value);
      const chInfo = CH_CHANNELS.find(c => c.key === chKey);
      return { ranking, academies, target: target || chInfo?.target || 0, targetType: targetType || chInfo?.targetType || 'low' };
    }
function showChImportPreview(parsed) {
      const el = document.getElementById('chImportPreview');
      if (!parsed || Object.keys(parsed).length === 0) {
        el.innerHTML = '<div style="color:#ffa726;">⚠️ 未偵測到符合的通路工作表</div>';
        return;
      }
      let html = '<div style="color:#66bb6a;margin-bottom:6px;">✅ 已解析以下通路：</div>';
      for (const [key, d] of Object.entries(parsed)) {
        const ch = CH_CHANNELS.find(c => c.key === key);
        const hasAcad = d.academies && d.academies.length > 0;
        const acadNames = hasAcad ? d.academies.map(a => a.name).join('、') : '';
        const acadTotal = hasAcad ? d.academies.reduce((s, a) => s + a.value, 0) : 0;
        html += `<div style="margin-bottom:4px;padding:6px 8px;background:rgba(255,255,255,.03);border-radius:4px;">
          <div><span style="color:var(--accent);font-weight:600;">${ch?.name || key}</span>
          <span style="color:var(--dim);margin-left:8px;">排名 ${d.ranking.length} 人</span>
          <span style="color:${hasAcad ? '#66bb6a' : '#ffa726'};margin-left:8px;">學院 ${d.academies.length} 筆${hasAcad ? ' (合計 ' + fmtWan(acadTotal) + ')' : ''}</span></div>
          ${hasAcad ? '<div style="color:var(--dim);font-size:.8125rem;margin-top:2px;padding-left:4px;">' + acadNames + '</div>' : ''}
        </div>`;
      }
      // Show missing channels
      const parsedKeys = Object.keys(parsed);
      const missingCh = CH_CHANNELS.filter(c => !parsedKeys.includes(c.key));
      if (missingCh.length > 0) {
        html += '<div style="color:#ffa726;margin-top:6px;">⚠️ 未偵測到：' + missingCh.map(c => c.name).join('、') + '</div>';
      }
      el.innerHTML = html;
    }
function applyChImportToMonth(m) {
      if (!chData[m]) {
        chData[m] = {};
        CH_CHANNELS.forEach(ch => { chData[m][ch.key] = { ranking: [], academies: makeDefaultAcademies(), target: ch.target, targetType: ch.targetType }; });
      }
      for (const [key, d] of Object.entries(chParsedExcel)) {
        if (!chData[m][key]) continue;
        chData[m][key].ranking = d.ranking;
        if (d.academies && d.academies.length > 0) {
          const importMap = {};
          d.academies.forEach(a => { importMap[a.name] = a.value; });
          let updated = false;
          chData[m][key].academies.forEach(a => {
            if (importMap[a.name] !== undefined) { a.value = importMap[a.name]; updated = true; }
          });
          d.academies.forEach(a => {
            if (!chData[m][key].academies.find(x => x.name === a.name)) {
              chData[m][key].academies.push({ name: a.name, value: a.value });
              updated = true;
            }
          });
          if (!updated) chData[m][key].academies = d.academies;
        }
        if (d.target !== undefined && d.target !== null) chData[m][key].target = d.target;
        if (d.targetType) chData[m][key].targetType = d.targetType;
      }
    }
function doChExcelImport() {
      if (!chParsedExcel) { alert('請先選擇 Excel 檔案'); return; }
      if (chQuarterView) {
        const sel = document.querySelector('input[name="chImportMonth"]:checked');
        const val = sel ? sel.value : null;
        if (!val) { alert('請選擇匯入範圍'); return; }
        if (val === 'all') {
          // 整季匯入：資料寫入第一個月，其餘月份清空（避免季度加總重複）
          const ms = chQuarterView.months;
          applyChImportToMonth(ms[0]);
          for (let i = 1; i < ms.length; i++) {
            const mm = ms[i];
            if (!chData[mm]) { chData[mm] = {}; CH_CHANNELS.forEach(ch => { chData[mm][ch.key] = { ranking: [], academies: makeDefaultAcademies(), target: ch.target, targetType: ch.targetType }; }); }
            for (const key of Object.keys(chParsedExcel)) {
              if (!chData[mm][key]) continue;
              chData[mm][key].ranking = [];
              chData[mm][key].academies = makeDefaultAcademies();
            }
          }
        } else {
          applyChImportToMonth(parseInt(val));
        }
      } else {
        if (!chCurrentMonth) { alert('請選擇月份'); return; }
        applyChImportToMonth(chCurrentMonth);
      }
      saveChData();
      closeChImport();
      if (chQuarterView) {
        openChQuarter(chQuarterView.label, chQuarterView.months);
      } else {
        renderChDetail();
      }
      renderChMonths();
    }
function openHonorCards() {
      if (chQuarterView && chQViewMonth === null) {
        // Quarter mode — 整季合計
        const { label, months } = chQuarterView;
        honorCurrentData = { month: label, label, channels: [] };
        const agg = aggregateQuarter(months);
        CH_CHANNELS.forEach(ch => {
          honorCurrentData.channels.push({ chKey: ch.key, chName: ch.name, ranking: agg[ch.key].ranking, academies: agg[ch.key].academies });
        });
        document.getElementById('honorTitle').textContent = '🏆 ' + label + ' 嘉許翻牌';
      } else if (chQuarterView && chQViewMonth !== null) {
        // Quarter mode — 單月檢視
        const m = chQViewMonth;
        honorCurrentData = { month: m, label: m + '月', channels: [] };
        CH_CHANNELS.forEach(ch => {
          const d = chData[m]?.[ch.key] || {};
          const ranking = [...(d.ranking || [])].sort((a, b) => b.value - a.value);
          const academies = [...(d.academies || [])].sort((a, b) => b.value - a.value);
          honorCurrentData.channels.push({ chKey: ch.key, chName: ch.name, ranking, academies });
        });
        document.getElementById('honorTitle').textContent = '🏆 ' + m + '月 嘉許翻牌';
      } else {
        // Monthly mode
        const m = chCurrentMonth;
        if (!m) return;
        honorCurrentData = { month: m, label: m + '月', channels: [] };
        CH_CHANNELS.forEach(ch => {
          const d = chData[m]?.[ch.key] || {};
          const ranking = [...(d.ranking || [])].sort((a, b) => b.value - a.value);
          const academies = [...(d.academies || [])].sort((a, b) => b.value - a.value);
          honorCurrentData.channels.push({ chKey: ch.key, chName: ch.name, ranking, academies });
        });
        document.getElementById('honorTitle').textContent = '🏆 ' + m + '月 嘉許翻牌';
      }

      renderHonorCards();
      // Reset card flips, then open overlay
      document.querySelectorAll('#honorOverlay .honor-card').forEach(c => c.classList.remove('flipped'));
      document.getElementById('honorOverlay').classList.add('open');
      // Apply stagger entrance delays to cards
      const allCards = document.querySelectorAll('#honorOverlay .honor-card');
      allCards.forEach((c, i) => { c.style.animationDelay = (i * 100) + 'ms'; });
      // Auto-flip after cards finish entrance animation
      const entranceDone = allCards.length * 100 + 500;
      setTimeout(() => flipAllHonorCards(), entranceDone);
    }
const CH_KING_TITLES = {
      net: '網路王', purchase: '加購王', event: '展場王', referral: '介紹王', admin: '班務王', cash: '現金王'
    };
const CH_ACAD_TITLES = {
      net: '學院網路王', purchase: '學院加購王', event: '學院展場王', referral: '學院介紹王', admin: '學院班務王'
    };
function renderHonorCards() {
      if (!honorCurrentData) return;
      const assign = loadHonorAssign();
      const allCastle = getCastleCards();

      // Individual cards — split into two rows (3+3)
      const indEl = document.getElementById('honorIndividualCards');
      const ROW1_KEYS = ['net', 'purchase', 'event'];
      let indHtml = '';
      function buildIndCard(ch) {
        const top5 = ch.ranking.slice(0, 5);
        if (top5.length === 0) return '';
        const king = top5[0];
        const assignedId = assign.individual[ch.chKey];
        const castle = assignedId
          ? allCastle.find(c => String(c.id) === String(assignedId) && c.photo)
          : findCastleCard(king.name);
        const title = CH_KING_TITLES[ch.chKey] || ch.chName + '王';
        return `<div class="honor-card" onclick="this.classList.toggle('flipped')" data-ch="${ch.chKey}" data-type="individual">
          <div class="honor-card-inner">
            <div class="honor-card-back">
              <div class="hcb-icon">🏆</div>
              <div class="hcb-label">${title}</div>
            </div>
            <div class="honor-card-front" style="background:linear-gradient(180deg, var(--bg2), var(--bg3));">
              <div class="hcf-header">
                <div class="hcf-channel">${ch.chName}</div>
                <div class="hcf-title">👑 ${title}</div>
              </div>
              <div class="hcf-photo-area">
                ${castle ? `<img src="${castle.photo}" alt="${king.name}">` : `<div class="hcf-no-photo">👤</div>`}
              </div>
              <div class="hcf-crown-name">👑 ${king.name}</div>
              <div class="hcf-crown-val">${fmtWan(king.value)}</div>
              <div class="hcf-runners">
                ${top5.slice(1).map((r, i) => `<div class="hcf-runner-row"><span class="rank">${i + 2}</span><span>${r.name}</span><span class="val">${fmtWan(r.value)}</span></div>`).join('')}
              </div>
            </div>
          </div>
        </div>`;
      }
      // Row 1: 網路王、加購王、展場王
      indHtml += '<div class="honor-cards-row">';
      honorCurrentData.channels.filter(ch => ROW1_KEYS.includes(ch.chKey)).forEach(ch => { indHtml += buildIndCard(ch); });
      indHtml += '</div>';
      // Row 2: 介紹王、班務王、現金王
      indHtml += '<div class="honor-cards-row" style="margin-top:12px;">';
      honorCurrentData.channels.filter(ch => !ROW1_KEYS.includes(ch.chKey)).forEach(ch => { indHtml += buildIndCard(ch); });
      indHtml += '</div>';
      indEl.innerHTML = indHtml;

      // Academy cards — use admin-assigned photo
      const acadEl = document.getElementById('honorAcademyCards');
      let acadHtml = '';
      honorCurrentData.channels.forEach(ch => {
        if (ch.chKey === 'cash') return; // 現金王不顯示學院卡牌
        const sorted = [...ch.academies].sort((a, b) => b.value - a.value);
        if (sorted.length === 0) return;
        const topAcad = sorted[0];
        const title = CH_ACAD_TITLES[ch.chKey] || '學院' + ch.chName + '王';
        const acadAssignId = assign.academy[ch.chKey];
        let acadCard = acadAssignId ? allCastle.find(c => String(c.id) === String(acadAssignId) && c.photo) : null;
        // 自動配對：用第一名學院名稱匹配城堡卡牌（學院卡牌）
        if (!acadCard && topAcad) {
          acadCard = matchAcademyCard(topAcad.name, allCastle);
          if (acadCard) { assign.academy[ch.chKey] = String(acadCard.id); saveHonorAssign(assign); }
        }

        acadHtml += `<div class="honor-card" onclick="this.classList.toggle('flipped')" data-ch="${ch.chKey}" data-type="academy">
          <div class="honor-card-inner">
            <div class="honor-card-back">
              <div class="hcb-icon">🏫</div>
              <div class="hcb-label">${title}</div>
            </div>
            <div class="honor-card-front" style="background:linear-gradient(180deg, var(--bg2), var(--bg3));">
              <div class="hcf-header">
                <div class="hcf-channel">${ch.chName} 學院</div>
                <div class="hcf-title">👑 ${title}</div>
              </div>
              <div class="hcf-photo-area" style="height:70px;">
                ${acadCard ? `<img src="${acadCard.photo}" alt="${acadCard.name}">` : `<div class="hcf-no-photo" style="width:55px;height:55px;font-size:1.4rem;">🏫</div>`}
              </div>
              <div class="hcf-crown-name" style="font-size:.85rem;">👑 ${topAcad.name}</div>
              <div class="hcf-crown-val">${fmtComma(topAcad.value)}</div>
              ${acadCard ? `<div style="text-align:center;font-size:.8125rem;color:var(--dim);">代表：${acadCard.name}</div>` : `<div style="text-align:center;font-size:.8125rem;color:rgba(255,200,100,.6);">⚙️ 請至人物管理指定代表</div>`}
              <div class="hcf-runners" style="font-size:.8125rem;">
                ${sorted.slice(1, 5).map((a, i) => `<div class="hcf-runner-row"><span class="rank">${i + 2}</span><span>${a.name}</span><span class="val">${fmtComma(a.value)}</span></div>`).join('')}
              </div>
            </div>
          </div>
        </div>`;
      });
      acadEl.innerHTML = acadHtml;
    }
function setAcadRep(chKey, cardId) {
      const photoEl = document.getElementById('acadPhoto_' + chKey);
      if (!photoEl) return;
      if (!cardId) {
        photoEl.innerHTML = '<div class="hcf-no-photo" style="width:50px;height:50px;font-size:1.2rem;">🏫</div>';
        return;
      }
      const cards = getCastleCards();
      const card = cards[parseInt(cardId)];
      if (card && card.photo) {
        photoEl.innerHTML = `<img src="${card.photo}" alt="${card.name}" style="width:50px;height:50px;">`;
      }
    }
function flipAllHonorCards() {
      const cards = document.querySelectorAll('#honorOverlay .honor-card');
      cards.forEach((card, i) => {
        setTimeout(() => {
          card.classList.add('flipped');
        }, i * 400);
      });
    }
function replayHonorFlip() {
      const cards = document.querySelectorAll('#honorOverlay .honor-card');
      cards.forEach(c => c.classList.remove('flipped'));
      setTimeout(() => flipAllHonorCards(), 300);
    }
function closeHonor() {
      const el = document.getElementById('honorOverlay');
      el.classList.remove('open');
      // Reset flipped state after transition
      setTimeout(() => {
        document.querySelectorAll('#honorOverlay .honor-card').forEach(c => c.classList.remove('flipped'));
      }, 500);
    }
function openHonorAdmin() {
      renderHonorAdmin();
      document.getElementById('honorAdminOverlay').classList.add('open');
    }
function closeHonorAdmin() {
      document.getElementById('honorAdminOverlay').classList.remove('open');
      // Re-render honor cards with updated assignments
      renderHonorCards();
    }
function renderHonorAdmin() {
      const assign = loadHonorAssign();
      // Show all castle cards that have a real name AND photo (not default "角色 X")
      const allCastle = ensureCastleCards();
      const castleCards = allCastle.filter(c => c.name && c.photo && !c.name.match(/^角色\s*\d+$/));
      const body = document.getElementById('honorAdminBody');
      if (!honorCurrentData) { body.innerHTML = '<p style="color:var(--dim);">請先開啟嘉許翻牌</p>'; return; }

      let html = '';
      if (castleCards.length === 0) {
        html += '<div style="padding:12px;background:rgba(255,100,100,.08);border:1px solid rgba(255,100,100,.2);border-radius:10px;margin-bottom:16px;color:rgba(255,200,150,.9);font-size:.85rem;">⚠️ 城堡卡牌中尚無已設定照片的人物，請先在下方新增人物，或到 🏰 指揮城堡 設定卡牌。</div>';
      } else {
        html += `<div style="padding:6px 12px;margin-bottom:12px;font-size:.8125rem;color:var(--dim);">可選人物：${castleCards.map(c => c.name).join('、')}（共 ${castleCards.length} 人）</div>`;
      }

      // Section 1: Individual channel kings
      html += '<div class="ha-section"><div class="ha-section-title">👤 個人通路王 — 指定人物照片</div>';
      honorCurrentData.channels.forEach(ch => {
        const top5 = ch.ranking.slice(0, 5);
        const king = top5.length > 0 ? top5[0] : null;
        const kingName = king ? king.name : '（無資料）';
        const title = CH_KING_TITLES[ch.chKey] || ch.chName + '王';
        const assignedId = assign.individual[ch.chKey] || '';
        const assignedCard = assignedId ? castleCards.find(c => String(c.id) === String(assignedId)) : null;
        const autoCard = king ? findCastleCard(king.name) : null;
        const currentCard = assignedCard || autoCard;
        const photoHtml = currentCard && currentCard.photo
          ? `<img src="${currentCard.photo}" class="ha-photo-preview">`
          : `<div class="ha-photo-placeholder">👤</div>`;

        html += `<div class="ha-row">
          ${photoHtml}
          <div class="ha-row-label">${title}</div>
          <div class="ha-row-current">👑 <span class="ha-name">${kingName}</span>${king ? ' ' + fmtWan(king.value) : ''}</div>
          <select class="ha-select" onchange="haSetIndividual('${ch.chKey}', this.value)">
            <option value="">自動配對</option>
            ${castleCards.map(c => `<option value="${c.id}" ${String(c.id) === String(assignedId) ? 'selected' : ''}>${c.name}</option>`).join('')}
          </select>
        </div>`;
      });
      html += '</div>';

      // Section 2: Academy channel kings
      html += '<div class="ha-section"><div class="ha-section-title">🏫 學院通路王 — 指定代表人物</div>';
      honorCurrentData.channels.forEach(ch => {
        if (ch.chKey === 'cash') return; // 現金王不顯示學院卡牌
        const sorted = [...ch.academies].sort((a, b) => b.value - a.value);
        const topAcad = sorted.length > 0 ? sorted[0] : null;
        const acadName = topAcad ? topAcad.name : '（無資料）';
        const title = CH_ACAD_TITLES[ch.chKey] || '學院' + ch.chName + '王';
        let assignedId = assign.academy[ch.chKey] || '';
        let assignedCard = assignedId ? castleCards.find(c => String(c.id) === String(assignedId)) : null;
        // 自動配對學院卡牌
        if (!assignedCard && topAcad) {
          assignedCard = matchAcademyCard(topAcad.name, allCastle);
          if (assignedCard) { assignedId = String(assignedCard.id); assign.academy[ch.chKey] = assignedId; saveHonorAssign(assign); }
        }
        const photoHtml = assignedCard && assignedCard.photo
          ? `<img src="${assignedCard.photo}" class="ha-photo-preview">`
          : `<div class="ha-photo-placeholder">🏫</div>`;

        html += `<div class="ha-row">
          ${photoHtml}
          <div class="ha-row-label">${title}</div>
          <div class="ha-row-current">👑 <span class="ha-name">${acadName}</span>${topAcad ? ' ' + fmtComma(topAcad.value) : ''}</div>
          <select class="ha-select" onchange="haSetAcademy('${ch.chKey}', this.value)">
            <option value="">— 選擇代表 —</option>
            ${castleCards.map(c => `<option value="${c.id}" ${String(c.id) === String(assignedId) ? 'selected' : ''}>${c.name}</option>`).join('')}
          </select>
        </div>`;
      });
      html += '</div>';

      body.innerHTML = html;
    }
function haSetIndividual(chKey, cardId) {
      const assign = loadHonorAssign();
      if (cardId) { assign.individual[chKey] = cardId; }
      else { delete assign.individual[chKey]; }
      saveHonorAssign(assign);
      renderHonorAdmin();
    }
function haSetAcademy(chKey, cardId) {
      const assign = loadHonorAssign();
      if (cardId) { assign.academy[chKey] = cardId; }
      else { delete assign.academy[chKey]; }
      saveHonorAssign(assign);
      renderHonorAdmin();
    }
function haPhotoPreview(input) {
      const preview = document.getElementById('haNewPhotoPreview');
      if (!input.files || !input.files[0]) { preview.innerHTML = ''; return; }
      const reader = new FileReader();
      reader.onload = function(e) {
        preview.innerHTML = `<img src="${e.target.result}" style="width:60px;height:60px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,215,0,.3);">`;
      };
      reader.readAsDataURL(input.files[0]);
    }
function haAddPerson() {
      const nameInput = document.getElementById('haNewName');
      const photoInput = document.getElementById('haNewPhoto');
      const name = nameInput.value.trim();
      if (!name) { alert('請輸入姓名'); return; }

      function doSave(photoData) {
        const cards = ensureCastleCards();
        // Find an empty slot (default name "角色 X" with no photo)
        let slotIdx = cards.findIndex(c => (!c.photo || !c.photo.trim()) && (!c.name || c.name.match(/^角色\s*\d+$/)));
        if (slotIdx === -1) {
          // All named — find one without photo
          slotIdx = cards.findIndex(c => !c.photo || !c.photo.trim());
        }
        if (slotIdx === -1) {
          alert('城堡卡牌已滿（32張皆有資料），請先在指揮城堡清出空位');
          return;
        }
        cards[slotIdx].name = name;
        if (photoData) cards[slotIdx].photo = photoData;
        cards[slotIdx].active = true;
        try {
          localStorage.setItem('castle_cards_v1', JSON.stringify(cards));
        } catch(e) {
          alert('❌ 儲存失敗：' + (e.message || '可能照片太大，請選擇較小的圖片'));
          return;
        }
        nameInput.value = '';
        photoInput.value = '';
        document.getElementById('haNewPhotoPreview').innerHTML = '';
        alert('✅ 已新增「' + name + '」到城堡卡牌（位置 ' + (slotIdx + 1) + '）！');
        renderHonorAdmin();
      }

      if (photoInput.files && photoInput.files[0]) {
        // Compress image before saving to avoid localStorage quota
        const file = photoInput.files[0];
        const reader = new FileReader();
        reader.onload = function(e) {
          const img = new Image();
          img.onload = function() {
            const canvas = document.createElement('canvas');
            const maxSize = 200;
            let w = img.width, h = img.height;
            if (w > h) { if (w > maxSize) { h = h * maxSize / w; w = maxSize; } }
            else { if (h > maxSize) { w = w * maxSize / h; h = maxSize; } }
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            const compressed = canvas.toDataURL('image/jpeg', 0.7);
            doSave(compressed);
          };
          img.onerror = function() { doSave(e.target.result); };
          img.src = e.target.result;
        };
        reader.onerror = function() { alert('❌ 照片讀取失敗'); };
        reader.readAsDataURL(file);
      } else {
        doSave('');
      }
    }
function saveHonorRecord() {
      if (!honorCurrentData) return;
      const history = loadHonorHistory();
      const record = {
        date: new Date().toISOString(),
        label: honorCurrentData.label,
        month: honorCurrentData.month,
        individuals: {},
        academies: {}
      };
      honorCurrentData.channels.forEach(ch => {
        const top5 = ch.ranking.slice(0, 5);
        if (top5.length > 0) {
          record.individuals[ch.chKey] = {
            chName: ch.chName,
            title: CH_KING_TITLES[ch.chKey],
            top5: top5.map(r => ({ name: r.name, value: r.value }))
          };
        }
        if (ch.chKey === 'cash') return; // 現金王不記錄學院資料
        const sortedAcad = [...ch.academies].sort((a, b) => b.value - a.value);
        if (sortedAcad.length > 0) {
          const selEl = document.getElementById('acadRep_' + ch.chKey);
          const repId = selEl ? selEl.value : '';
          const repCard = repId ? getCastleCards()[parseInt(repId)] : null;
          record.academies[ch.chKey] = {
            chName: ch.chName,
            title: CH_ACAD_TITLES[ch.chKey],
            topAcademy: sortedAcad[0].name,
            topValue: sortedAcad[0].value,
            representative: repCard ? repCard.name : '',
            top5: sortedAcad.slice(0, 5).map(a => ({ name: a.name, value: a.value }))
          };
        }
      });
      history.push(record);
      saveHonorHistory(history);
      alert('✅ 嘉許記錄已儲存！（共 ' + history.length + ' 筆歷史記錄）');
    }
function motivImportFile(evt){
      var file = evt.target.files[0];
      if (!file) return;
      var ext = file.name.split('.').pop().toLowerCase();

      if (ext === 'csv') {
        var reader = new FileReader();
        reader.onload = function(e){
          motivParseCSV(e.target.result);
        };
        reader.readAsText(file);
      } else {
        // xlsx / numbers → use SheetJS
        motivLoadSheetJS(function(){
          var reader = new FileReader();
          reader.onload = function(e){
            try {
              var wb = XLSX.read(new Uint8Array(e.target.result), {type:'array'});
              motivParseWorkbook(wb);
            } catch(err){
              alert('❌ 無法解析檔案: ' + err.message);
            }
          };
          reader.readAsArrayBuffer(file);
        });
      }
      evt.target.value = '';
    }
function motivParseWorkbook(wb){
      if (wb.SheetNames.length < 2) {
        alert('⚠️ 需要至少 2 個工作表（工作表1=學院排名, 工作表2=業務排名）');
        return;
      }

      // Sheet 1: 學院排名 — Col B=學院, Col M=業績
      var ws1 = wb.Sheets[wb.SheetNames[0]];
      var rows1 = XLSX.utils.sheet_to_json(ws1, {header:1, defval:''});
      var newAcademy = [];
      // Find header row
      var hdr1 = rows1[0] || [];
      var colName1 = 1; // B
      var colVal1 = 12; // M
      // Try to auto-detect columns
      for (var c = 0; c < hdr1.length; c++){
        if (String(hdr1[c]).indexOf('學院') >= 0 && colName1 === 1) colName1 = c;
        if (String(hdr1[c]) === '業績' && colVal1 === 12) colVal1 = c;
      }
      for (var r = 1; r < rows1.length; r++){
        var nm = rows1[r][colName1];
        var vl = rows1[r][colVal1];
        if (nm && nm !== '') {
          var numVal = typeof vl === 'number' ? vl : parseFloat(String(vl).replace(/,/g,'')) || 0;
          newAcademy.push({name: String(nm), value: numVal});
        }
      }
      newAcademy.sort(function(a,b){ return b.value - a.value; });

      // Sheet 2: 業務排名 — Col C=姓名, Col N=合計業績
      var ws2 = wb.Sheets[wb.SheetNames[1]];
      var rows2 = XLSX.utils.sheet_to_json(ws2, {header:1, defval:''});
      var newSales = [];
      var hdr2 = rows2[0] || [];
      var colName2 = 2; // C
      var colVal2 = 13; // N
      for (var c = 0; c < hdr2.length; c++){
        if (String(hdr2[c]).indexOf('姓名') >= 0 && colName2 === 2) colName2 = c;
        if (String(hdr2[c]).indexOf('合計業績') >= 0 && colVal2 === 13) colVal2 = c;
      }
      for (var r = 1; r < rows2.length; r++){
        var nm = rows2[r][colName2];
        var vl = rows2[r][colVal2];
        if (nm && nm !== '') {
          var numVal = typeof vl === 'number' ? vl : parseFloat(String(vl).replace(/,/g,'')) || 0;
          newSales.push({name: String(nm), value: numVal});
        }
      }
      newSales.sort(function(a,b){ return b.value - a.value; });

      if (newAcademy.length === 0 && newSales.length === 0){
        alert('⚠️ 未找到有效資料，請確認檔案格式');
        return;
      }

      _motivAcademy = newAcademy;
      _motivSales = newSales;
      motivSaveData();
      // Save update time
      try {
        var cid = '';
        try { var aid = localStorage.getItem('activeCharacterId'); if(aid) cid = 'char_' + aid + '_'; } catch(e){}
        var now = new Date();
        localStorage.setItem(cid + 'motiv_updated_at', now.getFullYear() + '/' + (now.getMonth()+1) + '/' + now.getDate() + ' ' + now.getHours() + ':' + String(now.getMinutes()).padStart(2,'0'));
      } catch(e){}
      motivRenderAll();
      alert('✅ 匯入成功！學院 ' + newAcademy.length + ' 筆，業務 ' + newSales.length + ' 筆');
    }
function motivParseCSV(text){
      alert('⚠️ CSV 格式暫不支援，請使用 .xlsx 或 .numbers 檔案');
    }
function _evoIncPngHtml(M){
      var X = _evoIncomeRows(M), reg = _evoIncReg(), regOrgs = reg === 'all' ? CK_ORG_LIST : ((CK_REGIONS[reg] || {}).orgs || CK_ORG_LIST);
      var mode = (_evoIncMode() === 'proj' && X.PC.f > 1.01) ? 'proj' : 'now', val = function(x){ return mode === 'proj' ? x.incP : x.inc; };
      var all = X.rows.filter(function(x){ return regOrgs.indexOf(x.org) >= 0; }).sort(function(a,b){ return val(b) - val(a); });
      var list = all.filter(function(x){ return x.inAvg; }), rest = all.filter(function(x){ return !x.inAvg; });
      var A = _evoAvg(all), ALL = _evoAvg(X.rows), avR = mode === 'proj' ? A.avgP : A.avg, avG = mode === 'proj' ? ALL.avgP : ALL.avg;
      var me = _fnMe(), showNames = _evoIncNames(), cnt = {}, ym = M.ym || EVO.ym, pm = +_evoPrevYm(ym).slice(5), M0 = +ym.slice(5);
      var regName = reg === 'all' ? '全省七家' : (CK_REGIONS[reg] || {}).label;
      var mx = Math.max.apply(null, list.map(val).concat([avR, 1])) * 1.04;
      var nm = function(x){ if (x.n === me) return _fnEsc(x.n) + '（你）'; if (showNames) return _fnEsc(x.n); cnt[x.org] = (cnt[x.org] || 0) + 1; return '業務 ' + cnt[x.org]; };
      var F = "font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','PingFang TC','Noto Sans TC',system-ui,sans-serif;";
      var RED = '#D93A3A', GRN = '#7DB24A', INK = '#1D1D1F', SUB = '#6E6E73', LINE = 'rgba(0,0,0,.06)';
      // 此刻＝紅、月底推估＝琥珀：頂部色帶、標題、大數字、面板外框都換色，一眼分得出來
      var MC = mode === 'proj' ? { c:'#B86E00', bg:'#FFF3E0', band:'linear-gradient(135deg,#C77700,#E8A33D)', tag:'📈 月底推估', title:'月底推估人均收入', when:'照目前速度推到 ' + M0 + '/' + X.PC.dim } : { c:RED, bg:'#FDECEC', band:'linear-gradient(135deg,#C62F2F,#E5534B)', tag:'📍 此刻', title:'此刻人均收入', when:'到 ' + M0 + '/' + X.PC.day + ' 為止' };
      var h = '<div style="' + F + 'width:760px;padding:0 0 30px;background:linear-gradient(180deg,#FBFBFD 0%,#F5F5F7 100%);color:' + INK + ';box-sizing:border-box;">';
      h += '<div style="background:' + MC.band + ';color:#fff;padding:18px 40px;display:flex;align-items:center;gap:14px"><span style="font-size:22px;font-weight:800;letter-spacing:.01em">' + MC.tag + '</span><span style="font-size:18px;font-weight:600;opacity:.95">' + M0 + ' 月・' + _fnEsc(regName) + '・' + MC.when + '</span></div>';
      h += '<div style="padding:28px 40px 0">';
      h += '<div style="font-size:46px;font-weight:800;letter-spacing:-.02em;line-height:1.1;color:' + MC.c + '">' + MC.title + '</div>';
      h += '<div style="display:flex;align-items:baseline;gap:16px;margin:14px 0 4px"><div style="font-size:76px;font-weight:800;letter-spacing:-.03em;line-height:1;color:' + MC.c + ';font-variant-numeric:tabular-nums">$' + _evoM(avR) + '</div>'
        + '<div style="font-size:18px;color:' + SUB + ';line-height:1.45">' + (mode === 'proj' ? '此刻是 $' + _evoM(A.avg) + '<br>照目前速度會多 $' + _evoM(A.avgP - A.avg) : A.n + ' 人算進平均') + (reg !== 'all' ? '<br>全省七家 $' + _evoM(avG) : '') + '</div></div>';
      h += '<div style="font-size:16px;color:' + SUB + ';margin:8px 0 22px;line-height:1.5">收入＝獎金合計＋底薪 35,000（不含加班費）・只算 ' + pm + ' 月業績 15 萬以上的 ' + A.n + ' 人' + (mode === 'proj' ? '・加碼先假設學院會達 300 萬' : '') + '</div>';
      h += '<div style="background:rgba(255,255,255,.9);border-radius:22px;padding:14px 18px;border-top:5px solid ' + MC.c + ';box-shadow:0 1px 2px rgba(0,0,0,.04),0 8px 30px rgba(0,0,0,.06)">';
      list.forEach(function(x, i){
        var top = i < 5, w = val(x) / mx * 100, la = avR / mx * 100, up = val(x) >= avR, mine = x.n === me;
        var fs = top ? 25 : 19, as = top ? 25 : 19, bh = top ? 13 : 9, pad = top ? 12 : 6;
        h += '<div style="display:flex;align-items:center;gap:12px;padding:' + pad + 'px 6px;border-bottom:1px solid ' + LINE + ';' + (mine ? 'background:#FFF4E6;border-radius:10px;' : '') + '">'
          + '<div style="width:28px;text-align:right;font-size:' + (top ? 19 : 14) + 'px;font-weight:800;color:' + (top ? (i === 0 ? RED : INK) : '#AEAEB2') + ';font-variant-numeric:tabular-nums">' + (i + 1) + '</div>'
          + '<div style="width:' + (top ? 176 : 156) + 'px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><span style="font-size:' + fs + 'px;font-weight:' + (top ? 800 : 600) + ';letter-spacing:' + (top ? '-.01em' : '0') + '">' + nm(x) + '</span><span style="font-size:' + (top ? 15 : 13) + 'px;color:' + SUB + ';margin-left:6px">' + _fnEsc(_gcShort(x.org)) + '</span></div>'
          + '<div style="width:' + (top ? 136 : 116) + 'px;text-align:right;font-size:' + as + 'px;font-weight:800;letter-spacing:-.01em;font-variant-numeric:tabular-nums;color:' + (up ? RED : INK) + '">$' + _evoM(val(x)) + '</div>'
          + '<div style="flex:1;position:relative;height:' + bh + 'px;background:#EDEDF0;border-radius:99px"><div style="position:absolute;left:0;top:0;bottom:0;width:' + w + '%;border-radius:99px;background:' + (up ? RED : GRN) + '"></div>'
          + '<div style="position:absolute;top:-4px;bottom:-4px;left:' + la + '%;width:2px;background:' + INK + ';opacity:.55;border-radius:1px"></div></div></div>';
      });
      h += '</div>';
      h += '<div style="display:flex;gap:18px;flex-wrap:wrap;margin:14px 4px 0;font-size:15px;color:' + SUB + '"><span><b style="display:inline-block;width:10px;height:10px;border-radius:3px;background:' + RED + ';vertical-align:-1px"></b> 平均以上</span><span><b style="display:inline-block;width:10px;height:10px;border-radius:3px;background:' + GRN + ';vertical-align:-1px"></b> 平均以下</span><span><b style="display:inline-block;width:2px;height:12px;background:' + INK + ';opacity:.55;vertical-align:-2px"></b> ' + _fnEsc(regName) + (mode === 'proj' ? '推估' : '') + '人均</span></div>';
      if (rest.length) h += '<div style="margin:10px 4px 0;font-size:14px;color:#8E8E93;line-height:1.5">' + pm + ' 月業績未滿 15 萬、不列入平均：' + rest.length + ' 位</div>';
      h += '<div style="margin-top:18px;text-align:right;font-size:13px;color:#AEAEB2">業績數據中心・' + new Date().toLocaleString('zh-TW', { hour12:false }) + '</div></div></div>';
      return { html:h, regName:regName, mode:mode === 'proj' ? '月底推估' : '此刻' };
    }
function evoIncPng(){
      var M = window._EVOM; if (!M) return;
      var go = function(){
        var P = _evoIncPngHtml(M);
        var wrap = document.createElement('div'); wrap.style.cssText = 'position:fixed;left:-12000px;top:0;width:760px;'; wrap.innerHTML = P.html; document.body.appendChild(wrap);
        var box = wrap.firstChild;
        _syncToast('⏳ 產生高清 PNG 中…', '#e6a817');
        setTimeout(function(){
          window.html2canvas(box, { scale:3, backgroundColor:'#F5F5F7', useCORS:true, logging:false, windowWidth:760 }).then(function(cv){
            wrap.remove();
            var d = new Date(), name = '人均收入_' + P.regName + '_' + P.mode + '_' + (d.getMonth() + 1) + '-' + d.getDate() + '.png';
            var a = document.createElement('a'); a.download = name; a.href = cv.toDataURL('image/png'); document.body.appendChild(a); a.click(); a.remove();
            _syncToast('🖼 已下載 ' + name, '#4ade80');
          }).catch(function(e){ wrap.remove(); _syncToast('產生圖片失敗：' + (e && e.message || e), '#ff6b6b'); });
        }, 60);
      };
      if (window.html2canvas) return go();
      var sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      sc.onload = go; sc.onerror = function(){ _syncToast('載入截圖工具失敗，請確認有連網路', '#ff6b6b'); }; document.head.appendChild(sc);
    }
function _rvRegion(org){ for (var k in CK_REGIONS){ if (k !== 'all' && CK_REGIONS[k].orgs.indexOf(org) >= 0) return k; } return ''; }
function _rvPick(arr, seed){ return arr[Math.abs(seed) % arr.length]; }
function _rvSeed(org){ var d = new Date(), doy = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000); return doy + CK_ORG_LIST.indexOf(org) * 7; }
function _rvSplitO(o){ return String(o || '').split(/[,，、\/]/).map(function(s){ return s.trim(); }).filter(Boolean); }
function _rvIsFair(sub){ return /展|博|節|PF|設計展|攝影展|加盟展/.test(String(sub || '')) && !/學員/.test(String(sub || '')); }
function _rvGather(ym, gi){
      var S = _dsSnaps(ym), keys = Object.keys(S).sort(); if (!keys.length) return null;
      var last = keys[keys.length - 1], M = _dsModel(ym, last), G = M.G;
      var d0 = gi < 0 ? 1 : G[gi][0], d1 = gi < 0 ? _dsDays(ym) : G[gi][1], lastDay = +last.slice(8);
      var endDay = Math.min(d1, lastDay), endKey = _dsDate(ym, endDay);
      var pfxD = ym.replace('-', '/'), inRange = function(dstr){ var m = /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/.exec(String(dstr || '')); if (!m) return false; var k = m[1] + '-' + _ckPad2(+m[2]) + '-' + _ckPad2(+m[3]); return k.slice(0,7) === ym && +m[3] >= d0 && +m[3] <= endDay; };
      var raw = _fnRawFor(ym) || {}, fd = _fnDataFor(ym) || {}, ckRs = ((fd.checkin || {}).rs || {}).byAcademy || {};
      var edStore = null; try { edStore = edGetStore(); } catch(e){}
      var F = {}, Mend = _dsModel(ym, endKey);
      CK_ORG_LIST.forEach(function(org){
        var r = Mend.rows.filter(function(x){ return x.org === org; })[0]; if (!r) return;
        var s = _gcStats(Mend, r), pts = s.pts.filter(function(p){ return p.d >= d0 && p.d <= endDay; });
        var wd = 0, wdInc = 0; pts.forEach(function(p){ wd += p.wd; if (p.wd && p.inc > 1000) wdInc += 1; });
        // 這一關前 3 個上班日的速度
        var g0 = 0, e0 = 0, n0 = 0; for (var i = 0; i < pts.length && n0 < 3; i++){ if (!pts[i].wd) continue; g0 += pts[i].inc; e0 += pts[i].exp; n0 += pts[i].wd; }
        var momEarly = e0 ? g0 / e0 : null;
        // 每個人
        var P = (S[endKey] && S[endKey].p) || {}, people = [], zero = 0, top = null, biz = 0;
        Object.keys(P).forEach(function(k){ if (k.indexOf(org + '|') !== 0) return; var n = k.slice(org.length + 1), v = +P[k][0] || 0; if (typeof EVO !== 'undefined' && EVO.notRep[n]) return; people.push({ n:n, v:v }); biz += v; if (v < 1000) zero++; if (!top || v > top.v) top = { n:n, v:v }; });
        var topShare = biz && top ? top.v / biz : 0;
        // 小組：組員贏過組長
        var mbl = [];
        try { ((_motivGroupPerf || []).concat(_motivReservePerf || [])).forEach(function(g){ if (g.academy !== org || !g.leader) return; var lv = +g.leader.value || 0; (g.members || []).forEach(function(m){ if ((+m.value || 0) > lv && lv >= 0) mbl.push({ g:g.groupName, l:g.leader.name, m:m.name, lv:lv, mv:+m.value }); }); }); } catch(e){}
        // 入帳明細
        var pay = (((raw.orgs || {})[org] || {}).pay || []).filter(function(p){ return inRange(p.d) && (+p.v || 0) > 0; });
        var tot = 0, buy = 0, fair = 0, fb = 0, blog = 0, intro = 0, coopN = 0, byStu = {}, byStuDay = {}, oldest = '', byNKD = {};
        pay.forEach(function(p){ var v = +p.v || 0; tot += v; var sub = String(p.sub || '');
          if (/學員加購/.test(sub)) buy += v; else if (_rvIsFair(sub)) { fair += v; var y = /(\d{4})/.exec(sub); if (y && (!oldest || y[1] < oldest)) oldest = y[1]; } else if (/FB|IG/i.test(sub)) fb += v; else if (/部落格/.test(sub)) blog += v; else if (/介紹/.test(sub)) intro += v;
          var nkd = p.n + '|' + (p.k || '') + '|' + p.d; byNKD[nkd] = byNKD[nkd] || {}; _rvSplitO(p.o).forEach(function(o){ byNKD[nkd][o] = 1; });
          byStu[p.n] = (byStu[p.n] || 0) + v;
          var sd = p.n + '|' + p.d; byStuDay[sd] = byStuDay[sd] || {}; if (p.k) byStuDay[sd][p.k] = 1; });
        coopN = Object.keys(byNKD).filter(function(k){ return Object.keys(byNKD[k]).length >= 2; }).length;
        var formal = Object.keys(byStu).filter(function(n){ return byStu[n] >= 10000; }), deposit = Object.keys(byStu).length - formal.length;
        var thisY = +ym.slice(0,4); if (oldest && +oldest > thisY - 2) oldest = '';
        var avgFormal = formal.length ? formal.reduce(function(a, n){ return a + byStu[n]; }, 0) / formal.length : 0;
        var three = Object.keys(byStuDay).filter(function(k){ return Object.keys(byStuDay[k]).length >= 3; }).length;
        var single = Object.keys(byStuDay).filter(function(k){ return Object.keys(byStuDay[k]).length === 1; }).length;
        // 漏斗
        var itv = (((raw.orgs || {})[org] || {}).itv || []).filter(function(x){ return inRange(x.d); });
        var itvN = itv.length, regN = itv.filter(function(x){ return x.r > 0; }).length, appNoReg = itv.filter(function(x){ return x.a > 0 && !(x.r > 0); }).length;
        // 編輯追蹤
        var ed = null; try { var B = _edBuild(edStore, [org]), o = B && B.orgs && B.orgs[0]; if (o){ var mon = 0, emp = 0; Object.keys(o.owners || {}).forEach(function(k){ mon += o.owners[k].mon || 0; emp += o.owners[k].monEmpty || 0; }); var L = o.lamps || {}; var tl = (L.l0||0)+(L.l1||0)+(L.l2||0)+(L.l3||0)+(L.l4||0); ed = { mon:mon, empty:emp, stale:(L.l3||0)+(L.l4||0), total:tl }; } } catch(e){}
        var due = 0; try { due = (getTracking(org) || []).filter(function(c){ return c['逾期未回'] || c['今天到期']; }).length; } catch(e){}
        var ck = (r.c && r.c.ck) || 0, rs = _ckNum(ckRs[org]);
        F[org] = { org:org, T:r.T, cum:r.cum, pct:r.T ? r.cum / r.T : 0, exp:r.exp, gateT:r.gateT, lamp:r.lamp, cross:r.gateT ? r.cum >= r.gateT : false, refund:r.refundRate || 0,
          mom:s.mom, momEarly:momEarly, got0:g0, exp0:e0, got3:s.got3, exp3:s.exp3, flat:s.flat, wd:wd, wdInc:wdInc, pts:pts, E:r.E,
          people:people, zero:zero, top:top, topShare:topShare, mbl:mbl,
          pay:pay, tot:tot, buyShare:tot ? buy / tot : 0, fairShare:tot ? fair / tot : 0, newShare:tot ? (fb + blog) / tot : 0, introShare:tot ? intro / tot : 0, oldest:oldest,
          coopN:coopN, payN:pay.length, coopShare:pay.length ? coopN / pay.length : 0, formalN:formal.length, deposit:deposit, avgFormal:avgFormal, three:three, single:single, stuDays:Object.keys(byStuDay).length,
          itvN:itvN, regN:regN, regRate:itvN >= 10 ? regN / itvN : null, appNoReg:appNoReg,
          ed:ed, due:due, ck:ck, rs:rs, perCk:ck ? r.cum / ck : 0, need:r.need, left:r.left };
      });
      var list = Object.keys(F).map(function(o){ return F[o]; }).sort(function(a,b){ return b.pct - a.pct; });
      list.forEach(function(f, i){ f.rank = i + 1; });
      return { ym:ym, gi:gi, d0:d0, d1:d1, endDay:endDay, endKey:endKey, lastDay:lastDay, F:F, list:list, G:G, M:Mend, S:S, keys:keys };
    }
var RV_STORIES = {
      burst:   { name:'爆衝', test:function(f){ return f.mom != null && f.mom >= 1.0 && (f.momEarly == null || f.momEarly < 0.5); }, score:function(f){ return 100 + f.mom * 10; },
        lines:[ function(f,R){ return '開頭三個上班日 ' + _rvW(f.got0) + ' 萬，最近三個上班日 ' + _rvW(f.got3) + ' 萬，七家平均 ' + _rvW(R.avgGot3) + ' 萬' + (R.got3Rank[f.org] === 1 ? '，七家最高' : '，排第 ' + R.got3Rank[f.org]); },
                function(f,R){ return '最近三個上班日做了 ' + _rvW(f.got3) + ' 萬，比七家平均多 ' + _rvW(f.got3 - R.avgGot3) + ' 萬' + (R.got3Rank[f.org] === 1 ? '，七家最高' : ''); },
                function(f,R){ return '三天做了 ' + _rvW(f.got3) + ' 萬，照目標這三天該做 ' + _rvW(f.exp3) + ' 萬，超過了，手感發燙'; } ] },
      comeback:{ name:'谷底往上', test:function(f,R){ return f.mom != null && f.mom >= 0.8 && f.momEarly != null && f.mom - f.momEarly >= 0.3 && !(f.mom >= 1.0 && f.momEarly < 0.5); }, score:function(f,R){ return 90 + (f.mom - f.momEarly) * 20; },
        lines:[ function(f,R){ return '開頭三個上班日 ' + _rvW(f.got0) + ' 萬，最近三個上班日 ' + _rvW(f.got3) + ' 萬，同樣三天做了 ' + (Math.round(f.got3 / Math.max(1, f.got0) * 10) / 10) + ' 倍' + (R.got3Rank[f.org] === 1 ? '，七家最高' : ''); },
                function(f,R){ return '最近三個上班日 ' + _rvW(f.got3) + ' 萬，七家平均 ' + _rvW(R.avgGot3) + ' 萬，從後面追上來'; },
                function(f,R){ return '開頭慢，最近三天做了 ' + _rvW(f.got3) + ' 萬，七家排第 ' + R.got3Rank[f.org] + '，前面落後的正在追回來'; } ] },
      steady:  { name:'一直往上', test:function(f,R){ return f.wd >= 5 && f.wdInc / f.wd >= 0.8 && _rvTop(R, function(x){ return x.wd ? x.wdInc / x.wd : 0; }, 2).indexOf(f.org) >= 0; }, score:function(f){ return 70 + f.wdInc / f.wd * 20 + f.pct * 10; },
        lines:[ function(f){ return f.wd + ' 個上班日裡 ' + f.wdInc + ' 天都有入帳，一天一天往上疊'; },
                function(f){ return '沒有一天停下來，' + f.wd + ' 個上班日有 ' + f.wdInc + ' 天進帳'; },
                function(f){ return '每天都有數字進來，' + f.wdInc + '／' + f.wd + ' 個上班日有入帳'; } ] },
      allOpen: { name:'全員開張', test:function(f){ return f.people.length >= 3 && f.zero === 0; }, score:function(f){ return 60 + f.people.length * 2; },
        lines:[ function(f){ return f.people.length + ' 位業務全部開張，沒有一個人掛零'; },
                function(f){ return '全員有數字，' + f.people.length + ' 個人每一位都做出業績'; },
                function(f){ return f.people.length + ' 個人全部開張，每個人都在場上'; } ] },
      mbl:     { name:'組員贏過組長', test:function(f){ return f.mbl.length > 0; }, score:function(f){ return 65 + f.mbl.length * 5; },
        lines:[ function(f){ var x = f.mbl[0]; return _rvName(x.m) + ' ' + _rvW(x.mv) + ' 萬，超過組長 ' + _rvName(x.l) + '，組長的業績寫在組員的名字後面'; },
                function(f){ var x = f.mbl[0]; return _rvName(x.l) + ' 組裡，' + _rvName(x.m) + ' 做到 ' + _rvW(x.mv) + ' 萬，組員跑到組長前面'; },
                function(f){ var x = f.mbl[0]; return '組員 ' + _rvName(x.m) + ' ' + _rvW(x.mv) + ' 萬，比組長還高，帶人帶出來了'; } ] },
      big:     { name:'一件做大', test:function(f,R){ return f.formalN >= 3 && (_rvTop(R, function(x){ return x.three; }, 2).indexOf(f.org) >= 0 || _rvTop(R, function(x){ return x.formalN >= 3 ? x.avgFormal : 0; }, 2).indexOf(f.org) >= 0); }, score:function(f){ return 60 + f.three * 4 + f.avgFormal / 10000; },
        lines:[ function(f,R){ return _rvBigIsThree(f, R) ? f.three + ' 件一次報三科，七家最多' : '正式學生一位平均簽 ' + _rvW(f.avgFormal) + ' 萬，七家最高' + (f.three ? '，' + f.three + ' 件三科' : ''); },
                function(f,R){ return _rvBigIsThree(f, R) ? '一次報三科的有 ' + f.three + ' 件，一件做大不是口號' : '不是打得多，是每一件做大：一位平均 ' + _rvW(f.avgFormal) + ' 萬'; },
                function(f,R){ return _rvBigIsThree(f, R) ? f.stuDays + ' 件裡 ' + f.three + ' 件三科，學生自己寫的想學都談到了' : f.formalN + ' 位正式學生，一位平均 ' + _rvW(f.avgFormal) + ' 萬'; } ] },
      coop:    { name:'兩個人一起談', test:function(f,R){ return f.payN >= 5 && f.coopShare >= 0.3 && _rvTop(R, function(x){ return x.payN >= 5 ? x.coopShare : 0; }, 2).indexOf(f.org) >= 0; }, score:function(f){ return 55 + f.coopShare * 30; },
        lines:[ function(f){ return f.payN + ' 件裡 ' + f.coopN + ' 件是兩個人一起談，沒有人一個人面談'; },
                function(f){ return '合談 ' + f.coopN + ' 件，佔 ' + Math.round(f.coopShare*100) + '%，一筆名單兩個人接'; },
                function(f){ return '十件有 ' + Math.round(f.coopShare*10) + ' 件兩個人談，新人不裸背'; } ] },
      old:     { name:'舊名單撈回來', test:function(f,R){ return f.payN >= 8 && f.buyShare + f.fairShare >= 0.5 && _rvTop(R, function(x){ return x.tot ? x.buyShare + x.fairShare : 0; }, 2).indexOf(f.org) >= 0; }, score:function(f){ return 50 + (f.buyShare + f.fairShare) * 30; },
        lines:[ function(f){ return '舊生加購佔 ' + Math.round(f.buyShare*100) + '%' + (f.fairShare >= 0.05 ? '，展場名單佔 ' + Math.round(f.fairShare*100) + '%' : '') + (f.oldest ? '，最老一筆是 ' + f.oldest + ' 年的展場' : '，班務有在經營'); },
                function(f){ return '錢有 ' + Math.round((f.buyShare + f.fairShare)*100) + '% 來自舊生和舊展場，手上的名單沒有放掉'; },
                function(f){ return '舊生加購 ' + Math.round(f.buyShare*100) + '%' + (f.fairShare >= 0.1 ? '、展場名單 ' + Math.round(f.fairShare*100) + '%' : '') + (f.oldest ? '，連 ' + f.oldest + ' 年的展場名單都撈回來' : '，手上的名單沒有放掉'); } ] },
      cross:   { name:'穿越', test:function(f,R){ return f.cross && R.endDay <= R.lastDay; }, score:function(f){ return 95 + f.pct * 10; },
        lines:[ function(f,R){ return (R.endDay < R.d1 ? '提前 ' + (R.d1 - R.endDay) + ' 天' : '') + '穿越第' + '一二三'[R.gi] + '關，累計 ' + _rvW(f.cum) + ' 萬，關卡目標 ' + _rvW(f.gateT) + ' 萬'; },
                function(f,R){ return '第' + '一二三'[R.gi] + '關目標 ' + _rvW(f.gateT) + ' 萬，做到 ' + _rvW(f.cum) + ' 萬，先過關'; } ] },
      ammo:    { name:'子彈最多', test:function(f,R){ return f.rs > 0 && f.rs === R.maxRs; }, score:function(f){ return 50 + f.rs / 5; },
        lines:[ function(f){ return '到月底還有 ' + f.rs + ' 位要來報到，七家最多，下一關的子彈最足'; },
                function(f){ return f.rs + ' 位已經約好到月底會來，子彈七家最多'; } ] },
      perCk:   { name:'每個報到做最大', test:function(f,R){ return f.ck >= 5 && f.perCk === R.maxPerCk; }, score:function(f){ return 55 + f.perCk / 10000; },
        lines:[ function(f){ return '報到 ' + f.ck + ' 位，每一個報到做出 ' + _rvW(f.perCk) + ' 萬，七家最高'; },
                function(f){ return '報到不是最多，但每個報到值 ' + _rvW(f.perCk) + ' 萬，七家第一'; } ] }
    };
function _rvFallback(f, R){
      var seed = _rvSeed(f.org);
      if (f.rs > 0) return _rvPick([ '到月底還有 ' + f.rs + ' 位約好會來，這一關的數字還沒寫完', '累計 ' + _rvW(f.cum) + ' 萬，手上還有 ' + f.rs + ' 位到月底報到' ], seed);
      if (f.people.length - f.zero > 0) return _rvPick([ (f.people.length - f.zero) + ' 位開張，累計 ' + _rvW(f.cum) + ' 萬，還在路上', '累計 ' + _rvW(f.cum) + ' 萬，' + (f.people.length - f.zero) + ' 個人有數字，邊跌倒邊修正' ], seed);
      return '還沒開張，這一關的路還在走';
    }
var RV_BLIND = [
      { k:'regRate', name:'面談多、註冊少', dir:'hi', get:function(f){ return f.regRate; }, flagOnly:function(f){ return f.regRate != null && f.regRate < 0.15; },
        blind:function(f){ return '面談 ' + f.itvN + ' 位，註冊 ' + f.regN + ' 位'; }, learn:function(b){ return '面談 ' + b.itvN + ' 位，註冊 ' + b.regN + ' 位'; },
        act:[ '明天每一場面談，先弄清楚這位學生要用什麼方式才會被打動，和誰去講', '明天面談前組長先跟業務聊 10 分鐘，這位是誰、為什麼來' ] },
      { k:'appNoReg', name:'報名了還沒註冊的人多', dir:'lo', get:function(f){ return f.itvN >= 5 && f.appNoReg >= 3 ? f.appNoReg / f.itvN : null; },
        blind:function(f){ return '報名了還沒註冊 ' + f.appNoReg + ' 位，面談 ' + f.itvN + ' 位'; }, learn:function(b){ return '面談 ' + b.itvN + ' 位，' + (b.appNoReg ? '報名了還沒註冊只有 ' + b.appNoReg + ' 位' : '沒有一位報名了還沒註冊'); },
        act:[ '明天從報未註名單挑兩位打，約一位回來再談一次，當天排試聽日', '明天把報名還沒註冊的名單全部重打一輪，用興趣方向當開場', '明天每位報未註的學生，先定誰可以來談、誰比較適合' ] },
      { k:'flat', name:'連續幾天沒入帳', dir:'lo', get:function(f){ return f.flat >= 2 ? f.flat : null; },
        blind:function(f){ return '連續 ' + f.flat + ' 個上班日沒入帳'; }, learn:function(b){ return b.wd + ' 個上班日有 ' + b.wdInc + ' 天入帳'; },
        act:[ '明天從到月底報到裡挑三位，先談那三位', '明天 13:40 前，組長押一件：學生全名、三科組合、誰陪談', '明天每個人先打 20 通，約到的進教室前組長先聊清楚是誰' ] },
      { k:'topShare', name:'一個人扛一半以上', dir:'lo', get:function(f){ return f.people.length >= 3 && f.topShare >= 0.45 ? f.topShare : null; },
        blind:function(f){ return _rvName(f.top.n) + ' 一個人 ' + _rvW(f.top.v) + ' 萬，佔 ' + Math.round(f.topShare*100) + '%'; }, learn:function(b){ return '最高的一位只佔 ' + Math.round(b.topShare*100) + '%，' + (b.people.length - b.zero) + ' 個人都有數字'; },
        act:[ '明天組長坐進組員的面談，一筆名單兩個人接', '明天最強的那一位各帶一位還沒開張的，合談一場', '明天組員各排一場面談，組長坐進去補刀，不自己另外談' ] },
      { k:'zero', name:'還沒開張的人多', dir:'lo', get:function(f){ return f.people.length >= 3 && f.zero >= 2 ? f.zero / f.people.length : null; },
        blind:function(f){ return f.people.length + ' 位業務，' + f.zero + ' 位還沒開張'; }, learn:function(b){ return b.people.length + ' 位業務，' + (b.zero ? b.zero + ' 位還沒開張' : '全部開張'); },
        act:[ '明天還沒開張的各談到一位學生，組長陪著談', '明天還沒開張的先打 20 通，約到的那一場組長坐進去', '明天強的各帶一位還沒開張的合談一場' ] },
      { k:'perCk', name:'每個報到做得小', dir:'hi', get:function(f){ return f.ck >= 5 ? f.perCk : null; },
        blind:function(f){ return '報到 ' + f.ck + ' 位，每個報到做出 ' + _rvW(f.perCk) + ' 萬'; }, learn:function(b){ return '報到 ' + b.ck + ' 位，每個報到做出 ' + _rvW(b.perCk) + ' 萬'; },
        act:[ '明天三科只從學生自己寫的想學組，價值講完才收', '明天每一位報到的學生，談完問三句：收到什麼、問題在哪裡、下一步約哪天' ] },
      { k:'rs', name:'到月底報到少', dir:'hi', get:function(f){ return f.people.length ? f.rs / f.people.length : null; },
        blind:function(f){ return '到月底報到 ' + f.rs + ' 位，' + f.people.length + ' 位業務一人不到 ' + Math.ceil(f.rs / f.people.length) + ' 位'; }, learn:function(b){ return '到月底報到 ' + b.rs + ' 位，一人 ' + (Math.round(b.rs / b.people.length * 10) / 10) + ' 位'; },
        act:[ '明天每個人從報未註和 7 天線上到期的名單各挑三位打，約到的排進到月底報到', '明天 13:40 前每個人排好三筆預約報到，寫學生全名和日期', '明天先往明天約，三天內必約，每人約兩位' ] },
      { k:'single', name:'單科件多', dir:'lo', get:function(f){ return f.stuDays >= 5 && f.single >= 3 ? f.single / f.stuDays : null; },
        blind:function(f){ return f.stuDays + ' 件裡 ' + f.single + ' 件只報一科'; }, learn:function(b){ return b.stuDays + ' 件裡 ' + b.three + ' 件三科，一位平均 ' + _rvW(b.avgFormal) + ' 萬'; },
        act:[ '明天三科只從學生自己寫的想學組，價值講完才收', '明天每一位先打包單門課再接正課，舊生談兩次', '明天面談表先圈出學生自己寫的三個想學，照九階梯談完才收' ] },
      { k:'coop', name:'一個人面談多', dir:'hi', get:function(f){ return f.payN >= 5 ? f.coopShare : null; },
        blind:function(f){ return f.payN + ' 件裡只有 ' + f.coopN + ' 件兩個人談'; }, learn:function(b){ return b.payN + ' 件裡 ' + b.coopN + ' 件兩個人談'; },
        act:[ '明天強的各帶一位還沒開張的，合談一場', '明天組長坐進組員的面談，一筆名單兩個人接', '明天新人的每一場都有人陪，不一個人面談' ] },
      { k:'buy', name:'舊生和展場名單用得少', dir:'hi', get:function(f){ return f.tot > 0 && f.payN >= 10 ? f.buyShare + f.fairShare : null; },
        blind:function(f){ return '舊生加購加展場名單只佔 ' + Math.round((f.buyShare + f.fairShare)*100) + '%'; }, learn:function(b){ return '舊生加購加展場名單佔 ' + Math.round((b.buyShare + b.fairShare)*100) + '%'; },
        act:[ '明天從班務舊生挑三位打，先問下一門想學什麼', '明天課前 15 分鐘、課後 10 分鐘到教室，跟舊生聊下一門', '明天把結業班的名單拿出來，每人挑兩位約回來談' ] },
      { k:'stale', name:'名單沒人顧', dir:'lo', get:function(f){ return f.ed && f.ed.total >= 20 ? f.ed.stale / f.ed.total : null; },
        blind:function(f){ return f.ed.stale + ' 位學生超過 15 天沒有人在 EIP 動過'; }, learn:function(b){ return '超過 15 天沒人動的只有 ' + b.ed.stale + ' 位'; },
        act:[ '明天組長先把超過 15 天沒動的名單分給人，每人 10 筆，打完回報', '明天組長把超過 15 天沒動的名單分下去，每人 10 筆，每一通備註寫學生說了什麼、下一步約哪天' ] },
      { k:'due', name:'面談過沒註冊的學生沒人追', dir:'lo', get:function(f){ return f.people.length && f.due >= 5 ? f.due / f.people.length : null; },
        blind:function(f){ return f.due + ' 位面談過還沒註冊的學生，已經過了約好要再聯絡的日子，還沒有人寫原因和下一步'; }, learn:function(b){ return '過了約好的日子還沒寫下一步的只有 ' + b.due + ' 位'; },
        act:[ '明天 13:40 前，這 {due} 位每一位在 EIP 寫清楚：沒報名的真正原因、下一步要做什麼、哪一天再約', '明天組長把這 {due} 位一位一位過，當場定誰去談、哪一天約回來' ] }
    ];
function _rvPairs(R, used){
      var list = R.list, out = [], kgOnce = false;
      var cand = [];
      list.forEach(function(f){
        RV_BLIND.forEach(function(B){
          var v = B.get(f); if (v == null) return;
          var others = list.filter(function(o){ return o.org !== f.org && B.get(o) != null && !(_rvRegion(f.org) === 'central' && _rvRegion(o.org) === 'central'); });
          if (!others.length) return;
          var best = others.slice().sort(function(a,b){ return B.dir === 'hi' ? B.get(b) - B.get(a) : B.get(a) - B.get(b); })[0], bv = B.get(best);
          var gap = B.dir === 'hi' ? (bv > 0 ? (bv - v) / bv : 0) : (v > 0 ? (v - bv) / v : 0);
          if (B.dir === 'hi' ? v * 1.5 > bv : v < bv * 2) return;
          cand.push({ org:f.org, B:B, v:v, best:best, bv:bv, gap:gap, f:f });
        });
      });
      cand.sort(function(a,b){ return b.gap - a.gap; });
      var orgDone = {}, kDone = {};
      cand.forEach(function(c){
        if (orgDone[c.org]) return;
        if (out.length < 3 && kDone[c.B.k]) return;
        if (c.best.org === '高雄建國'){ if (kgOnce) return; }
        orgDone[c.org] = 1; kDone[c.B.k] = 1; if (c.best.org === '高雄建國') kgOnce = true;
        var seed = _rvSeed(c.org) + (used[c.B.k] || 0);
        out.push({ org:c.org, k:c.B.k, name:c.B.name, gap:c.gap, blind:c.B.blind(c.f), learnOrg:c.best.org, learn:c.B.learn(c.best), act:_rvPick(c.B.act, seed).replace(/\{due\}/g, c.f.due), red:c.f.refund > 0.1 ? '退費佔業績 ' + Math.round(c.f.refund*100) + '%，要先處理' : '' });
      });
      return out;
    }
function _rvTurn(R, f){
      var pts = f.pts.filter(function(p){ return p.wd; }); if (pts.length < 5) return null;
      var roll = pts.map(function(p, i){ var g = 0, e = 0; for (var j = Math.max(0, i - 2); j <= i; j++){ g += pts[j].inc; e += pts[j].exp; } return e ? g / e : null; });
      var ti = -1; for (var i = 2; i < roll.length; i++){ if (roll[i] != null && roll[i] >= 1 && roll[i-1] != null && roll[i-1] < 0.6){ ti = i; break; } }
      if (ti < 0 || pts.length - ti < 2) return null;
      var tp = pts[ti], before = pts.slice(Math.max(0, ti - 3), ti).map(function(p){ return p.d; }), after = pts.slice(ti, ti + 3).map(function(p){ return p.d; });
      var side = function(days){
        var P = f.pay.filter(function(p){ var dd = +String(p.d).split(/[\/\-]/)[2]; return days.indexOf(dd) >= 0; });
        var tot = 0, buy = 0, fair = 0, coop = 0, byStu = {}, byDay = {}, nkd = {};
        P.forEach(function(p){ var k = p.n + '|' + (p.k || '') + '|' + p.d; nkd[k] = nkd[k] || {}; _rvSplitO(p.o).forEach(function(o){ nkd[k][o] = 1; }); }); coop = Object.keys(nkd).filter(function(k){ return Object.keys(nkd[k]).length >= 2; }).length;
        P.forEach(function(p){ var v = +p.v || 0; tot += v; if (/學員加購/.test(p.sub)) buy += v; if (_rvIsFair(p.sub)) fair += v; byStu[p.n] = (byStu[p.n] || 0) + v; var k = p.n + '|' + p.d; byDay[k] = byDay[k] || {}; if (p.k) byDay[k][p.k] = 1; });
        var formal = Object.keys(byStu).filter(function(n){ return byStu[n] >= 10000; });
        var ck = 0, n = 0; days.forEach(function(d){ var k = _dsDate(R.ym, d), pk = _dsDate(R.ym, d - 1); var c = R.S[k] && R.S[k].o[f.org], p = R.S[pk] && R.S[pk].o[f.org]; if (c && p){ ck += Math.max(0, c.ck - p.ck); n++; } });
        var sci = Object.keys(byDay).map(function(k){ return Object.keys(byDay[k]).length; });
        return { ck: n ? ck / n : null, buy: tot ? buy / tot : null, fair: tot ? fair / tot : null, coop: coop, avg: formal.length ? formal.reduce(function(a, x){ return a + byStu[x]; }, 0) / formal.length : null, sci: sci.length ? sci.reduce(function(a, b){ return a + b; }, 0) / sci.length : null, n:P.length };
      };
      var A = side(before), B = side(after), ch = [];
      var push = function(txt, score){ ch.push({ t:txt, s:score }); };
      if (A.ck != null && B.ck != null && Math.abs(B.ck - A.ck) >= 1) push('每天報到 ' + Math.round(A.ck) + ' 位變 ' + Math.round(B.ck) + ' 位', Math.abs(B.ck - A.ck) / Math.max(1, A.ck));
      if (A.buy != null && B.buy != null && Math.abs(B.buy - A.buy) >= 0.15) push('舊生加購從 ' + Math.round(A.buy*10) + ' 成變 ' + Math.round(B.buy*10) + ' 成', Math.abs(B.buy - A.buy) * 2);
      if (A.fair != null && B.fair != null && Math.abs(B.fair - A.fair) >= 0.15) push('展場名單從 ' + Math.round(A.fair*10) + ' 成變 ' + Math.round(B.fair*10) + ' 成', Math.abs(B.fair - A.fair) * 2);
      if (B.coop - A.coop >= 2) push('兩個人一起談從 ' + A.coop + ' 件變 ' + B.coop + ' 件', (B.coop - A.coop) / 3);
      if (A.avg != null && B.avg != null && Math.abs(B.avg - A.avg) >= 10000) push('一位正式學生平均從 ' + _rvW(A.avg) + ' 萬變 ' + _rvW(B.avg) + ' 萬', Math.abs(B.avg - A.avg) / Math.max(10000, A.avg));
      if (A.sci != null && B.sci != null && Math.abs(B.sci - A.sci) >= 0.5) push('一件平均從 ' + (Math.round(A.sci*10)/10) + ' 科變 ' + (Math.round(B.sci*10)/10) + ' 科', Math.abs(B.sci - A.sci));
      if (B.n - A.n >= 3) push('入帳從 ' + A.n + ' 筆變 ' + B.n + ' 筆', (B.n - A.n) / Math.max(1, A.n));
      ch.sort(function(a,b){ return b.s - a.s; });
      return { day:tp.d, k:tp.k, lines:ch.slice(0, 2).map(function(x){ return x.t; }), beforeInc:pts.slice(0, ti).reduce(function(a, p){ return a + p.inc; }, 0), afterInc:pts.slice(ti).reduce(function(a, p){ return a + p.inc; }, 0) };
    }
function _rvUsed(){ try { return JSON.parse(localStorage.getItem('rv_used_v1') || '{}'); } catch(e){ return {}; } }
function _rvNotes(ym, gi){ try { return JSON.parse(localStorage.getItem('perf_compare_v1_rv_' + ym + '_' + gi) || '{}'); } catch(e){ return {}; } }
function rvSaveNote(ym, gi, id, txt){ var n = _rvNotes(ym, gi); txt = String(txt || '').trim(); if (txt) n[id] = { t:txt, by:_fnMe(), at:Date.now() }; else delete n[id]; try { localStorage.setItem('perf_compare_v1_rv_' + ym + '_' + gi, JSON.stringify(n)); } catch(e){} _syncToast('✅ 這一句存起來了，主管們看到的是同一份', '#4ade80'); }
function _rvBuild(ym, gi){
      var R = _rvGather(ym, gi); if (!R) return null;
      R.avgPct = R.list.reduce(function(a, f){ return a + f.pct; }, 0) / R.list.length;
      R.avgGot3 = R.list.reduce(function(a, f){ return a + (f.got3 || 0); }, 0) / R.list.length;
      R.got3Rank = {}; R.list.slice().sort(function(a,b){ return (b.got3 || 0) - (a.got3 || 0); }).forEach(function(f, i){ R.got3Rank[f.org] = i + 1; });
      R.maxRs = Math.max.apply(null, R.list.map(function(f){ return f.rs; })); R.maxPerCk = Math.max.apply(null, R.list.map(function(f){ return f.ck >= 5 ? f.perCk : 0; }));
      var used = _rvUsed(), notes = _rvNotes(ym, gi), gName = gi < 0 ? '這個月' : '第' + '一二三'[gi] + '關', per = (gi < 0 ? '10/1' : (+ym.slice(5)) + '/' + R.d0) + '–' + (+ym.slice(5)) + '/' + R.endDay;
      var slides = [];
      slides.push({ id:'open', kind:'open', sec:5, title:gName + '走到 ' + (+ym.slice(5)) + '/' + R.endDay + '，七家各走了一條自己的路', sub:per, src:'每天的快照' });
      slides.push({ id:'lines', kind:'lines', sec:8, title:'七條線一天一天長出來', src:'每天的快照，虛線＝照目標每天該做到的' });
      // 七家各一句
      var stories = [], typeN = {};
      R.list.forEach(function(f){
        var cands = [];
        Object.keys(RV_STORIES).forEach(function(k){ var ST = RV_STORIES[k]; var ok = false; try { ok = ST.test(f, R); } catch(e){} if (!ok) return; cands.push({ k:k, sc:ST.score(f, R) - (used[k] || 0) * 3, ST:ST }); });
        cands.sort(function(a,b){ return b.sc - a.sc; });
        var best = cands.filter(function(c){ return (typeN[c.k] || 0) < 2; })[0] || null; if (best) typeN[best.k] = (typeN[best.k] || 0) + 1;
        var seed = _rvSeed(f.org) + (best ? (used[best.k] || 0) : 0);
        var line = best ? _rvPick(best.ST.lines, seed)(f, R) : _rvFallback(f, R);
        stories.push({ org:f.org, k:best ? best.k : 'fb', name:best ? best.ST.name : '還在路上', sc:best ? best.sc : 0, line:line, f:f });
      });
      slides.push({ id:'seven', kind:'seven', sec:12, title:'七家，每一家都有一句', rows:stories.map(function(s){ return { org:s.org, line:'🎉' + _gcShort(s.org) + ' ' + s.line, name:s.name }; }), src:'每天的快照、入帳明細、漏斗、報到、小組表' });
      // 三家放大（中區同一種故事合成一張）
      var big = stories.filter(function(s){ return s.k !== 'fb'; }).sort(function(a,b){ return b.sc - a.sc; }), picked = [], centralK = {};
      big.forEach(function(s){ if (picked.length >= 3) return; var reg = _rvRegion(s.org); if (reg === 'central' && centralK[s.k]){ centralK[s.k].push(s); return; } if (reg === 'central') centralK[s.k] = [s]; picked.push(s); });
      picked.forEach(function(s, i){
        var group = (_rvRegion(s.org) === 'central' && centralK[s.k] && centralK[s.k].length > 1) ? centralK[s.k] : [s];
        var orgs = group.map(function(x){ return x.org; }), turn = null; try { if (s.k === 'burst' || s.k === 'comeback') turn = _rvTurn(R, s.f); } catch(e){}
        var lines = group.length > 1 ? group.map(function(x){ return _gcShort(x.org) + ' ' + x.line; }) : [s.line];
        if (turn){ lines.push((+ym.slice(5)) + '/' + turn.day + ' 那天開始：' + (turn.lines.length ? turn.lines.join('，') : '入帳從 ' + _rvW(turn.beforeInc) + ' 萬變 ' + _rvW(turn.afterInc) + ' 萬')); }
        if (s.f.people.length >= 3 && s.f.zero === 0 && s.k !== 'allOpen') lines.push(s.f.people.length + ' 個人全員有數字');
        var id = 'big' + (i + 1);
        slides.push({ id:id, kind:'big', sec:9, orgs:orgs, title:'🎉' + (group.length > 1 ? '中區三家一起' : _gcShort(s.org)) + '　' + s.name, lines:lines, turn:turn, note:(notes[id] || {}).t || '', src:'每天的快照' + (turn ? '、入帳明細（轉折前後各 3 個上班日）' : '') });
      });
      // 三對盲點
      var pairs = _rvPairs(R, used).slice(0, 7);
      pairs.slice(0, 3).forEach(function(p, i){
        var id = 'blind' + (i + 1);
        slides.push({ id:id, kind:'blind', sec:8, orgs:[p.org], title:_gcShort(p.org) + '　' + p.name, lines:[ p.blind, '可以學：' + _gcShort(p.learnOrg) + ' ' + p.learn, p.act ].concat(p.red ? [p.red] : []), note:(notes[id] || {}).t || '', src:'漏斗、入帳明細、報到、編輯追蹤、追蹤卡' });
      });
      if (pairs.length > 3) slides.push({ id:'blindRest', kind:'blindRest', sec:6, title:'另外幾家，各一行', rows:pairs.slice(3).map(function(p){ return { org:p.org, line:_gcShort(p.org) + ' ' + p.blind + '　→ ' + p.act }; }), src:'同上' });
      // 收尾
      var nextGi = gi < 0 ? -1 : Math.min(2, gi + 1), nextLines = [];
      if (gi >= 0 && gi < 2){
        var G = R.G, nd = 0, needSum = 0;
        R.list.forEach(function(f){ var left = 0; for (var d = Math.max(G[nextGi][0], R.lastDay + 1); d <= G[nextGi][1]; d++) if (!_dsIsHol(ym, f.org, _dsDate(ym, d))) left++; var tN = _dsGateCum(ym, f.org, f.T, nextGi); if (left){ needSum += Math.max(0, tN - f.cum) / left; nd = Math.max(nd, left); } });
        nextLines.push('第' + '一二三'[nextGi] + '關，七家這條路每天要走 ' + _rvW(needSum) + ' 萬');
      } else nextLines.push('這個月的路走到 ' + _rvW(R.list.reduce(function(a, f){ return a + f.cum; }, 0)) + ' 萬');
      var rsSum = R.list.reduce(function(a, f){ return a + f.rs; }, 0); if (rsSum) nextLines.push('到月底報到七家加起來 ' + rsSum + ' 位，子彈夠');
      nextLines.push('13:40 日會，主管先看組長押的那一件');
      slides.push({ id:'end', kind:'end', sec:9, title:'', lines:nextLines, note:(notes.end || {}).t || '', src:'每天的快照、報到、十月活動' });
      var total = slides.reduce(function(a, s){ return a + s.sec; }, 0);
      return { ym:ym, gi:gi, gName:gName, per:per, slides:slides, total:total, R:R };
    }
function rvOpen(gi){
      var ym = _ppLiveYm(); if (!ym) return;
      if (gi == null){ var M0 = _dsModel(ym, Object.keys(_dsSnaps(ym)).sort().pop()); gi = M0.gi; if (M0.day === M0.G[gi][0] && gi > 0) gi = gi - 1; }
      var SC = null; try { SC = _rvBuild(ym, gi); } catch(e){ console.error(e); alert('劇本算不出來：' + (e.message || e)); return; }
      if (!SC) return;
      window._RV = SC;
      var bg = document.getElementById('rvBg'); if (!bg){ bg = document.createElement('div'); bg.id = 'rvBg'; bg.onclick = function(e){ if (e.target === bg) bg.remove(); }; document.body.appendChild(bg); }
      var h = '<div class="rv-box"><div class="rv-top"><b>🎬 90 秒回顧　劇本預覽</b><span>' + _fnEsc(SC.gName + '　' + SC.per) + '　共 ' + SC.slides.length + ' 張、約 ' + SC.total + ' 秒</span>'
        + '<span class="rv-gates">' + [0,1,2].map(function(g){ return '<button class="' + (g === SC.gi ? 'on' : '') + '" onclick="rvOpen(' + g + ')">第' + '一二三'[g] + '關</button>'; }).join('') + '<button class="' + (SC.gi < 0 ? 'on' : '') + '" onclick="rvOpen(-1)">整個月</button></span>'
        + '<button class="rv-x" onclick="document.getElementById(\'rvBg\').remove()">✕</button></div>'
        + '<p class="rv-sub">這份劇本是網頁照規則從現在的數字寫出來的，沒有叫 AI。每張右下角寫數字從哪裡來。放大和盲點那幾張可以補一句，存起來全公司共享</p>';
      SC.slides.forEach(function(s, i){
        h += '<div class="rv-s"><div class="rv-n">' + (i + 1) + '<small>' + s.sec + ' 秒</small></div><div class="rv-c">'
          + (s.title ? '<h4>' + _fnEsc(s.title) + '</h4>' : '') + (s.sub ? '<p class="rv-dim">' + _fnEsc(s.sub) + '</p>' : '')
          + (s.rows ? '<ul>' + s.rows.map(function(r){ return '<li>' + _fnEsc(r.line) + (r.name ? '<small>' + _fnEsc(r.name) + '</small>' : '') + '</li>'; }).join('') + '</ul>' : '')
          + (s.lines ? '<ul>' + s.lines.map(function(l){ return '<li>' + _fnEsc(l) + '</li>'; }).join('') + '</ul>' : '')
          + (s.kind === 'big' || s.kind === 'blind' || s.kind === 'end' ? '<div class="rv-note"><input placeholder="補一句（例：回國第一天）" value="' + _fnEsc(s.note || '') + '" onchange="rvSaveNote(\'' + SC.ym + '\',' + SC.gi + ',\'' + s.id + '\', this.value)"><small>' + (s.note ? '已存，主管們看得到' : '打完按 Enter 存，全公司共享') + '</small></div>' : '')
          + '<p class="rv-src">資料來源：' + _fnEsc(s.src || '') + '</p></div></div>';
      });
      h += '<div class="rv-foot"><button class="rv-play" onclick="rvPlay()">▶ 播放（全螢幕，約 ' + SC.total + ' 秒）</button><button onclick="rvCopy()">📋 複製劇本文字</button></div></div>';
      bg.innerHTML = h; bg.style.display = 'flex';
    }
function rvCopy(){
      var SC = window._RV; if (!SC) return;
      var t = SC.slides.map(function(s, i){ return (i + 1) + '. ' + (s.title || '') + (s.rows ? '\n' + s.rows.map(function(r){ return r.line; }).join('\n') : '') + (s.lines ? '\n' + s.lines.join('\n') : '') + (s.note ? '\n（補：' + s.note + '）' : ''); }).join('\n\n');
      try { navigator.clipboard.writeText(t); _syncToast('📋 劇本文字已複製', '#4ade80'); } catch(e){}
    }
function _rvCol(R, org){ var i = R.list.map(function(f){ return f.org; }).indexOf(org); var j = CK_ORG_LIST.indexOf(org); return GC_COL[(j >= 0 ? j : i) % GC_COL.length]; }
function _rvChart(R, opts){
      opts = opts || {}; var W = 1000, H = 420, L = 56, Rr = 150, TP = 24, B = 34;
      var dA = R.gi < 0 ? 1 : R.d0, dB = R.gi < 0 ? _dsDays(R.ym) : R.d1;
      var maxPct = 0.34; R.list.forEach(function(f){ f.pts.forEach(function(p){ maxPct = Math.max(maxPct, p.cum / (f.T || 1)); }); });
      maxPct = Math.min(1.2, maxPct * 1.15);
      var px = function(d){ return L + (d - dA) / Math.max(1, dB - dA) * (W - L - Rr); }, py = function(v){ return TP + (1 - Math.min(1, v / maxPct)) * (H - TP - B); };
      var h = '<svg class="rvp-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">';
      [0.25, 0.5, 0.75, 1].forEach(function(v){ if (v > maxPct) return; h += '<line x1="' + L + '" y1="' + py(v) + '" x2="' + (W - Rr) + '" y2="' + py(v) + '" stroke="rgba(255,255,255,.12)"/><text x="' + (L - 8) + '" y="' + (py(v) + 5) + '" text-anchor="end" fill="#CECBF6" font-size="15">' + Math.round(v * 100) + '%</text>'; });
      R.G.forEach(function(g){ if (g[1] < dA || g[1] > dB) return; h += '<line x1="' + px(g[1]) + '" y1="' + TP + '" x2="' + px(g[1]) + '" y2="' + (H - B) + '" stroke="rgba(255,255,255,.35)" stroke-dasharray="5 5"/><text x="' + px(g[1]) + '" y="' + (TP - 6) + '" text-anchor="middle" fill="#EEEDFE" font-size="15">🏁 ' + (+R.ym.slice(5)) + '/' + g[1] + '</text>'; });
      // 照目標每天該做到（第一家的節奏）
      var f0 = R.list[0]; if (f0 && f0.E && f0.E.cum){ var tp = []; for (var d = dA; d <= dB; d++) tp.push(px(d) + ',' + py((f0.E.cum[d] || 0) / (f0.T || 1))); h += '<polyline points="' + tp.join(' ') + '" fill="none" stroke="#EEEDFE" stroke-width="2" stroke-dasharray="7 6" opacity=".55"/>'; }
      var focus = opts.focus || null, labels = [];
      R.list.forEach(function(f){
        var on = !focus || focus.indexOf(f.org) >= 0, col = _rvCol(R, f.org);
        var pts = f.pts.filter(function(p){ return p.d >= dA && p.d <= dB; }); if (!pts.length) return;
        var d1 = [px(dA) + ',' + py(0)].concat(pts.map(function(p){ return px(p.d) + ',' + py(p.cum / (f.T || 1)); }));
        h += '<polyline class="rvp-line' + (opts.grow ? ' grow' : '') + '" data-org="' + _fnEsc(f.org) + '" points="' + d1.join(' ') + '" fill="none" stroke="' + col + '" stroke-width="' + (on ? 5 : 2.5) + '" stroke-linejoin="round" stroke-linecap="round" opacity="' + (on ? 1 : 0.18) + '"' + (opts.grow ? ' style="animation-duration:' + opts.grow + 's"' : '') + '/>';
        var last = pts[pts.length - 1];
        if (on) h += '<circle class="rvp-dot' + (opts.grow ? ' grow' : '') + '" cx="' + px(last.d) + '" cy="' + py(last.cum / (f.T || 1)) + '" r="9" fill="' + col + '" stroke="#fff" stroke-width="3"' + (opts.grow ? ' style="animation-delay:' + opts.grow + 's"' : '') + '/>';
        labels.push({ y:py(last.cum / (f.T || 1)), t:_gcShort(f.org) + ' ' + Math.round(last.cum / (f.T || 1) * 100) + '%', col:col, on:on });
      });
      labels.sort(function(a,b){ return a.y - b.y; }); for (var i = 1; i < labels.length; i++) if (labels[i].y - labels[i-1].y < 24) labels[i].y = labels[i-1].y + 24;
      labels.forEach(function(l){ h += '<text class="rvp-lab' + (opts.grow ? ' grow' : '') + '" x="' + (W - Rr + 14) + '" y="' + (l.y + 6) + '" fill="' + l.col + '" font-size="22" font-weight="800" opacity="' + (l.on ? 1 : 0.3) + '"' + (opts.grow ? ' style="animation-delay:' + opts.grow + 's"' : '') + '>' + _fnEsc(l.t) + '</text>'; });
      h += '<text x="' + L + '" y="' + (H - 10) + '" fill="#CECBF6" font-size="15">' + (+R.ym.slice(5)) + '/' + dA + '</text><text x="' + (W - Rr) + '" y="' + (H - 10) + '" text-anchor="end" fill="#CECBF6" font-size="15">' + (+R.ym.slice(5)) + '/' + dB + '</text>';
      return h + '</svg>';
    }
function _rvSlideHtml(SC, s){
      var R = SC.R, st = function(i){ return ' style="animation-delay:' + (0.3 + i * 1.1) + 's"'; };
      if (s.kind === 'open') return '<div class="rvp-open"><h1 class="rvp-in">' + _fnEsc(s.title) + '</h1><p class="rvp-in" style="animation-delay:.8s">' + _fnEsc(s.sub || '') + '</p></div>';
      if (s.kind === 'lines') return '<div class="rvp-chart"><h2 class="rvp-in">' + _fnEsc(s.title) + '</h2>' + _rvChart(R, { grow:Math.max(3, s.sec - 2) }) + '</div>';
      if (s.kind === 'seven') return '<div class="rvp-seven"><h2 class="rvp-in">' + _fnEsc(s.title) + '</h2><ul>' + s.rows.map(function(r, i){ return '<li class="rvp-in" style="animation-delay:' + (0.4 + i * 1.3) + 's;border-color:' + _rvCol(R, r.org) + '">' + _fnEsc(r.line) + '</li>'; }).join('') + '</ul></div>';
      if (s.kind === 'big') return '<div class="rvp-big"><h2 class="rvp-in">' + _fnEsc(s.title) + '</h2><div class="rvp-big-body">' + _rvChart(R, { focus:s.orgs }) + '<ul>' + s.lines.map(function(l, i){ return '<li class="rvp-in"' + st(i + 0.6) + '>' + _fnEsc(l) + '</li>'; }).join('') + (s.note ? '<li class="rvp-in rvp-note"' + st(s.lines.length + 0.6) + '>' + _fnEsc(s.note) + '</li>' : '') + '</ul></div></div>';
      if (s.kind === 'blind') return '<div class="rvp-blind"><h2 class="rvp-in" style="color:' + _rvCol(R, s.orgs[0]) + '">' + _fnEsc(s.title) + '</h2>'
        + '<p class="rvp-in rvp-b1"' + st(0.6) + '>' + _fnEsc(s.lines[0]) + '</p>'
        + (s.lines[1] ? '<p class="rvp-in rvp-b2"' + st(1.8) + '>' + _fnEsc(s.lines[1]) + '</p>' : '')
        + (s.lines[2] ? '<p class="rvp-in rvp-b3"' + st(3.2) + '>👉 ' + _fnEsc(s.lines[2]) + '</p>' : '')
        + (s.lines[3] ? '<p class="rvp-in rvp-b1"' + st(4.2) + '>' + _fnEsc(s.lines[3]) + '</p>' : '')
        + (s.note ? '<p class="rvp-in rvp-note"' + st(4.6) + '>' + _fnEsc(s.note) + '</p>' : '') + '</div>';
      if (s.kind === 'blindRest') return '<div class="rvp-seven"><h2 class="rvp-in">' + _fnEsc(s.title) + '</h2><ul>' + s.rows.map(function(r, i){ return '<li class="rvp-in" style="animation-delay:' + (0.4 + i * 1.4) + 's;border-color:' + _rvCol(R, r.org) + '">' + _fnEsc(r.line) + '</li>'; }).join('') + '</ul></div>';
      if (s.kind === 'end') return '<div class="rvp-end"><div class="rvp-end-chart">' + _rvChart(R, {}) + '</div><ul>' + s.lines.map(function(l, i){ return '<li class="rvp-in" style="animation-delay:' + (2.2 + i * 1.6) + 's">' + _fnEsc(l) + '</li>'; }).join('') + (s.note ? '<li class="rvp-in rvp-note" style="animation-delay:' + (2.2 + s.lines.length * 1.6) + 's">' + _fnEsc(s.note) + '</li>' : '') + '</ul></div>';
      return '';
    }
function rvPlay(SC){
      SC = SC || window._RV; if (!SC) return;
      try { var bg0 = document.getElementById('rvBg'); if (bg0) bg0.remove(); } catch(e){}
      var el = document.getElementById('rvPlay'); if (!el){ el = document.createElement('div'); el.id = 'rvPlay'; document.body.appendChild(el); }
      _RVP = { SC:SC, i:-1, t0:0, paused:false, timer:null, el:el, elapsed:0 };
      el.innerHTML = '<div class="rvp-stage" id="rvpStage"></div>'
        + '<div class="rvp-bar"><button onclick="rvStep(-1)" title="上一張（←）">◀</button><button id="rvpPause" onclick="rvPause()" title="暫停／繼續（空白鍵）">❚❚</button><button onclick="rvStep(1)" title="下一張（→）">▶</button>'
        + '<div class="rvp-tl" id="rvpTl" onclick="rvJump(event)">' + SC.slides.map(function(s, i){ return '<i style="flex:' + s.sec + '" data-i="' + i + '" title="' + _fnEsc(s.title || s.kind) + '"><b></b></i>'; }).join('') + '</div>'
        + '<span id="rvpClock">0:00 / ' + Math.floor(SC.total / 60) + ':' + _ckPad2(SC.total % 60) + '</span><button onclick="rvStop()" title="離開（Esc）">✕</button></div>';
      el.style.display = 'block'; document.documentElement.classList.add('rvp-lock');
      try { if (el.requestFullscreen) el.requestFullscreen().catch(function(){}); } catch(e){}
      rvGo(0);
      _RVP.tick = setInterval(_rvTick, 250);
    }
function rvGo(i){
      var P = _RVP; if (!P) return; var SC = P.SC; if (i < 0) i = 0; if (i >= SC.slides.length){ rvStop(); return; }
      P.i = i; P.t0 = Date.now(); P.elapsed = SC.slides.slice(0, i).reduce(function(a, s){ return a + s.sec; }, 0);
      var s = SC.slides[i], stage = document.getElementById('rvpStage');
      stage.innerHTML = '<div class="rvp-slide rvp-' + s.kind + '">' + _rvSlideHtml(SC, s) + (s.src ? '<small class="rvp-src">' + _fnEsc(s.src) + '</small>' : '') + '</div>';
      // 線條長出來：量長度後用 dashoffset
      stage.querySelectorAll('polyline.rvp-line.grow').forEach(function(p){ try { var len = p.getTotalLength(); p.style.strokeDasharray = len; p.style.strokeDashoffset = len; p.getBoundingClientRect(); p.classList.add('go'); } catch(e){} });
      document.querySelectorAll('#rvpTl i').forEach(function(x, k){ x.classList.toggle('done', k < i); x.classList.toggle('cur', k === i); });
      if (P.timer) clearTimeout(P.timer);
      if (!P.paused) P.timer = setTimeout(function(){ rvGo(i + 1); }, s.sec * 1000);
    }
function _rvTick(){
      var P = _RVP; if (!P || P.paused) return; var s = P.SC.slides[P.i]; if (!s) return;
      var inS = Math.min(s.sec, (Date.now() - P.t0) / 1000), tot = P.elapsed + inS, c = document.getElementById('rvpClock');
      if (c) c.textContent = Math.floor(tot / 60) + ':' + _ckPad2(Math.floor(tot % 60)) + ' / ' + Math.floor(P.SC.total / 60) + ':' + _ckPad2(P.SC.total % 60);
      var cur = document.querySelector('#rvpTl i.cur b'); if (cur) cur.style.width = Math.round(inS / s.sec * 100) + '%';
    }
function rvStep(d){ var P = _RVP; if (!P) return; rvGo(P.i + d); }
function rvJump(e){ var t = e.target.closest('i'); if (!t) return; rvGo(+t.getAttribute('data-i')); }
function rvPause(){
      var P = _RVP; if (!P) return; P.paused = !P.paused; var b = document.getElementById('rvpPause'); if (b) b.textContent = P.paused ? '▶' : '❚❚';
      var stage = document.getElementById('rvpStage'); if (stage) stage.classList.toggle('paused', P.paused);
      if (P.paused){ if (P.timer) clearTimeout(P.timer); P.pausedAt = Date.now(); }
      else { var s = P.SC.slides[P.i]; P.t0 += Date.now() - (P.pausedAt || Date.now()); var left = Math.max(300, s.sec * 1000 - (Date.now() - P.t0)); P.timer = setTimeout(function(){ rvGo(P.i + 1); }, left); }
    }
function rvStop(){
      var P = _RVP; if (!P) return; if (P.timer) clearTimeout(P.timer); if (P.tick) clearInterval(P.tick);
      try { if (document.fullscreenElement) document.exitFullscreen(); } catch(e){}
      P.el.style.display = 'none'; P.el.innerHTML = ''; document.documentElement.classList.remove('rvp-lock'); _RVP = null;
    }
function dsDownloadMobile(){
      var src = document.querySelector('#ppEvBg .ds-box'); if (!src){ alert('先打開一張看板'); return; }
      var go = function(){
        var wrap = document.createElement('div'); wrap.className = 'dsm-wrap';
        var box = src.cloneNode(true); box.classList.add('dsm');
        // 拿掉按鈕、工具列、提示、展開面板
        box.querySelectorAll('.pp-ev-top, .ds-bar, .evo-tabs, .ds-vbar, .ds-cust, .ds-regbar, .ds-npanel, .evo-warn, .ds-lchips, .dss-vt, .ds-x, .gc-bar, .gc-chips, .gc-info, button, details:not([open])').forEach(function(n){ n.remove(); });
        // 月曆：日期寫進每一格（手機版沒有表頭那一列）
        box.querySelectorAll('.dsc').forEach(function(cal){
          var head = cal.querySelector('.dsc-h'); if (!head) return;
          var labels = Array.prototype.slice.call(head.querySelectorAll('.dsc-c')).map(function(c){ return c.textContent.replace('✕', '').trim(); });
          cal.querySelectorAll('.dsc-r:not(.dsc-h)').forEach(function(row){
            Array.prototype.slice.call(row.querySelectorAll('.dsc-c')).forEach(function(c, i){ if (labels[i]){ var t = document.createElement('em'); t.className = 'dsm-dt'; t.textContent = labels[i]; c.insertBefore(t, c.firstChild); } });
          });
          head.remove();
        });
        box.querySelectorAll('[style*="zoom"]').forEach(function(n){ n.style.zoom = ''; });
        var title = document.createElement('div'); title.className = 'dsm-foot';
        title.textContent = '業績數據中心・' + new Date().toLocaleString('zh-TW', { hour12:false });
        box.appendChild(title);
        wrap.appendChild(box); document.body.appendChild(wrap);
        _syncToast('⏳ 產生手機版圖片中…', '#e6a817');
        setTimeout(function(){
          // ★ 10/10 Ivan：長圖在手機會被縮小 → 切成一張一張「一個手機螢幕高」，不切斷卡片，主管點開就是正常大小
          var MAXH = 860, bt = box.getBoundingClientRect().top, H = box.scrollHeight;
          var SEL = '.dsc-r, .dsb-row, .dsa-t, .dss-head, .dss-aw, .dsct-h, .dsct-c, .dsst-c, .dss-sec, .dss-total, .dss-hc, .dss-cd, .dsu-c, .dsw-mu, .dsw-r, .dss-pledge1, .dss-foot, .dss-report, .dsb-hd, .dsb-reg, .dsb-row, .dsa-rh, .dsa-t, .dsc-note, .dsc-l, .dsc-c, .dsc-g, .ds-card, .ds-sub, .gc-card, .gc-svg, .gc-legend, .ds-gate, .ds-mini, tr, .dsl-row, .dsm-foot';
          var atoms = Array.prototype.slice.call(box.querySelectorAll(SEL)).map(function(e){ var r = e.getBoundingClientRect(); return [r.top - bt, r.bottom - bt]; }).filter(function(a){ return a[1] - a[0] > 2 && a[1] - a[0] < MAXH; });
          var okCut = function(y){ return !atoms.some(function(a){ return a[0] < y - 1 && a[1] > y + 1; }); };
          var cands = atoms.map(function(a){ return Math.ceil(a[1]) + 3; }).filter(function(y, i, arr){ return arr.indexOf(y) === i; }).sort(function(a,b){ return a - b; });
          var pages = [], st0 = 0;
          while (st0 < H - 8){
            var lim = st0 + MAXH, end;
            if (lim >= H) end = H;
            else { var cs = cands.filter(function(y){ return y > st0 + 220 && y <= lim && okCut(y); }); end = cs.length ? cs[cs.length - 1] : lim; if (H - end < 160) end = H; }   // 最後剩一小段（例：只剩產生時間）就併進這張
            pages.push([st0, end]); st0 = end;
          }
          window.html2canvas(box, { scale:3, backgroundColor:'#FFFFFF', useCORS:true, logging:false, windowWidth:420 }).then(function(cv){
            wrap.remove();
            var tabName = ({ sum:(_dsSumView() === 'lead' ? '關卡總結_組長版' : '關卡總結_主管版'), race:'賽道排行', cal:'燈號月曆', arena:'三區擂台', lead:'組長戰力榜', tt:'穿越', road:'三關路線', day:'今日對戰', table:'明細' })[DS.tab] || DS.tab;
            var SC = cv.width / 420, FOOT = 26, N = pages.length;
            var files = pages.map(function(pg, i){
              var h = Math.round((pg[1] - pg[0]) * SC), c = document.createElement('canvas');
              c.width = cv.width; c.height = h + Math.round(FOOT * SC);
              var x = c.getContext('2d'); x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, c.width, c.height);
              x.drawImage(cv, 0, Math.round(pg[0] * SC), cv.width, h, 0, 0, cv.width, h);
              if (N > 1){ x.fillStyle = '#888780'; x.font = Math.round(12 * SC) + 'px sans-serif'; x.textAlign = 'right'; x.fillText((i + 1) + ' / ' + N + (i < N - 1 ? '　往下一張 →' : '　完'), c.width - Math.round(12 * SC), h + Math.round(18 * SC)); }
              return { name:'每日總結_' + tabName + '_手機版_' + (DS.date || '') + (N > 1 ? '_' + (i + 1) + '-' + N : '') + '.png', url:c.toDataURL('image/png') };
            });
            files.forEach(function(f, i){ setTimeout(function(){ var a = document.createElement('a'); a.download = f.name; a.href = f.url; document.body.appendChild(a); a.click(); a.remove(); }, i * 450); });
            _syncToast('📱 已下載 ' + N + ' 張手機版圖片（瀏覽器若問「允許下載多個檔案」請按允許）', '#4ade80');
          }).catch(function(e){ wrap.remove(); alert('產生圖片失敗：' + (e && e.message || e)); });
        }, 60);
      };
      if (window.html2canvas) return go();
      var sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      sc.onload = go; sc.onerror = function(){ alert('載入截圖工具失敗，請確認有連網路'); }; document.head.appendChild(sc);
    }
function dsDownload(fmt){
      var el = document.querySelector('#ppEvBg .dsb'); if (!el){ alert('先打開一張看板'); return; }
      var go = function(){
        var z = el.style.zoom; el.style.zoom = '';
        var sc = el.querySelector('.dsc'), ov = sc ? sc.style.overflow : ''; if (sc) sc.style.overflow = 'visible';
        _syncToast('⏳ 產生高清圖中…', '#e6a817');
        window.html2canvas(el, { scale:3, backgroundColor:(el.getAttribute('data-bg') || '#ffffff'), useCORS:true, logging:false,
          ignoreElements:function(n){ return n.classList && (n.classList.contains('ds-x') || n.classList.contains('ds-lchips') || n.classList.contains('dss-vt')); } }).then(function(cv){
          el.style.zoom = z; if (sc) sc.style.overflow = ov;
          var name = '每日總結_' + ({ sum:(_dsSumView() === 'lead' ? '關卡總結_組長版' : '關卡總結_主管版'), race:'賽道排行', cal:'燈號月曆', arena:'三區擂台', lead:'組長戰力榜', tt:({ boss:'穿越_主管版', lead:'穿越_組長版', sales:'穿越_業務版' })[_ttView()] })[DS.tab || 'cal'] + ((DS.tab === 'lead' || DS.tab === 'tt') && _dsLeadOrg() !== 'ALL' ? '_' + _dsLeadOrg() : '') + '_' + (DS.date || '') + (fmt === 'jpg' ? '.jpg' : '.png');
          var a = document.createElement('a'); a.download = name;
          a.href = cv.toDataURL(fmt === 'jpg' ? 'image/jpeg' : 'image/png', 0.95);
          document.body.appendChild(a); a.click(); a.remove();
          _syncToast('⬇️ 已下載 ' + name, '#4ade80');
        }).catch(function(e){ el.style.zoom = z; if (sc) sc.style.overflow = ov; alert('產生圖片失敗：' + (e && e.message || e)); });
      };
      if (window.html2canvas) return go();
      var s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      s.onload = go; s.onerror = function(){ alert('載入截圖工具失敗，請確認有連網路'); }; document.head.appendChild(s);
    }
function dsCopy(kind){
      var ym = DS.demo ? '2026-10' : _ppLiveYm(); var S = _dsSnaps(ym); if (!Object.keys(S).length){ alert('還沒有快照'); return; }
      var M = _dsModel(ym, DS.date), L = [], gl = M.G[M.gi], left = gl[1] - M.day, gn = '第' + '一二三'[M.gi] + '關';
      // ⏱ 穿越（2026/10/05）：每一家、每一組在原本的文字後面多一行
      var _TTm = null; try { _TTm = _ttModel(M); } catch(eT){}
      var ttl = function(org){ var t = _TTm ? _ttCopyLine(org, _TTm.org[org]) : ''; if (t) L.push(t); };
      var ttg = function(org, gname){ var I = _TTm && _TTm.grp[org + '|' + gname]; if (I) L.push(_ttCopyLine(_trkAlias(gname), I)); };
      if (kind === 'morn'){
        var tdy = new Date(Date.parse(M.date) + 86400000), tD = tdy.getDate(), tM = tdy.getMonth() + 1;
        var gLeft = gl[1] - tD; var gnm = gn;
        if (tD > gl[1]){ L.push('（今天是新的一關，明天的數字收工後再看）'); }
        var blk = function(p){ var n = Math.max(0, Math.min(10, Math.round(p * 10))); if (p >= 0.05 && !n) n = 1; var t = ''; for (var i = 0; i < 10; i++) t += i < n ? '🟥' : '⬜'; return t; };
        var holToday = function(r){ return _dsIsHol(M.ym, r.org, _dsDate(M.ym, tD)); };
        var firstWork = function(r){ for (var d = tD; d <= gl[1]; d++) if (!_dsIsHol(M.ym, r.org, _dsDate(M.ym, d))) return d; return 0; };
        L.push('☀️ ' + tM + '/' + tD + ' 今日挑戰｜' + gnm + (gLeft > 0 ? '倒數 ' + (gLeft + 1) + ' 天' : '今天結算'));
        var pc = function(r){ return r.gateT ? r.cum / r.gateT : 0; };
        var green = M.rows.filter(function(r){ return r.exp && r.cum >= r.exp; }).sort(function(a,b){ return pc(b) - pc(a); });
        var hol = M.rows.filter(function(r){ return green.indexOf(r) < 0 && holToday(r); });
        var chal = M.rows.filter(function(r){ return green.indexOf(r) < 0 && hol.indexOf(r) < 0; }).sort(function(a,b){ return pc(b) - pc(a); });
        if (green.length){
          L.push('');
          green.forEach(function(r){
            var fw = firstWork(r);
            L.push(r.org + '｜🎉' + (green.length === 1 ? '七家唯一' : '') + '綠燈 ' + Math.round(pc(r) * 100) + '%');
            L.push(gnm + ' ' + blk(pc(r)));
            L.push(holToday(r) ? (fw ? tM + '/' + fw + ' 起每天 ' + _dsW1(r.need) + ' 萬' : '這關休假結束') : '今天入帳 ' + _dsW1(r.need) + ' 萬，繼續領先');
            ttl(r.org);
          });
        }
        if (chal.length){
          L.push('');
          chal.forEach(function(r, i){
            if (i) L.push('');
            L.push(r.org + '｜🎯今天入帳 ' + _dsW1(r.need) + ' 萬');
            L.push(gnm + ' ' + blk(pc(r)) + ' ' + Math.round(pc(r) * 100) + '%');
            L.push(_dsW1(r.gateT) + ' 萬還差 ' + _dsW1(r.gateT - r.cum) + ' ＝ 每天 ' + _dsW1(r.need) + ' × ' + r.left + ' 天');
            ttl(r.org);
          });
        }
        if (hol.length){
          L.push('');
          hol.forEach(function(r, i){ if (i) L.push(''); var fw = firstWork(r); L.push(r.org + '｜🏖 休假中' + (fw ? '，' + tM + '/' + fw + ' 開打，每天 ' + _dsW1(r.need) + ' 萬' : '')); L.push(gnm + ' ' + blk(pc(r))); ttl(r.org); });
        }
        L.push('', '13:40 回報：今天這一筆從哪裡來、誰收');
      } else if (kind === 'boss'){
        var tune = ['數字是歷史、行動是未來','小目標小贏，步步為贏','今天的入帳，就是明天的底氣','承諾不是說出口，是做到'];
        L.push(tune[M.day % tune.length], '');
        L.push((+M.date.slice(5,7)) + '/' + M.day + ' ' + (left ? gn + '倒數 ' + left + ' 天' : gn + '結算'));
        var win = M.rows.filter(function(r){ return r.res === 'win'; }).sort(function(a,b){ return b.got.biz - a.got.biz; });
        var lose = M.rows.filter(function(r){ return r.res === 'lose'; }).sort(function(a,b){ return (a.got.biz - a.cm.biz) - (b.got.biz - b.cm.biz); });
        var hol = M.rows.filter(function(r){ return r.res === 'hol'; });
        if (win.length){ L.push('', '賀🎉'); win.forEach(function(r, i){ var ht = _dsHit(M, r); L.push((i === 0 ? '🏆' : '') + r.org + ' 承諾' + _dsW(r.cm.biz) + ' 入帳' + _dsW(r.got.biz) + (r.streak > 1 ? ' 連贏' + r.streak + '天' : '') + (r.lamp === '✔+' ? ' ✔+' : '') + (ht.n ? ' 本關達成' + ht.w + '/' + ht.n : '')); }); }
        if (lose.length){
          L.push('', '📌今日未達');
          lose.forEach(function(r){ L.push(r.org + ' 承諾' + _dsW(r.cm.biz) + ' 入帳' + _dsW(r.got.biz) + ' 差' + _dsW(r.cm.biz - r.got.biz) + (r.streak > 1 ? ' 連輸' + r.streak + '天' : '')); });
          L.push('明天 13:40 日會，今天沒入帳的業務到場', '四項回報：明天報到目標幾筆、撥打目標幾通、十份面談表檢視、聽錄音發現的問題');
        }
        M.rows.filter(function(r){ return r.isGateDay && r.lamp === 'X'; }).forEach(function(r){ L.push('', '📌' + r.org + ' ' + _dsAction(M, r)); });
        M.rows.filter(function(r){ return r.refundRate > 0.10; }).forEach(function(r){ L.push('', '📌' + r.org + '退費率' + Math.round(r.refundRate * 100) + '%，超過10%紅線', '這個數字你有什麼反應？'); });
        if (hol.length) L.push('', '🏖 ' + hol.map(function(r){ return CK_SHORT[r.org]; }).join('、') + ' 休假中，今天不比');
        L.push('', '🎯' + gn + '進度');
        M.rows.slice().sort(function(a,b){ return b.cum / (b.gateT || 1) - a.cum / (a.gateT || 1); }).forEach(function(r){
          L.push(CK_SHORT[r.org] + ' ' + _dsW(r.cum) + ' ' + (r.lamp || '') + (r.gateT > r.cum ? ' 差' + _dsW(r.gateT - r.cum) + (r.left ? ' 每天' + _dsW(r.need) : '') : ' 已過關'));
          ttl(r.org);
        });
        L.push('', '明天承諾多少？今晚回報');
      } else if (_dsLeaders(M)){
        var LD = _dsLeaders(M);
        M.rows.forEach(function(r){
          var gs = LD[r.org] || []; if (!gs.length) return;
          L.push(r.org + '｜' + (+M.date.slice(5,7)) + '/' + M.day + ' ' + ({ win:'贏', lose:'輸', hol:'休假中', na:'' })[r.res]);
          ttl(r.org);
          if (r.res === 'hol'){ L.push('今天不比，回來後每天要' + _dsW(r.need), ''); return; }
          var best = gs.filter(function(x){ return !x.red.length; })[0];
          if (best) L.push('🎉' + best.g.groupName + ' ' + _dsW(best.g.total) + (best.promote ? '，儲備組追上正式組' : ''));
          gs.forEach(function(x){
            if (!x.red.length && !x.yellow.length) return;
            L.push('', '📌' + _trkAlias(x.g.groupName));
            L.push('組長' + x.L.name + '本人' + _dsW(x.L.value) + '，今日應到' + _dsW(x.LN));
            if (x.red.some(function(t){ return t.indexOf('最低') >= 0; })) L.push('組長是組裡最低，明天先寫本關本人要做多少交給主管');
            x.zero.slice(0, 3).forEach(function(z, i){ L.push(z.name + '目前' + _dsW(z.value) + '（應到' + _dsW(z.need) + '），明天組長陪他做一件事：' + ['一對一','陪面談一場','換人面談，看別人怎麼收'][i % 3]); });
            x.yellow.forEach(function(t){ L.push(t); });
            ttg(r.org, x.g.groupName || '');
          });
          if (r.res === 'lose' || gs.some(function(x){ return x.red.length; })) L.push('', '📌今晚交五天承諾單給組長，組長明早交給主管');
          L.push('');
        });
        L.push('小目標小贏，步步為贏');
      } else {
        var pS = M.prevKey ? M.S[M.prevKey].p : {}, cS = M.S[M.date].p;
        M.rows.forEach(function(r){
          L.push(r.org + '｜' + (+M.date.slice(5,7)) + '/' + M.day + ' ' + ({ win:'贏', lose:'輸', hol:'休假中', na:'' })[r.res]);
          ttl(r.org);
          if (r.res === 'hol'){ L.push('今天不比，回來後每天要' + _dsW(r.need), ''); return; }
          var grp = {};
          Object.keys(cS).forEach(function(k){ if (k.indexOf(r.org + '|') !== 0) return; var nm = k.split('|')[1], v = cS[k][0], dpt = cS[k][1] || '未分組', d = v - ((pS[k] || [0])[0]); var g = grp[dpt] || (grp[dpt] = { t:0, d:0, zero:[] }); g.t += v; g.d += d; if (d <= 0) g.zero.push(nm); });
          Object.keys(grp).sort().forEach(function(dp){ var g = grp[dp]; if (!/組/.test(dp)) return; L.push((g.d > 0 ? '🎉' : '📌') + dp + ' 今天+' + _dsW(g.d) + ' 累計' + _dsW(g.t)); if (g.zero.length && g.zero.length <= 6) L.push('　今天沒入帳：' + g.zero.join('、')); });
          if (r.res === 'lose') L.push('📌今晚交明天承諾給組長，組長明早交給主管');
          L.push('');
        });
        L.push('小目標小贏，步步為贏');
      }
      var txt = L.join('\n').replace(/ 萬/g, '萬');
      try { navigator.clipboard.writeText(txt).then(function(){ _syncToast('📋 已複製' + ({ boss:'收工版', morn:'今日挑戰（早上版）', lead:'組長版' })[kind], '#4ade80'); }, function(){ prompt('複製這段：', txt); }); } catch(e){ prompt('複製這段：', txt); }
    }
function edDashOpen(){
      if (document.getElementById('edDashBg')) return;
      var bg = document.createElement('div');
      bg.id = 'edDashBg';
      bg.innerHTML = '<div class="edd-win"><div id="edDashBody"></div></div>';
      document.body.appendChild(bg);
      bg.addEventListener('click', function(e){ if (e.target === bg) edDashClose(); });
      document.addEventListener('keydown', _edDashEsc);
      document.body.style.overflow = 'hidden';
      edDashRender();
    }
function _edDashEsc(e){ if (e.key === 'Escape') edDashClose(); }
function edDashClose(){
      var bg = document.getElementById('edDashBg'); if (bg) bg.remove();
      document.removeEventListener('keydown', _edDashEsc);
      document.body.style.overflow = '';
      try { edRenderAll(); } catch(e){}
    }
function edDashTo(t){ edDashTab = t; edDashRender(); }
function edDashScopeTo(k){
      edDashScope = k;
      try { localStorage.setItem('ed_dash_scope', k); } catch(e){}
      edDashRender();
    }
function _eddScope(){
      if (edDashScope === 'all') return { label:'全省七家', orgs:CK_ORG_LIST, isOrg:false };
      if (CK_REGIONS[edDashScope]) return { label:CK_REGIONS[edDashScope].label, orgs:CK_REGIONS[edDashScope].orgs, isOrg:false };
      if (CK_ORG_LIST.indexOf(edDashScope) >= 0) return { label:edDashScope, orgs:[edDashScope], isOrg:true };
      return { label:'中區', orgs:CK_REGIONS.central.orgs, isOrg:false };
    }
function _eddPeople(M){
      var sc = _eddScope();
      return M.people.filter(function(p){ return sc.orgs.indexOf(p.org) >= 0 && p.mon >= ED_MIN; });
    }
function _eddBars(rows, opt){
      opt = opt || {};
      if (!rows.length) return '<div class="edd-none">沒有資料</div>';
      var max = Math.max.apply(null, rows.map(function(r){ return Math.abs(r.v) || 0; })) || 1;
      var x3 = !!opt.col3;   // ★ 10/07：多一欄（例：本月共幾筆）
      return '<div class="edd-bars' + (x3 ? ' x3' : '') + '">'
        + (x3 ? '<div class="edd-row edd-hdr"><div></div><div></div><div></div><div class="edd-v">' + _fnEsc(opt.col2 || '') + '</div><div class="edd-v3">' + _fnEsc(opt.col3) + '</div></div>' : '')
        + rows.map(function(r, i){
        var pct = Math.max(1.5, Math.abs(r.v) / max * 100);
        return '<div class="edd-row' + (r.cls ? ' ' + r.cls : '') + '"' + (r.tip ? ' data-pchelp="' + _fnEsc(r.tip) + '"' : '') + '>'
          + '<div class="edd-rk">' + (opt.noRank ? '' : (i + 1)) + '</div>'
          + '<div class="edd-nm">' + _fnEsc(r.name) + (r.sub ? '<small>' + _fnEsc(r.sub) + '</small>' : '') + '</div>'
          + '<div class="edd-track"><div class="edd-fill" style="width:' + pct.toFixed(1) + '%"></div></div>'
          + '<div class="edd-v">' + (r.label != null ? r.label : r.v) + (r.v2 ? '<small>' + _fnEsc(r.v2) + '</small>' : '') + '</div>'
          + (x3 ? '<div class="edd-v3">' + (r.v3 != null ? r.v3 : '') + '</div>' : '')
          + '</div>';
      }).join('') + '</div>';
    }
function _eddCols(cols){
      var max = Math.max.apply(null, cols.map(function(c){ return c.v || 0; })) || 1;
      return '<div class="edd-cols">' + cols.map(function(c){
        return '<div class="edd-col"' + (c.tip ? ' data-pchelp="' + _fnEsc(c.tip) + '"' : '') + '>'
          + '<div class="edd-colv">' + (c.label != null ? c.label : c.v) + '</div>'
          + '<div class="edd-colbar" style="height:' + Math.max(4, (c.v / max) * 100).toFixed(1) + '%' + (c.color ? ';background:' + c.color : '') + '"></div>'
          + '<div class="edd-colnm">' + _fnEsc(c.name) + (c.sub ? '<small class="' + (c.subCls || '') + '">' + _fnEsc(c.sub) + '</small>' : '') + '</div>'
          + '</div>';
      }).join('') + '</div>';
    }
function _eddWow(w){
      if (w == null) return { txt:'上週沒有資料可比', cls:'' };
      if (w > 0) return { txt:'比上週 +' + w + '%', cls:'up' };
      if (w < 0) return { txt:'比上週 ' + w + '%', cls:'down' };
      return { txt:'跟上週持平', cls:'' };
    }
function edDashRender(){
      var box = document.getElementById('edDashBody'); if (!box) return;
      var M = null;
      try { M = _edDashModel(); } catch(e){ box.innerHTML = '<div class="edd-none">算不出來：' + _fnEsc(e.message || e) + '</div>'; return; }
      if (!M){
        box.innerHTML = _eddHead(null) + '<div class="edd-none"><h3>還沒有編輯資料</h3>'
          + '<p>先關掉這個視窗，按那顆紫色按鈕把資料抓回來。</p></div>';
        return;
      }
      var html = _eddHead(M);
      if (edDashTab === 'day')   html += _eddDay(M);
      if (edDashTab === 'rank')  html += _eddRank(M);
      if (edDashTab === 'org')   html += _eddOrg(M);
      if (edDashTab === 'vs')    html += _eddVs(M);
      if (edDashTab === 'boost') html += _eddBoost(M);
      if (edDashTab === 'set')   html += _eddSet(M);
      box.innerHTML = html;
    }
function _eddHead(M){
      var days = M ? M.days.filter(function(d){ return d.slice(0,7) === M.ym; }) : [];
      var range = days.length ? (days[0].slice(5).replace('-','/') + '～' + days[days.length-1].slice(5).replace('-','/')) : '';
      var tabs = [['day','⚡ 昨日'],['rank','🏆 排名'],['org','🏫 各學院'],['vs','⚔️ 中區 vs 桃區'],['boost','🔥 激勵'],['set','⚙️ 誰要列入']];
      var scopes = [['all','全省']].concat(
        ['central','taoyuan','south'].map(function(k){ return [k, CK_REGIONS[k].label]; }),
        CK_ORG_LIST.map(function(g){ return [g, g]; })
      );
      return '<div class="edd-hd">'
        + '<div class="edd-t"><b>📊 編輯儀表板</b>'
        + (days.length ? '<span>已抓 ' + days.length + ' 天' + (range ? '（' + range + '）' : '') + '　·　只列編 ' + ED_MIN + ' 筆以上的人</span>' : '')
        + '</div>'
        + '<div class="edd-tabs">' + tabs.map(function(t){
            return '<button class="edd-tab' + (edDashTab === t[0] ? ' on' : '') + '" onclick="edDashTo(\'' + t[0] + '\')">' + t[1] + '</button>';
          }).join('') + '</div>'
        + '<button class="edd-x" onclick="edDashClose()" data-pchelp="關閉（Esc）">✕</button>'
        + (function(){
            // 「各學院」本來就是七家並排、「中區 vs 桃區」本來就是兩區對打，
            // 這兩頁不吃範圍。與其讓人按了沒反應，不如直接暗掉並講原因。
            var live = (edDashTab === 'rank' || edDashTab === 'boost' || edDashTab === 'day');
            return '<div class="edd-scope' + (live ? '' : ' off') + '">'
              + '<span class="edd-sclb">看哪裡</span>'
              + scopes.map(function(k){
                  return '<button class="edd-sc' + (edDashScope === k[0] ? ' on' : '') + '"'
                    + (live ? ' onclick="edDashScopeTo(\'' + _fnEsc(k[0]) + '\')"' : ' disabled')
                    + '>' + _fnEsc(k[1]) + '</button>';
                }).join('')
              + (live ? '' : '<span class="edd-scoff" data-pchelp="這一頁不吃範圍\n'
                  + (edDashTab === 'org' ? '「各學院」本來就是七家並排比較，選單一學院沒有意義。\n\n要只看一家，切到「🏆 排名」或「🔥 激勵」再選。'
                     : edDashTab === 'vs' ? '「中區 vs 桃區」本來就是兩個區在對打，範圍是固定的。\n\n要只看一家，切到「🏆 排名」或「🔥 激勵」再選。'
                     : '這一頁是設定頁，列的是全部的人。')
                  + '">這頁固定看全部</span>')
              + '</div>';
          })()
        + '</div>';
    }
function _eddDay(M){
      var sc = _eddScope();
      var day = M.lastDay || '';
      if (!day) return '<div class="edd-none">還沒有任何一天的資料</div>';
      var idx = M.days.indexOf(day);
      var prev = idx > 0 ? M.days[idx - 1] : '';
      var inScope = M.people.filter(function(p){ return sc.orgs.indexOf(p.org) >= 0; });

      var moved = [], quiet = [];
      inScope.forEach(function(p){
        var n = (p.days && p.days[day]) || 0;
        var pn = (prev && p.days && p.days[prev]) || 0;
        (n > 0 ? moved : quiet).push({ p:p, n:n, pn:pn, d:n - pn });
      });
      moved.sort(function(a,b){ return b.n - a.n; });
      quiet.sort(function(a,b){ return b.p.mon - a.p.mon; });

      var tot = moved.reduce(function(a,x){ return a + x.n; }, 0);
      // ★ 10/07 Ivan：要看當月總共編了幾筆 → 每人本月（已抓到的日子）加總
      var ymD = day.slice(0, 7), mDays = M.days.filter(function(k){ return k.slice(0, 7) === ymD; });
      var monOf = function(p){ var t = 0; mDays.forEach(function(k){ t += (p.days && p.days[k]) || 0; }); return t; };
      var monTot = inScope.reduce(function(a, p){ return a + monOf(p); }, 0);
      var md = (+day.slice(5, 7)) + '/' + (+day.slice(8));
      var lag = _edLagOf(edGetStore(), day);
      var lagTxt = lag == null ? '' : (lag <= 1 ? '（隔天抓的，完整）' : '（隔了 ' + lag + ' 天才抓，筆數偏低）');

      var rows = moved.map(function(x){
        var w = x.pn ? Math.round(x.d / x.pn * 100) : null;
        return { name:x.p.name, sub:(sc.isOrg ? '' : x.p.org) + (prev ? '　前一天 ' + x.pn : ''),
                 v:x.n, label:x.n,
                 v2: prev ? (x.d > 0 ? '+' + x.d : (x.d < 0 ? String(x.d) : '持平')) : '',
                 cls: x.d > 0 ? 'up' : (x.d < 0 ? 'down' : ''),   // ★ 10/07：台股色，比前一天多＝紅、少＝綠
                 v3: monOf(x.p),
                 tip:x.p.name + (sc.isOrg ? '' : '（' + x.p.org + '）') + '\n'
                     + day + ' 編了 ' + x.n + ' 筆'
                     + (prev ? '\n' + prev + ' 編了 ' + x.pn + ' 筆 → ' + (x.d >= 0 ? '多 ' + x.d : '少 ' + (-x.d)) + ' 筆' + (w == null ? '' : '（' + (w > 0 ? '+' : '') + w + '%）') : '')
                     + '\n\n本月（已抓 ' + mDays.length + ' 天）共 ' + monOf(x.p) + ' 筆。連續 ' + x.p.streak + ' 天有編輯。' };
      });

      return '<div class="edd-card edd-daycard"><h3><i class="edd-scb"></i>⚡ ' + _fnEsc(sc.label) + '　' + md + ' 每人編了幾筆名單'
        + '<span class="edd-tot">' + md + ' 共 ' + tot.toLocaleString() + ' 筆・' + moved.length + ' 人　｜　本月共 ' + monTot.toLocaleString() + ' 筆</span></h3>'
        + '<p class="edd-sub">每一筆＝一位學生，那天他改過、最後一手是他' + lagTxt + '。' + md + ' 那欄的小字＝比前一天多或少幾筆（紅＝多、綠＝少）；最右欄＝本月到 ' + md + ' 總共編了幾筆' + (mDays.length < (+day.slice(8)) ? '（本月只抓到 ' + mDays.length + ' 天，沒抓的日子不算）' : '') + '。</p>'
        + (rows.length ? _eddBars(rows, { col2: md, col3: '本月' }) : '<div class="edd-none">這一天沒有人編輯</div>')
        + '</div>'
        + '<div class="edd-card edd-quiet"><h3>😴 ' + day.replace(/-/g,'/') + ' 完全沒動的人'
        + '<span class="edd-tot">' + quiet.length + ' 位</span></h3>'
        + '<p class="edd-sub">這幾位在這段期間有編過東西，但這一天一筆都沒有。先問是不是休假或有事，再談。</p>'
        + (quiet.length
           ? '<div class="edd-qwrap">' + quiet.map(function(x){
               var gap = x.p.lastDay ? _edDiffDays(x.p.lastDay) : null;
               return '<span class="edd-q" data-pchelp="' + _fnEsc(x.p.name) + (sc.isOrg ? '' : '（' + _fnEsc(x.p.org) + '）') + '\n'
                 + day + ' 一筆都沒編。\n'
                 + (gap == null ? '' : '最後一次編輯是 ' + x.p.lastDay + '，' + gap + ' 天前。\n')
                 + '這段期間總共編了 ' + x.p.mon + ' 筆。\n\n'
                 + '休假、外出、跑展場都會落在這裡 —— 先問，不要直接當作沒做事。">'
                 + '<b>' + _fnEsc(x.p.name) + '</b><em>' + (sc.isOrg ? '' : x.p.org + '・') + '共 ' + x.p.mon + ' 筆</em></span>';
             }).join('') + '</div>'
           : '<div class="edd-none">每個人都有動，很好。</div>')
        + '</div>'
        + '<div class="edd-note">這一頁是給每天早上用的：先看誰有動，再看誰沒動，最後切到「🔥 激勵」看進步王跟連續天數，複製戰報貼群組。</div>';
    }
function _eddRank(M){
      var sc = _eddScope(), ppl = _eddPeople(M);
      var body = '';
      if (!ppl.length){
        body = '<div class="edd-none"><h3>' + _fnEsc(sc.label) + '沒有人編超過 ' + ED_MIN + ' 筆</h3>'
          + '<p>可能是資料還沒抓夠，也可能真的都沒在編。</p></div>';
      } else {
        var rows = ppl.slice().sort(function(a,b){ return b.mon - a.mon; }).map(function(p){
          var w = _eddWow(p.w7prev ? Math.round((p.w7 - p.w7prev) / p.w7prev * 100) : null);
          return { name:p.name, sub:(sc.isOrg ? '' : p.org), v:p.mon, label:p.mon,
                   v2: p.delta ? (p.delta > 0 ? '本週 +' + p.delta : '本週 ' + p.delta) : '',
                   cls: p.delta > 0 ? 'good' : (p.delta < 0 ? 'bad' : ''),
                   tip: p.name + (sc.isOrg ? '' : '（' + p.org + '）') + '\n編過 ' + p.mon + ' 筆名單。\n'
                        + '本週 ' + p.w7 + ' 筆、上週 ' + p.w7prev + ' 筆　' + w.txt + '\n'
                        + '連續 ' + p.streak + ' 天有編輯。\n最後一次編輯：' + (p.lastDay || '沒觀測到') };
        });
        var tot = ppl.reduce(function(a,p){ return a + p.mon; }, 0);
        body = '<div class="edd-card"><h3><i class="edd-scb"></i>' + _fnEsc(sc.label) + '・編了幾筆名單'
          + '<span class="edd-tot">' + tot.toLocaleString() + ' 筆　' + ppl.length + ' 人</span></h3>'
          + '<p class="edd-sub">條子右邊的小字是「本週比上週多／少幾筆」。綠色＝本週往上衝，紅色＝掉下來。</p>'
          + _eddBars(rows) + '</div>';
      }
      return body + (sc.isOrg ? _eddQuiet(M, sc) : '');
    }
function _eddQuiet(M, sc){
      var o = M.byOrg[sc.orgs[0]];
      if (!o) return '';
      var q = o.list.filter(function(w){ return w.mon < ED_MIN; })
        .sort(function(a,b){ return a.mon - b.mon; });
      if (!q.length) return '<div class="edd-card"><h3>🫥 這家幾乎沒在編的人</h3>'
        + '<p class="edd-sub">沒有人低於 ' + ED_MIN + ' 筆，全員都有在動。</p></div>';
      return '<div class="edd-card edd-quiet"><h3>🫥 這家幾乎沒在編的人　<span class="edd-tot">' + q.length + ' 位</span></h3>'
        + '<p class="edd-sub">這幾位低於 ' + ED_MIN + ' 筆，所以沒出現在上面的排名。開會前先看這一區。</p>'
        + '<div class="edd-qwrap">' + q.map(function(w){
            var gap = w.lastDay ? _edDiffDays(w.lastDay) : null;
            return '<span class="edd-q" data-pchelp="' + _fnEsc(w.ed) + '\n這段期間只編了 ' + w.mon + ' 筆。\n'
              + (gap == null ? '完全沒有觀測到他的編輯紀錄。' : '最後一次編輯是 ' + w.lastDay + '，' + gap + ' 天前。')
              + '\n\n先問是不是手上沒名單、還是卡在哪，不要直接當作沒做事。">'
              + '<b>' + _fnEsc(w.ed) + '</b><em>' + w.mon + ' 筆' + (gap == null ? '' : '・' + gap + ' 天前') + '</em></span>';
          }).join('') + '</div></div>';
    }
function _eddOrg(M){
      var rows = CK_ORG_LIST.map(function(g){
        var o = M.byOrg[g]; if (!o) return null;
        var act = o.list.filter(function(w){ return w.mon >= ED_MIN; });
        var sum = act.reduce(function(a, w){ return a + w.mon; }, 0);
        var w = _eddWow(o.w7prev ? Math.round((o.w7 - o.w7prev) / o.w7prev * 100) : null);
        return { name:g, sub:act.length + ' 人有在編' + (o.quiet.length ? '・' + o.quiet.length + ' 人幾乎沒動' : ''),
                 v:sum, label:sum.toLocaleString(), v2:w.txt,
                 cls: (w.cls === 'up' ? 'good' : (w.cls === 'down' ? 'bad' : '')),
                 tip: g + '\n' + sum.toLocaleString() + ' 筆（只算編 ' + ED_MIN + ' 筆以上的 ' + act.length + ' 位）\n'
                      + '本週 ' + o.w7 + ' 筆、上週 ' + o.w7prev + ' 筆　' + w.txt
                      + (o.quiet.length ? '\n\n另有 ' + o.quiet.length + ' 位幾乎沒動：' + o.quiet.join('、') : '') };
      }).filter(Boolean).sort(function(a,b){ return b.v - a.v; });
      return '<div class="edd-card"><h3>七家學院・編了幾筆名單</h3>'
        + '<p class="edd-sub">只算編 ' + ED_MIN + ' 筆以上的人。條子右邊是跟上週比。上面的「看哪裡」點學院名稱可以只看那一家。</p>'
        + _eddBars(rows) + '</div>';
    }
function _eddVs(M){
      function sumOf(R){
        var s = 0, w7 = 0, w7p = 0;
        R.orgs.forEach(function(g){
          var o = M.byOrg[g]; if (!o) return;
          o.list.forEach(function(w){ if (w.mon >= ED_MIN){ s += w.mon; w7 += (w.w7||0); w7p += (w.w7prev||0); } });
        });
        return { sum:s, w7:w7, w7prev:w7p, wow: w7p ? Math.round((w7 - w7p) / w7p * 100) : null };
      }
      var C = sumOf(CK_REGIONS.central), T = sumOf(CK_REGIONS.taoyuan);
      function col(R, d, color){
        var w = _eddWow(d.wow);
        return { name:R.label, sub:w.txt, subCls:w.cls, v:d.sum, label:d.sum.toLocaleString(), color:color,
                 tip:R.label + '　' + d.sum.toLocaleString() + ' 筆\n' + R.orgs.join('、')
                     + '\n\n本週 ' + d.w7.toLocaleString() + ' 筆、上週 ' + d.w7prev.toLocaleString() + ' 筆 → ' + w.txt
                     + '\n\n只算編 ' + ED_MIN + ' 筆以上的人。' };
      }
      var diff = C.sum - T.sum, lead = diff > 0 ? '中區' : (diff < 0 ? '桃區' : '');
      var lo = Math.min(C.sum, T.sum);
      var pct = lo ? Math.round(Math.abs(diff) / lo * 100) : 0;
      var side = function(R){
        var ppl = M.people.filter(function(p){ return R.orgs.indexOf(p.org) >= 0 && p.mon >= ED_MIN; })
          .sort(function(a,b){ return b.mon - a.mon; }).slice(0, 10)
          .map(function(p){ return { name:p.name, sub:p.org, v:p.mon, label:p.mon }; });
        return '<div class="edd-card"><h3>' + R.label + ' 前 10 名</h3>' + _eddBars(ppl) + '</div>';
      };
      return '<div class="edd-card"><h3>中區 vs 桃區・總共編了幾筆</h3>'
        + '<p class="edd-sub">比總數。條子下面是跟上週比 —— 總數看規模，週增減看動能。</p>'
        + _eddCols([col(CK_REGIONS.central, C, '#5b5bd6'), col(CK_REGIONS.taoyuan, T, '#e0562a')])
        + (lead ? '<div class="edd-gap2"><b>' + lead + '多 ' + Math.abs(diff).toLocaleString() + ' 筆</b>'
                  + (pct ? '　領先 ' + pct + '%' : '') + '</div>' : '')
        + '</div>'
        + '<div class="edd-2up">' + side(CK_REGIONS.central) + side(CK_REGIONS.taoyuan) + '</div>'
        + '<div class="edd-note">南區只有一家，用區域比不對等，所以沒放進來。要看南區就在上面的「看哪裡」選<b>南區</b>或<b>高雄建國</b>。</div>';
    }
function _eddBoost(M){
      var sc = _eddScope(), ppl = _eddPeople(M);
      var up = ppl.filter(function(p){ return p.delta > 0; }).sort(function(a,b){ return b.delta - a.delta; }).slice(0, 5)
        .map(function(p){ return { name:p.name, sub:(sc.isOrg ? '' : p.org + '　') + '上週 ' + p.w7prev + ' → 本週 ' + p.w7, v:p.delta, label:'+' + p.delta, cls:'good',
          tip:p.name + ' 本週多編了 ' + p.delta + ' 筆\n上週 ' + p.w7prev + ' 筆 → 本週 ' + p.w7 + ' 筆。\n\n進步幅度跟排名無關 —— 排最後的人也可以是進步王。' }; });
      var st = ppl.filter(function(p){ return p.streak > 0; }).sort(function(a,b){ return b.streak - a.streak; }).slice(0, 10)
        .map(function(p){ return { name:p.name, sub:(sc.isOrg ? '' : p.org), v:p.streak, label:p.streak + ' 天', cls: p.streak >= 5 ? 'good' : '',
          tip:p.name + ' 連續 ' + p.streak + ' 天都有編輯\n從最後一個抓到的日子往回數，中間沒有斷過。\n\n只算有抓到的日子，沒抓的日子不列入。' }; });
      var down = ppl.filter(function(p){ return p.delta < 0; }).sort(function(a,b){ return a.delta - b.delta; }).slice(0, 5)
        .map(function(p){ return { name:p.name, sub:(sc.isOrg ? '' : p.org + '　') + '上週 ' + p.w7prev + ' → 本週 ' + p.w7, v:-p.delta, label:String(p.delta), cls:'bad',
          tip:p.name + ' 本週少了 ' + (-p.delta) + ' 筆\n上週 ' + p.w7prev + ' 筆 → 本週 ' + p.w7 + ' 筆。\n\n先問發生什麼事：請假？名單分完了？還是卡住了？' }; });
      var tk = Object.keys(M.teams).sort();
      var pk = tk.length
        ? _eddCols(tk.map(function(k){ var t = M.teams[k];
            return { name:t.team + ' 組', sub:t.n + ' 人', v:t.sum, label:t.sum.toLocaleString(),
                     tip:t.team + ' 組\n' + t.n + ' 人：' + t.names.join('、') + '\n共 ' + t.sum.toLocaleString() + ' 筆，平均每人 ' + t.avg + ' 筆。' }; }))
        : '<div class="edd-none">還沒設定組別。到「⚙️ 誰要列入」那一頁，每個人選 A／B／C／D 就會出現。</div>';
      return '<div class="edd-2up">'
        + '<div class="edd-card"><h3><i class="edd-scb"></i>🚀 ' + _fnEsc(sc.label) + '・本週進步王</h3><p class="edd-sub">跟上週比多編了多少。排名墊底的人也拿得到。</p>'
        + (up.length ? _eddBars(up) : '<div class="edd-none">還沒有兩週的資料可以比。再抓幾天就會出現。</div>') + '</div>'
        + '<div class="edd-card"><h3>🔥 連續天數</h3><p class="edd-sub">連續幾天都有動。斷掉就歸零。</p>'
        + (st.length ? _eddBars(st) : '<div class="edd-none">沒有資料</div>') + '</div>'
        + '</div>'
        + '<div class="edd-2up">'
        + '<div class="edd-card"><h3>📉 本週掉最多</h3><p class="edd-sub">不是拿來罵的 —— 先問發生什麼事。</p>'
        + (down.length ? _eddBars(down, { noRank:true }) : '<div class="edd-none">沒有人比上週掉，很好。</div>') + '</div>'
        + '<div class="edd-card"><h3>⚔️ 組 vs 組</h3><p class="edd-sub">比總數。組別在「⚙️ 誰要列入」設定。</p>' + pk + '</div>'
        + '</div>'
        + '<div class="edd-card edd-share"><h3>📋 戰報</h3>'
        + '<p class="edd-sub">按一下複製，直接貼進 LINE 群組。內容跟著上面選的範圍走。</p>'
        + '<pre id="eddReport">' + _fnEsc(_eddReportText(M)) + '</pre>'
        + '<button class="fn-tb-btn go" onclick="eddCopy(this)">📋 複製戰報</button></div>';
    }
function _eddReportText(M){
      var sc = _eddScope(), ppl = _eddPeople(M);
      var days = M.days.filter(function(d){ return d.slice(0,7) === M.ym; });
      var L = [];
      L.push('📊 ' + sc.label + '　編輯戰報　' + (M.lastDay || '').replace(/-/g,'/') + '（已抓 ' + days.length + ' 天）');
      L.push('');
      var tot = ppl.reduce(function(a,p){ return a + p.mon; }, 0);
      L.push('總共 ' + tot.toLocaleString() + ' 筆　' + ppl.length + ' 人');
      L.push('');
      var top = ppl.slice().sort(function(a,b){ return b.mon - a.mon; }).slice(0, 5);
      if (top.length){
        L.push('🏆 編輯量前五');
        top.forEach(function(p, i){ L.push('　' + (i+1) + '. ' + p.name + (sc.isOrg ? '' : '（' + p.org + '）') + ' ' + p.mon + ' 筆'); });
        L.push('');
      }
      var up = ppl.filter(function(p){ return p.delta > 0; }).sort(function(a,b){ return b.delta - a.delta; }).slice(0, 3);
      if (up.length){
        L.push('🚀 本週進步王');
        up.forEach(function(p){ L.push('　' + p.name + '　上週 ' + p.w7prev + ' → 本週 ' + p.w7 + '（+' + p.delta + '）'); });
        L.push('');
      }
      var st = ppl.filter(function(p){ return p.streak >= 3; }).sort(function(a,b){ return b.streak - a.streak; }).slice(0, 5);
      if (st.length){
        L.push('🔥 連續天數');
        st.forEach(function(p){ L.push('　' + p.name + '　連續 ' + p.streak + ' 天'); });
        L.push('');
      }
      var tk = Object.keys(M.teams).sort();
      if (tk.length){
        L.push('⚔️ 組別總數');
        tk.forEach(function(k){ L.push('　' + k + ' 組　' + M.teams[k].sum.toLocaleString() + ' 筆（' + M.teams[k].n + ' 人）'); });
        L.push('');
      }
      if (sc.isOrg){
        var o = M.byOrg[sc.orgs[0]];
        if (o && o.quiet.length){ L.push('🫥 幾乎沒在編（低於 ' + ED_MIN + ' 筆）'); L.push('　' + o.quiet.join('、')); L.push(''); }
      }
      L.push('※ 只列編 ' + ED_MIN + ' 筆以上的人');
      return L.join('\n');
    }
function eddCopy(btn){
      var t = document.getElementById('eddReport'); if (!t) return;
      var s = t.textContent, o = btn.textContent;
      var done = function(){ btn.textContent = '✅ 複製好了'; setTimeout(function(){ btn.textContent = o; }, 1800); };
      try { navigator.clipboard.writeText(s).then(done, function(){ window.prompt('複製這段：', s); }); }
      catch(e){ window.prompt('複製這段：', s); }
    }
function _eddSet(M){
      var rows = M.allPeople.map(function(p){
        return '<tr class="' + (p.hidden ? 'off' : '') + '">'
          + '<td><label class="edd-ck" data-pchelp="' + (p.hidden ? '目前沒有列入' : '目前有列入') + '\n'
            + '拿掉勾 ＝ ' + _fnEsc(p.name) + ' 從<b>全公司七家</b>的排名、合計、中位數一起移除。\n'
            + '客服、行政、批次帳號都該拿掉。\n\n設定會同步給同事。">'
            + '<input type="checkbox" ' + (p.hidden ? '' : 'checked') + ' onchange="edToggleStaff(\'' + _fnEsc(p.org) + '\',\'' + _fnEsc(p.name) + '\')"><span></span></label></td>'
          + '<td class="nm">' + _fnEsc(p.name) + '</td>'
          + '<td class="dim">' + _fnEsc(p.orgs.length > 1 ? p.orgs.length + ' 家' : p.org) + '</td>'
          + '<td class="num" data-pchelp="' + _fnEsc(p.name) + ' 七家合計 ' + p.mon + ' 筆\n'
            + _fnEsc(p.orgs.length ? p.orgs.join('\n') : '這段期間沒有編輯紀錄') + '">'
            + p.mon + (p.mon < ED_MIN ? '<small>不進排名</small>' : '') + '</td>'
          + '<td>' + ED_TEAMS.map(function(t){
              return '<button class="edd-tm' + (p.team === t ? ' on' : '') + '" onclick="edSetTeam(\'' + _fnEsc(p.org) + '\',\'' + _fnEsc(p.name) + '\',\'' + (p.team === t ? '' : t) + '\')">' + t + '</button>';
            }).join('') + '</td>'
          + '</tr>';
      }).join('');
      return '<div class="edd-card"><h3>⚙️ 誰要列入排名</h3>'
        + '<p class="edd-sub">把勾拿掉，那個人就完全不進儀表板、不進排名、也不影響中位數。'
        + '客服、行政、用批次處理的人都該拿掉 —— 他們的數字不是「跑名單」，留著會把所有比較拉歪。<br>'
        + '另外，編不到 ' + ED_MIN + ' 筆的人本來就不會進排名（只有在「看哪裡」選單一學院時，會另外列成「幾乎沒在編的人」）。<br>'
        + '右邊選 A／B／C／D 就會出現在「組 vs 組」。設定會同步給同事。</p>'
        + '<table class="edd-set"><thead><tr><th>列入</th><th>姓名</th><th>學院</th><th>筆數</th><th>組別</th></tr></thead>'
        + '<tbody>' + rows + '</tbody></table></div>';
    }
function fnTeach(ym, org, keepPick){
      if (!keepPick) _tvPick = { g:'', o:'' };      // 每次重開都從全院起算
      // ★ 第二夜：同事（非管理者）在自己學院開「👤 看業務個人」→ 直接選到自己，不用再點組、點人
      if (!keepPick && !_pcIsAdmin()){
        try { var _me = _fnMe(), _mo = _pcMyOrg(); if (_me && _mo && org === _mo){ var _g = _fnGroupOf(_me, _mo, ym); _tvPick = { g:_g || '', o:_me }; } } catch(e){}
      }
      _tvYm = ym; _tvOrgArg = org; _tvOrg = (org === '__TOTAL__') ? '' : org;
      var orgs = _fnScopeOrgs();
      var d = _fnDataFor(ym);
      var all = CK_ORG_LIST.map(function(o){ return _fnOrgStats(d, o, ym); });
      var s = (org === '__TOTAL__') ? _fnSum(orgs.map(function(o){ return _fnOrgStats(d, o, ym); }), _fnScopeLabel()) : _fnOrgStats(d, org, ym);
      // 合計視窗底下只有一家學院有逐人資料（例：南區＝高雄建國）→ 這個視窗就等於那家，一樣給選擇器
      var _wOrg = (org === '__TOTAL__') ? '' : org;
      if (org === '__TOTAL__'){
        var _ws = orgs.map(function(o){ return _fnOrgStats(d, o, ym); }).filter(function(x){ return x.auto; });
        if (_ws.length === 1){ _wOrg = _ws[0].org; _tvOrg = _wOrg; s.auto = _ws[0].auto; }
      }
      var _scope = _fnTeachScope(s, _wOrg, ym); s = _scope.s;
      var a = s.auto, y = parseInt(ym.slice(0,4),10), m = parseInt(ym.slice(5),10);
      var withData = all.filter(function(x){ return x.hasData; });
      var rank = function(key){ return withData.slice().sort(function(p,q){ return q[key]-p[key]; }).findIndex(function(x){ return x.org === s.org; }) + 1; };
      var avg = function(key, minKey, minV){ var l = withData.filter(function(x){ return !minKey || x[minKey] >= minV; }); return l.length ? l.reduce(function(t,x){ return t + x[key]; }, 0) / l.length : 0; };
      var isOrg = (org !== '__TOTAL__');

      // ── ① 上排數字 ──
      var top = '';
      top += _tvRow('註冊Ⓐ', s.regA, 'EIP 當月績效（原始值）', '這個月「新名單」註冊的人數，EIP 直接給的，我們沒有動它。<span style="color:var(--tvFaint);">（彙總值，沒有逐人明細；要看名字請看下面「當下」「試聽後註冊」）</span>');
      top += _tvRow('當下', s.onsite, a ? '逐人資料自動算' : '手填',
        (a ? 'Ⓐ 新名單 ・ 本月有面談 ・ 註冊金額 ≥ 2 萬 ・ 註冊日−面談日 ≤ 3 天。' : '目前這家還沒同步逐人資料，是手填的值。')
        + (a ? _tvNames('當下註冊（面談後 3 天內簽）', a.onsite, function(x){ return { pill: x.days + ' 天內', sub:'面談 ' + x.d + ' → 註冊 ' + x.r + (x.v ? '・' + _fnWan(x.v) : '') }; }) : ''));
      top += _tvRow('註冊Ⓑ', s.regB, 'EIP 當月績效（原始值）', '「舊名單」註冊人數。注意：EIP 的 Ⓑ 連舊生加購也算進去，所以通常比我們的「追回」大很多。<span style="color:var(--tvFaint);">（彙總值，沒有逐人明細；要看名字請看下面「追回」）</span>');
      if (s.harvest != null){
        var _mAgo = function(ymStr){
          if (!ymStr) return null;
          var yy = parseInt(ymStr.slice(0,4),10), mm = parseInt(ymStr.slice(5),10);
          return (y - yy) * 12 + (m - mm);
        };
        var hvList = '';
        if (a){
          var li1 = function(x){
            var ago = _mAgo(x.ym);
            return '<li><b>' + _fnEsc(x.n) + '</b>'
              + '<span class="tv-pill">' + (x.ym ? _fnMonthLabel(x.ym) + (ago ? '（' + ago + ' 個月前）' : '（本月）') : '—') + '</span>'
              + '<em>' + (x.oldList ? '名單建檔' : '面談') + '　→　' + (x.r || '—') + ' 註冊' + (x.v ? '・' + _fnWan(x.v) : '') + (x.trial ? '・有試聽' : '') + '</em></li>';
          };
          var li2 = function(x){
            return '<li><b>' + _fnEsc(x.n) + '</b><span class="tv-pill tv-pill-x">3 個月內無面談</span>'
              + '<em>' + (x.r || '—') + ' 註冊' + (x.v ? '・' + _fnWan(x.v) : '') + (x.trial ? '・曾繳報名費' : '') + '</em></li>';
          };
          // ★ 跟其他名單一致：依 組 → 業務 分層（合計卡沒有單一學院時自動退回平鋪）
          var g1 = _fnGroupedHtml(a.harvest, _tvOrg, _tvYm, li1) || (a.harvest.length ? '<ul class="tv-ul">' + a.harvest.map(li1).join('') + '</ul>' : '');
          var g2 = _fnGroupedHtml(a.harvestOld, _tvOrg, _tvYm, li2) || (a.harvestOld.length ? '<ul class="tv-ul">' + a.harvestOld.map(li2).join('') + '</ul>' : '');
          hvList = '<details class="tv-det"><summary><span class="tv-sum-tag">追回</span>'
            + '<span class="tv-sum-n">看這 ' + s.harvest + ' 位是誰・幾個月前的名單 ▸</span>' + _tvPeek(a.harvest.concat(a.harvestOld))
            + '</summary>'
            + '<div class="tv-det-b">'
            + '<div class="tv-g"><div class="tv-g-t">⑴ Ⓑ 舊名單（名單上個月以前建檔）本月註冊　<b>' + a.harvest.length + '</b> 位</div>'
            + (g1 || '<p class="tv-none">本月沒有</p>') + '</div>'
            + '<div class="tv-g"><div class="tv-g-t">⑵ 往回 3 個月查不到面談紀錄（更早的舊名單）　<b>' + a.harvestOld.length + '</b> 位</div>'
            + (g2 || '<p class="tv-none">本月沒有</p>') + '</div>'
            + '<p class="tv-note">⑴ 有標幾個月前 → 看得出是「上個月剛談的」還是「三個月前的老名單」，回追優先順序不一樣。⑵ 這批連 3 個月內都沒面談紀錄，等於更早期的名單自己回來簽，通常是舊生轉介或長期經營。</p>'
            + '</div></details>';
        }
        top += _tvRow('追回', s.harvest, '逐人資料自動算',
          '兩種都算：⑴ 名單在上個月以前就建檔（Ⓑ 舊名單），本月註冊 ≥ 2 萬；⑵ 本月註冊 ≥ 2 萬、但往回 3 個月查不到面談紀錄。'
          + (a ? '　這家：前者 <b>' + a.harvest.length + '</b> 位、後者 <b>' + a.harvestOld.length + '</b> 位。' : '')
          + hvList);
      }
      if (s.courses != null) top += _tvRow('科數', s.coursesNew + '<span style="color:var(--tvDim);font-size:.8125rem;">（含加購 ' + s.courses + '）</span>', '營業收支查詢',
        '本月每一筆「註冊」，業績合計 ≥ 2 萬就算 1 科。大字排除通路副類別「學員加購」（舊生加課），括號才是含加購的總科數。同一個人買兩門＝2 科。');
      if (s.heads != null) top += _tvRow('人頭', s.headsNew + '<span style="color:var(--tvDim);font-size:.8125rem;">（含加購 ' + s.heads + '）</span>', '營業收支查詢',
        '同一個姓名本月註冊金額「加總」≥ 2 萬＝1 個人頭（買幾門都只算 1 個人）。大字一樣排除舊生加購。'
        + (s.headsNew ? '　科數 ' + s.coursesNew + ' ÷ 人頭 ' + s.headsNew + ' ＝ 平均一人買 <b>' + (Math.round(s.coursesNew / s.headsNew * 10) / 10) + '</b> 科。' : ''));
      if (a && (a.trialReg.length || s.regUnmatched || (a.trialRegOld || []).length)) top += _tvRow('試聽後註冊', s.reg + (s.regOld || s.regUnmatched ? '<span style="color:var(--tvDim);font-size:.8125rem;">（當月 ' + (s.regCur||0) + (s.regOld ? '＋非當月 ' + s.regOld : '') + '）</span>' : ''), '註冊Ⓐ − 當下 ＋ 非當月',
        '<b>當月</b>＝註冊Ⓐ − 當下（EIP 為準）：本月面談、本月註冊、註冊日離面談超過 3 天（中間去試聽／回去考慮）。<b>非當月</b>＝前幾個月面談、備註或狀態歷史寫過試聽、本月才簽的人。試聽註冊率只用當月的算。'
        + _tvNames('試聽後註冊（當月）', a.trialReg, function(x){ return { pill: '隔 ' + x.days + ' 天', sub:'面談 ' + x.d + ' → 註冊 ' + x.r + (x.trial ? '・有試聽' : '・無試聽紀錄') + (x.v ? '・' + _fnWan(x.v) : '') }; })
        + (s.regUnmatched ? '<div class="tv-note">另有 <b>' + s.regUnmatched + '</b> 位：EIP 註冊Ⓐ 有算、但逐人資料對不到名字（多半是跨月入帳或 EIP 上的名字跟面談紀錄不一致）。數字以 EIP 為準，所以上面的大字有把他們算進去。</div>' : '')
        + _tvNames('試聽後註冊・非當月（前幾個月面談、備註寫過試聽、本月簽）', a.trialRegOld || [], function(x){ return { pill: x.ym ? _fnMonthLabel(x.ym) + ' 面談' : '3 個月內無面談', sub:(x.r || '—') + ' 註冊' + (x.v ? '・' + _fnWan(x.v) : '') + (x.trial ? '・有繳報名費' : '') + (x.noteTrial ? '・📝備註提到試聽' : '') }; }, 'x'));
      if (s.courses != null && a) top += _tvRow('科數明細', s.coursesNew, '營業收支查詢', '下面列出每一筆 ≥ 2 萬的註冊（新生），同一個人買兩門會出現兩次。'
        + _tvNames('新生科數（每筆 ≥ 2 萬）', a.courseList.filter(function(x){ return !x.add; }), function(x){ return { pill:_fnWan(x.v), sub:_fnEsc(x.k) + '・' + x.d }; }));
      if (s.heads != null && a) top += _tvRow('人頭明細', s.headsNew, '營業收支查詢', '同一人本月註冊加總 ≥ 2 萬（排除舊生加購）。'
        + _tvNames('新生人頭', a.headList.filter(function(h){ return h.vNew >= FN_COURSE_MIN; }), function(x){ return { pill:_fnWan(x.vNew), sub: x.cnt + ' 筆' + (x.v !== x.vNew ? '・含加購合計 ' + _fnWan(x.v) : '') }; }));
      if (s.newPerf) top += _tvRow('新業績', _fnWan(s.newPerf), 'EIP 當月績效', '各業務 new_perf 的加總，EIP 原始值。<span style="color:var(--tvFaint);">（EIP 只給金額總和，沒有逐人明細）</span>');
      if (a){
        var diff = s.autoDiff, mine = a.onsite.length + a.trialReg.length;
        top += '<div class="tv-row tv-hot"><div class="tv-lb">🤖 自動 ' + (diff ? 'Ⓐ' + (diff > 0 ? '+' : '') + diff : 'Ⓐ✓') + '</div>'
          + '<div class="tv-val">' + (diff ? (diff > 0 ? '+' : '') + diff : '✓') + '</div>'
          + '<div class="tv-from">對帳章</div>'
          + '<div class="tv-how">我用逐人資料算出的「當下 ' + a.onsite.length + ' ＋ 試聽後 ' + a.trialReg.length + ' ＝ <b>' + mine + '</b>」，跟 EIP 註冊Ⓐ <b>' + s.regA + '</b> 比對：'
          + (diff === 0 ? '<b style="color:var(--tvGood);">完全一致</b>。' : '差 <b>' + Math.abs(diff) + '</b> 位。差幾位很正常，多半是跨月入帳、月底解約、或同名/改名造成，<b>不影響其他數字</b>。')
          + '</div></div>';
      }

      // ── ② 四格漏斗 ──
      var flow = '';
      flow += _tvRow('總報到', s.checkin + _tvSh(s, 'checkin'), 'EIP 報到排名', '這個月「實際走進學院報到」的新名單人數。舊生、班務、線上談的都不算在這裡。<span style="color:var(--tvFaint);">（報到排名有每個業務的數字，但沒有學生名字，所以點不開名單）</span>');
      flow += _tvRow('實際面談', s.interview + _tvSh(s, 'interview'), 'EIP 當月績效', '這個月所有業務的面談數加總。<b>只要坐下來談過就算一次</b>，不管他是不是這個月報到的。'
        + (s.onsite ? '　其中 <b>' + s.onsite + '</b> 位當場就簽（當下註冊）。' : '')
        + (a ? '<span style="color:var(--tvFaint);">　EIP 的 ' + s.interview + ' 是彙總值；下面是面談紀錄總表裡「本月建檔」的 ' + a.itvList.length + ' 位逐人清單，兩者可能略有出入（同一人談兩次 EIP 算兩次）。</span>'
             + _tvNames('本月有面談紀錄的人', a.itvList, function(x){ return { pill:'面談 ' + x.d, sub:(x.sd ? '名單 ' + _fnMonthLabel(x.sd) + ' 建檔' : '名單日期空白') + (x.w ? '・想學 ' + _fnEsc(String(x.w).slice(0,14)) : '') }; }, '', 1) : ''));
      flow += _tvRow('安排試聽', s.trial + _tvSh(s, 'trial'), a ? '逐人資料 ＋ 記名報備' : '報名數 ＋ 額外報備',
        a ? '本月面談、有繳報名費的 <b>' + a.feeTrial + '</b> 位'
            + (a.noteTrial.length ? '，加上沒繳報名費、但追蹤情形（總表備註）寫了「試聽」的 <b>' + a.noteTrial.length + '</b> 位（📝 備註試聽：試聽日 ≥ 同步當天、或沒寫日期才算；日期在下個月也算）' : '')
            + (s.extra ? '，加上主管記名報備的 <b>' + s.extra + '</b> 位' : '') + '。'
            + (a.poolTrial.length ? '　另有 <b>' + a.poolTrial.length + '</b> 位是前 1～3 個月面談、備註排了未來試聽日 —— 另列，不算本月安排試聽。' : '')
            + (a.trialDue.length ? '　另有 <b style="color:var(--tvWarn);">' + a.trialDue.length + '</b> 位已經從這個數字扣掉了（排了沒來，看下一列）。' : '')
            + (a.scanN ? '　🔎 這家有 <b>' + a.scanN + '</b> 位做過「狀態歷史記錄」深挖（連更早的追蹤情形都看得到）；之後每次同步看到的新備註會自動累積，不用再挖一次。' : '')
            + _tvNames('有繳報名費＝安排試聽', a.trialList.filter(function(x){ return x.st !== '備註試聽'; }), function(x){ return { pill:x.st, sub:'面談 ' + x.d + (x.r ? ' → 註冊 ' + x.r : '') + (x.v ? '・' + _fnWan(x.v) : '') + (x.td ? '・備註試聽 ' + x.td : '') }; }, '', 1)
            + _tvNames('📝 追蹤情形寫了試聽（沒繳報名費）', a.noteTrial, function(x){ return { pill: x.td ? '試聽 ' + x.td + (x.cross ? '・跨月' : '') : '未寫日期', sub:'面談 ' + x.d + (x.src === 'hist' ? '・🔎深挖' : '') + '・「' + _fnEsc(x.tx) + '」' }; }, '', 1)
            + _tvNames('前 1～3 個月面談・已排未來試聽日（另列）', a.poolTrial, function(x){ return { pill:'試聽 ' + x.td + (x.cross ? '・跨月' : ''), sub:_fnMonthLabel(x.ym) + ' 面談・「' + _fnEsc(x.tx) + '」' }; }, 'x', 1)

            + ((s.reports && s.reports.length) ? _tvNames('記名報備試聽', s.reports.filter(function(x){ return !x.ext; }), function(x){ return { pill: x.st === 'reg' ? '已註冊' : (x.st === 'dup' ? '重複不計' : '計入試聽'), sub:(x.grp ? _fnEsc(x.grp) + '・' : '') + (x.course ? _fnEsc(x.course) : '') + (x.date ? '・試聽日 ' + _fnEsc(x.date) : '') }; }, 'x') : '')
            + (s.ext && s.ext.n ? '<div class="tv-note" style="margin:8px 0 2px;font-size:.86rem;line-height:1.55;">🏫 <b>外院試聽 ' + s.ext.n + ' 位</b>（已簽 ' + s.ext.reg + '・經營中 ' + s.ext.mgmt + '）＝別家學院談過、我們安排試聽或收單的名單，<b>不計入</b>上面的安排試聽和三個百分比。'
                + (s.ext.autoN ? '其中 ' + s.ext.autoN + ' 位是系統自動偵測：本月在本院有報名或註冊、三個月內本院沒面談紀錄、但在別家有面談紀錄。' : '') + (s.ext.manualN ? '另 ' + s.ext.manualN + ' 位是組長手動報備。' : '') + '註冊會掃七家收支，≥ 2 萬就自動 ✅ 並標簽在哪家。</div>'
                + _tvNames('外院試聽名單', s.ext.list, function(x){ return { pill: x.st === 'reg' ? '✅ ' + (x.regAt === s.org ? '本院' : x.regAt) + ' 註冊' : '經營中', sub:(x.src ? '原 ' + _fnEsc(x.src) + (x.o ? '・' + _fnEsc(x.o) : '') + (x.d ? '・' + x.d + ' 面談' : '') : '來源未填') + (x.v ? '・' + _fnWan(x.v) : '') + (x.manual ? '・🖐 ' + _fnEsc(x.by || '') : '・🤖 自動') }; }, 'x', 1) : '')
          : 'EIP 報名數 ' + s.signup + (s.extra ? ' ＋ 報備 ' + s.extra : '') + '。');
      // ★ 主標列：排了試聽沒來（很重要 → 跟其他四格同一層，不藏在說明裡）
      if (a){
        flow += _tvRow('<span style="color:var(--tvWarn);">⚠️ 排了試聽沒來</span>',
          '<span style="color:var(--tvWarn);">' + a.trialDue.length + '</span>',
          '逐人資料自動算',
          (a.trialDue.length
            ? '<b>約好了試聽日、日子過了人沒出現，也沒有再排新的、也還沒註冊。</b>這 <b>' + a.trialDue.length + '</b> 位<b style="color:var(--tvWarn);">已經從上面的「安排試聽」扣掉了</b>，不會灌水。<br>只要業務重新約，下次同步就會自動加回「安排試聽」、這裡同步減一 —— 所以這個數字就是<b>現在該打電話重約的人</b>。'
            : '目前沒有這種人：排過的試聽要嘛還沒到、要嘛人來了。<br>（判定：約定的試聽日已經過了 ＋ 沒有更新的試聽日 ＋ 還沒註冊。日子一過就自動掉進這裡，不用等同步。）')
          + _tvNames('📝 待查證試聽（沒有計入任何數字）', a.trialUnsure || [], function(x){ return { pill:'待查證', sub:'面談 ' + x.d + ' → 備註寫試聽 ' + (x.td || '（沒寫日期）') + '・這段是 ' + _fnWhen(x.seenAt) + ' 抓到的，EIP 現在的備註是「' + (x.cur ? _fnEsc(x.cur) : '（空白）') + '」' + '・原文「' + _fnEsc(x.tx) + '」' }; }, 'x', 1)
          + _tvNames('⚠️ 排了試聽沒來・現在該重約的人', a.trialDue, function(x){ return { pill:'排 ' + x.td + '・已過 ' + x.days + ' 天', sub:'面談 ' + x.d + (x.src === 'hist' ? '・🔎深挖' : '') + '・「' + _fnEsc(x.tx) + '」' }; }, 'x', 1));
      }
      flow += _tvRow('試聽後結果', (s.known ? s.reg + ' 註冊 ／ ' + s.mgmt + ' 經營中'
          + ((s.regOld || s.regUnmatched) ? '<div style="font-size:.8125rem;color:var(--tvDim);font-weight:600;margin-top:4px;">當月 ' + (s.regCur||0) + (s.regOld ? ' ＋ 非當月 ' + s.regOld : '') + (s.regUnmatched ? '・' + s.regUnmatched + ' 位對不到名字' : '') + '</div>' : '')
          + _tvSh(s, 'reg') : '待填當下'), a ? '逐人資料自動算' : '手填後自動算',
        (s.known ? '試聽的人裡面：<b>' + s.reg + '</b> 位已經簽了（試聽後註冊），<b>' + s.mgmt + '</b> 位還在追 —— 這 ' + s.mgmt + ' 位就是下個月的收割名單。'
                 : '這家還沒同步逐人資料，也還沒手填「當下註冊」，所以算不出來。')
        + (a ? _tvNames('經營中（本月試聽、還沒簽）→ 優先回追', a.mgmt, function(x){ return { pill:'已 ' + x.days + ' 天', sub:'面談 ' + x.d + _tvM(x) }; }, '', 1)
             + (a.pool.length ? '<div class="tv-note" style="margin:8px 0 2px;font-size:.86rem;line-height:1.55;">' + _fnPoolNote(a, ym) + '</div>' : '')
             + _tvNames('經營池（前 3 個月試聽、還沒簽）→ 下月收割', a.pool, function(x){ return { pill:_fnMonthLabel(x.ym) + '・已 ' + x.days + ' 天', sub:'面談 ' + x.d + _tvM(x) }; }, 'x', 1)
             + _tvNames('面談後流失（沒報名也沒註冊）', a.lost, function(x){ return { pill:'面談 ' + x.d, sub:(x.w ? '想學 ' + _fnEsc(String(x.w).slice(0,16)) : '無備註') }; }, 'x', 1) : ''));

      // ── ③ 判定規則 ──
      var rules = '<div class="tv-steps">'
        + '<div class="tv-step"><span class="tv-n">1</span><b>先看金額</b><p>本月註冊金額（業績合計）加總要 <b>≥ 2 萬</b> 才算註冊。只繳 100 元報名費、或只繳部分款 → 不算註冊，改列「經營中」並標註已繳多少，人不會不見。</p></div>'
        + '<div class="tv-step"><span class="tv-n">2</span><b>再看名單新舊</b><p>看面談表的「<b>通路建檔日期</b>」＝這個名單什麼時候進公司的。<br><span style="color:var(--tvGood);font-weight:700;">Ⓐ 新名單</span>＝本月建檔（或展場空白）→ 走「當下／試聽後」<br><span style="color:var(--tvWarn);font-weight:700;">Ⓑ 舊名單</span>＝上個月以前建檔 → 一律算「追回」，就算本月才面談也一樣。</p></div>'
        + '<div class="tv-step"><span class="tv-n">3</span><b>最後看天數</b><p>只對 Ⓐ 新名單判斷：<b>註冊日 − 面談日 ≤ 3 天</b> → 當下註冊（當場成交力）；<b>&gt; 3 天</b> → 試聽後註冊（追回來才簽，不管有沒有繳 100 元）。</p></div>'
        + '</div>';

      // ── ③-2 試聽怎麼被認出來（給主管的判讀手冊）──
      var kw = '<div class="tv-kw">'
        + '<div class="tv-kwrow"><b>① 這些寫法都算「有安排試聽」</b>'
        + '<div class="tv-chips2">' + ['試聽','視聽（打錯字也算）','試廳','體驗課','體驗班','單元課','單元班','放正課','上正課','正課'].map(function(t){ return '<span>' + t + '</span>'; }).join('') + '</div>'
        + '<p>業務在 EIP「追蹤情形」裡寫的字，只要出現上面任一個詞，再配上一個日期，就會被算成安排了試聽。</p></div>'
        + '<div class="tv-kwrow"><b>② 沒寫「試聽」兩個字也算：日期後面有「課」</b>'
        + '<div class="tv-eg"><span class="ok">✅ 9/25 Procreate課</span><span class="ok">✅ 10/3 電繪課</span><span class="ok">✅ 9/20 排平面課</span></div>'
        + '<p>日期後面 12 個字以內出現「課」就算。所以業務寫「幾月幾號的某某課」也抓得到，不用強迫他們改用詞。</p></div>'
        + '<div class="tv-kwrow"><b>③ 這些不算</b>'
        + '<div class="tv-eg"><span class="no">✘ 登9月ＩＰＡＤ一三課</span><span class="no">✘ 9/12 電話追蹤</span><span class="no">✘ 有興趣，之後再說</span></div>'
        + '<p>「9月」沒有日、沒有完整日期 → 不算（避免把課程名稱誤判成試聽）。只有日期沒有課或試聽字樣 → 也不算。</p></div>'
        + '<div class="tv-kwrow"><b>④ 日期一過，數字自己會掉</b>'
        + '<p><b>約的日子過了、人沒來、也沒再排新的 → 自動從「安排試聽」扣掉</b>，改列上面那條 <span style="color:var(--tvWarn);font-weight:800;">⚠️ 排了試聽沒來</span>。<br>'
        + '業務重新約一個未來的日期 → 下次同步就<b>自動加回「安排試聽」</b>，同時從「沒來」減掉。<br>'
        + '如果業務後來寫了「取消／不來了／不參加／放棄」，這場就不算了，不會一直掛在試聽裡。</p></div>'
        + '<div class="tv-kwrow"><b>⑤ 兩種來源</b>'
        + '<p><b>名單頁的備註</b>（最新一筆追蹤情形）每次同步都會看到，會自動累積起來；<br>'
        + '每天按一次 <b>🔀 漏斗</b>，業務後來改掉的舊備註也會留在系統裡，不用再去 EIP 一個一個打開歷史紀錄。懷疑某個學生漏算，按他旁邊的「重抓」就好。</p></div>'
        + '<div class="tv-kwtip">💡 要跟業務講的只有一句：<b>「試聽日期寫在追蹤情形裡，格式像 9/25 試聽 就好。」</b>其餘的錯字和寫法系統都吃得下來。</div>'
        + '</div>';

      // ── ④ 面談 vs 報到 ──
      var gapN = s.interview - s.checkin;
      var whyR = '<p>' + (gapN > 0
        ? '這家面談 <b>' + s.interview + '</b> 比報到 <b>' + s.checkin + '</b> 多了 <b>' + gapN + '</b> 位，所以「報到→面談」會是 <b>' + _fnPct(s.r1) + '</b>（超過 100%）。<b style="color:var(--tvGood);">這不是錯，是好事</b> —— 代表有在經營舊名單。'
        : '這家面談 <b>' + s.interview + '</b>、報到 <b>' + s.checkin + '</b>，轉換率 <b>' + _fnPct(s.r1) + '</b>。')
        + '</p><p style="margin-top:6px;">兩個數字算的不是同一群人：<b>報到</b>只算「這個月實際走進學院的新名單」；<b>面談</b>只要這個月談過就算。多出來的通常是這四種：</p>'
        + '<div class="tv-chips"><span>舊名單本月回來談</span><span>班務／舊生談加購</span><span>線上面談（沒走報到）</span><span>轉介紹・自己來</span></div>'
        + '<p style="margin-top:6px;color:var(--tvDim);">反過來，低於 <b>70%</b> 才要緊張 —— 人來了卻沒談到。</p>';

      // ── ⑤ 當下註冊五關卡 + 真實例子 ──
      var ex = '';
      if (a){
        var pick = [];
        if (a.onsite.length) pick.push({ r:'當下註冊', c:'var(--tvGoodSoft);color:var(--tvGood)', x:a.onsite[0], t:'Ⓐ 新名單・' + a.onsite[0].days + ' 天內簽' });
        if (a.trialReg.length) pick.push({ r:'試聽後註冊', c:'var(--tvAccSoft);color:var(--tvAcc)', x:a.trialReg[0], t:'Ⓐ 新名單・隔 ' + a.trialReg[0].days + ' 天' + (a.trialReg[0].trial ? '・有試聽' : '') });
        if (a.harvest.length) pick.push({ r:'追回', c:'var(--tvWarnSoft);color:var(--tvWarn)', x:a.harvest[0], t:'Ⓑ 舊名單（' + _fnMonthLabel(a.harvest[0].ym) + '就進來了）' });
        if (a.mgmt.length) pick.push({ r:'經營中', c:'#FDF1E7;color:var(--tvOrange)', x:a.mgmt[0], t:'有試聽、還沒簽・已 ' + a.mgmt[0].days + ' 天' });
        ex = pick.map(function(p){
          var x = p.x;
          return '<div class="tv-ex"><div class="tv-ex-h"><b>' + _fnEsc(x.n) + '</b><span style="background:' + p.c + '">' + p.r + '</span></div>'
            + '<div class="tv-ex-p">' + (x.d ? '面談 ' + x.d : '') + (x.r ? '　→　註冊 ' + x.r : '') + (x.v ? '　' + _fnWan(x.v) : '') + '</div>'
            + '<div class="tv-ex-w">判定：' + p.t + '　｜　承辦 <span class="fn-own">' + _fnEsc(x.o || '—') + '</span></div></div>';
        }).join('');
      }
      var five = '<div class="tv-five">'
        + ['這個月有面談紀錄嗎？|面談紀錄總表：建檔日期在本月',
           '名單是這個月進來的嗎？|通路建檔日期在本月 ＝ Ⓐ；不是 → 丟去「追回」',
           '這個月有註冊嗎？|營業收支：繳費狀態＝註冊，且不是「學員加購」',
           '金額有到 2 萬嗎？|本月註冊業績合計加總 ≥ 20,000；沒到 → 算「經營中」',
           '註冊日 − 面談日 ≤ 3 天？|是 → 當下註冊；否 → 試聽後註冊'
          ].map(function(t, i){ var p = t.split('|');
            return '<div class="tv-f' + (i === 4 ? ' last' : '') + '"><span class="tv-n">' + (i+1) + '</span><b>' + p[0] + '</b><p>' + p[1] + '</p></div>';
          }).join('') + '</div>';

      // ── ⑥ 跨月因果 ──
      var nextM = _fnNextMonthLabel(ym);
      var cross = '<div class="tv-flowline">'
        + '<div class="tv-fl"><span class="tv-tag" style="background:var(--tvWarnSoft);color:var(--tvWarn)">追回</span><b>' + (m-3 < 1 ? (m+9) : (m-3)) + '～' + (m-1 < 1 ? 12 : (m-1)) + ' 月進來的名單　→　' + m + ' 月才簽約</b>'
        + '<p>名單建檔在本月以前 → 不算當月新談，算「追回」。這是前幾個月經營的收成。' + (s.harvest != null ? '　這家本月追回 <b>' + s.harvest + '</b> 位。' : '') + '</p></div>'
        + '<div class="tv-fl"><span class="tv-tag" style="background:var(--tvGoodSoft);color:var(--tvGood)">當月</span><b>' + m + ' 月新進名單　→　' + m + ' 月面談　→　' + m + ' 月簽約</b>'
        + '<p>名單、面談、註冊都在同一個月，才是「當下／試聽後」，代表本月新戰力。' + (a ? '　這家 <b>' + (a.onsite.length + a.trialReg.length) + '</b> 位。' : '') + '</p></div>'
        + '<div class="tv-fl"><span class="tv-tag" style="background:#E6F4F5;color:var(--tvTeal)">池子</span><b>' + m + ' 月面談＋試聽　→　' + nextM + ' 才可能簽</b>'
        + '<p>本月試聽了還沒簽 → 進「經營中」' + (s.mgmt ? '（<b>' + s.mgmt + '</b> 位）' : '') + '；下個月它就變成 ' + nextM + ' 的「經營池」，簽了就是 ' + nextM + ' 的追回。'
        + (a && a.pool.length ? '　這家目前還有 <b>' + a.pool.length + '</b> 位前幾個月的經營池可以追。' : '') + '</p></div>'
        + '</div>'
        + '<p style="margin-top:12px;font-weight:700;color:var(--tvInk);background:var(--tvAccSoft);border-radius:12px;padding:11px 16px;">所以「這個月做多少」和「這個月談多少」不是同一件事：追回是過去的收成，經營中是未來的存款。</p>';

      // ── ⑦ 三個率 ──
      var rateRows = [
        { v:s.r1, lb:'報到 → 面談', say:'來報到的人，有多少真的談到？', key:'r1', minK:'checkin', minV:1 },
        { v:s.r2, lb:'面談 → 試聽', say:'談過的人，有多少願意來試聽？', key:'r2', minK:'interview', minV:10 },
        { v:s.r3, lb:'試聽 → 註冊', say:'試聽完的人，有多少決定註冊？', key:'r3', minK:'trial', minV:5 },
      ].map(function(r){
        var av = avg(r.key, r.minK, r.minV), rk = isOrg ? rank(r.key) : 0;
        var good = av && r.v >= av;
        return '<div class="tv-rate"><div class="tv-rv" style="border-color:' + (good ? 'var(--tvGood)' : 'var(--tvBad)') + ';color:' + (good ? 'var(--tvGood)' : 'var(--tvBad)') + '">' + _fnPct(r.v) + '</div>'
          + '<div><b>' + r.lb + '</b><p>' + r.say + '</p>'
          + '<p style="color:var(--tvDim);">七家平均 ' + _fnPct(av) + (isOrg && rk ? '　你排第 <b>' + rk + '</b> 名' : '') + '</p></div></div>';
      }).join('');

      var css = '<style>'
        + '#tvBg{position:fixed;inset:0;background:var(--tvPage);z-index:1000;display:block;padding:0;overflow:hidden;}'
        /* 夜間（預設）*/
        + '#tvBg,#tvBox{'
        +   '--tvAcc:#BF5AF2;--tvAccSoft:rgba(191,90,242,.15);--tvGood:#30D158;--tvGoodSoft:rgba(48,209,88,.14);--tvBad:#FF6B5A;'
        /* ★ 警告色跟主頁 --fnWarn 對齊成黃色。原本這裡是橘 #FFB340，而橘色在卡片上代表「要處理的事」，
           同一筆資料換個視窗顏色就在講不同的事。橘色留給 --tvOrange 專用。*/
        +   '--tvWarn:#FFD60A;--tvWarnSoft:rgba(255,214,10,.13);--tvTeal:#5EEAD4;--tvOrange:#FF9F0A;'
        +   '--tvInk:#F5F5F7;--tvDim:#A1A1A6;--tvFaint:#8A8A90;--tvLine:rgba(255,255,255,.11);--tvSoft:#1C1C1F;'
        +   '--tvPage:#141417;--tvCard:#1C1C1F;--tvFill:#232327;--tvHd:rgba(20,20,23,.86);--tvOn:#141417;'
        +   '--tvGold:#FFD60A;--tvGoldOn:#141417;--tvGoldSoft:rgba(255,214,10,.15);--tvGoldGlow:rgba(255,214,10,.55);'
        +   '--tvPanel:#2A2A2E;--tvPanelBd:rgba(255,255,255,.14);--tvInput:#151518;--tvInputBd:rgba(255,255,255,.24);'
        +   '--tvShadow:0 10px 30px rgba(0,0,0,.5);}'
        /* 日間 */
        + 'body.day-mode #tvBg,body.day-mode #tvBox{'
        +   '--tvAcc:#5B5BD6;--tvAccSoft:#EEEEFB;--tvGood:#1B8A4B;--tvGoodSoft:#EAF6EF;--tvBad:#C0392B;'
        +   '--tvWarn:#A8690B;--tvWarnSoft:#FDF6E7;--tvTeal:#0E7C86;--tvOrange:#B0590A;'
        +   '--tvInk:#1D1D1F;--tvDim:#55555A;--tvFaint:#6E6E73;--tvLine:#E5E5EA;--tvSoft:#F5F5F7;'
        +   '--tvPage:#FFFFFF;--tvCard:#FFFFFF;--tvFill:#F5F5F7;--tvHd:rgba(255,255,255,.94);--tvOn:#FFFFFF;'
        +   '--tvGold:#B8860B;--tvGoldOn:#FFFFFF;--tvGoldSoft:#FFF6DC;--tvGoldGlow:rgba(184,134,11,.45);'
        +   '--tvPanel:#FFFFFF;--tvPanelBd:#D8D8DE;--tvInput:#FFFFFF;--tvInputBd:#B9B9C0;'
        +   '--tvShadow:0 1px 2px rgba(0,0,0,.06),0 10px 28px rgba(0,0,0,.10);}'
        + '#tvBox{'
        +   'background:var(--tvPage);color:var(--tvInk);border-radius:0;width:100%;height:100%;padding:0;'
        +   'font-size:.95rem;line-height:1.7;overflow:auto;'
        +   '-webkit-font-smoothing:antialiased;letter-spacing:.01em;}'
        /* 內容置中收在可讀寬度內，但背景是滿版白 */
        + '#tvBox > *{max-width:1180px;margin-left:auto;margin-right:auto;}'
        + '#tvBox > .tv-hd{max-width:none;position:sticky;top:0;z-index:5;background:var(--tvHd);-webkit-backdrop-filter:saturate(180%) blur(12px);backdrop-filter:saturate(180%) blur(12px);border-bottom:1px solid var(--tvLine);padding:16px 32px;margin:0 0 8px;}'
        + '#tvBox > .tv-hd > .tv-hd-in{max-width:1180px;margin:0 auto;display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;}'
        + '#tvBox > h3, #tvBox > div:not(.tv-hd), #tvBox > p{padding-left:32px;padding-right:32px;}'
        + '@media (max-width:860px){#tvBox > .tv-hd{padding:14px 16px;} #tvBox > h3, #tvBox > div:not(.tv-hd), #tvBox > p{padding-left:16px;padding-right:16px;}}'
        + '#tvBox h2{margin:2px 0 0;font-size:1.6rem;font-weight:800;letter-spacing:-.01em;color:var(--tvInk);}'
        + '.tv-kw{display:grid;gap:11px;}'
        + '.tv-kwrow{background:var(--tvFill);border-radius:14px;padding:13px 16px;}'
        + '.tv-kwrow b{font-size:.92rem;color:var(--tvInk);}'
        + '.tv-kwrow p{margin-top:6px;font-size:.86rem;line-height:1.65;color:var(--tvDim);}'
        + '.tv-chips2{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px;}'
        + '.tv-chips2 span{background:var(--tvCard);border:1px solid var(--tvLine);border-radius:999px;padding:3px 11px;font-size:.8125rem;font-weight:700;color:var(--tvAcc);}'
        + '.tv-eg{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px;}'
        + '.tv-eg span{border-radius:8px;padding:4px 10px;font-size:.8125rem;font-weight:700;}'
        + '.tv-eg .ok{background:var(--tvGoodSoft);color:var(--tvGood);}'
        + '.tv-eg .no{background:var(--tvFill);color:var(--tvFaint);text-decoration:line-through;}'
        + '.tv-kwtip{background:var(--tvAccSoft);border-radius:14px;padding:13px 16px;font-size:.88rem;line-height:1.6;color:var(--tvInk);}'
        + '#tvBox h3{margin:30px 0 12px;font-size:1.02rem;font-weight:800;color:var(--tvInk);display:flex;align-items:center;gap:9px;letter-spacing:0;}'
        + '#tvBox h3 i{font-style:normal;width:21px;height:21px;border-radius:50%;background:var(--tvAcc);color:var(--tvOn);font-size:.8125rem;font-weight:700;display:inline-flex;align-items:center;justify-content:center;flex:none;}'
        + '#tvBox p{margin:0;}'
        + '#tvBox b{font-weight:700;}'
        /* 逐項表：白底、細分隔線，不用色塊 */
        + '.tv-row{display:grid;grid-template-columns:76px 96px 118px 1fr;gap:14px;padding:11px 2px;align-items:baseline;border-top:1px solid var(--tvLine);}'
        + '.tv-row:first-of-type{border-top:none;}'
        + '.tv-lb{font-weight:700;color:var(--tvDim);font-size:.86rem;}'
        + '.tv-val{font-weight:800;font-size:1.28rem;color:var(--tvInk);letter-spacing:-.02em;font-variant-numeric:tabular-nums;}'
        + '.tv-from{font-size:.8125rem;color:var(--tvDim);background:var(--tvSoft);border-radius:6px;padding:3px 9px;text-align:center;font-weight:600;white-space:nowrap;}'
        + '.tv-how{font-size:.86rem;color:var(--tvInk);opacity:.82;}'
        /* 對帳章：柔和琥珀，不用紅框 */
        + '.tv-row.tv-hot{background:var(--tvWarnSoft);border:none;border-left:3px solid var(--tvWarn);border-radius:0 10px 10px 0;padding:12px 12px 12px 13px;margin-top:6px;}'
        + '.tv-row.tv-hot .tv-lb{color:var(--tvWarn);font-weight:800;}'
        + '.tv-row.tv-hot .tv-val{color:var(--tvWarn);}'
        + '.tv-row.tv-hot .tv-from{background:var(--tvWarnSoft);color:var(--tvWarn);font-weight:700;}'
        /* 三步驟 */
        + '.tv-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}'
        + '.tv-step{background:var(--tvSoft);border-radius:14px;padding:16px 18px;}'
        + '.tv-step p{font-size:.85rem;color:var(--tvInk);opacity:.82;margin-top:6px;}'
        + '.tv-n{display:inline-flex;width:21px;height:21px;border-radius:50%;background:var(--tvAcc);color:var(--tvOn);font-weight:700;font-size:.8125rem;align-items:center;justify-content:center;margin-right:8px;}'
        + '.tv-chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;}'
        + '.tv-chips span{background:var(--tvFill);color:var(--tvInk);border-radius:999px;padding:5px 13px;font-size:.82rem;font-weight:600;}'
        /* 五關卡：最後一格改淺色＋強調邊，不再用黑底 */
        + '.tv-five{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;}'
        + '.tv-f{background:var(--tvSoft);border-radius:14px;padding:14px 13px;}'
        + '.tv-f.last{background:var(--tvAccSoft);box-shadow:inset 0 0 0 1.5px var(--tvAcc);}'
        + '.tv-f b{display:block;margin-top:8px;font-size:.9rem;color:var(--tvInk);}'
        + '.tv-f p{font-size:.8125rem;color:var(--tvDim);margin-top:5px;}'
        + '.tv-f.last b,.tv-f.last p{color:var(--tvInk);}'
        /* 真實案例 */
        + '.tv-exs{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:10px;margin-top:12px;}'
        + '.tv-ex{background:var(--tvCard);border:1px solid var(--tvLine);border-radius:14px;padding:13px 15px;}'
        + '.tv-ex-h{display:flex;justify-content:space-between;align-items:center;gap:8px;}'
        + '.tv-ex-h b{font-size:.95rem;}'
        + '.tv-ex-h span{border-radius:999px;padding:3px 11px;font-size:.8125rem;font-weight:700;background:var(--tvSoft);}'
        + '.tv-ex-p{font-size:.85rem;margin-top:6px;color:var(--tvInk);opacity:.82;}'
        + '.tv-ex-w{font-size:.8125rem;color:var(--tvFaint);margin-top:4px;}'
        /* 跨月 */
        + '.tv-det{margin-top:10px;border:1px solid var(--tvLine);border-radius:12px;overflow:hidden;}'
        + '.tv-det summary{cursor:pointer;padding:9px 13px;font-size:.82rem;font-weight:700;color:var(--tvAcc);background:var(--tvSoft);list-style:none;display:flex;align-items:center;gap:10px;flex-wrap:wrap;}'
        + '.tv-sum-tag{flex:0 0 auto;min-width:92px;text-align:center;background:var(--tvCard);border:1px solid var(--tvLine);border-radius:6px;padding:2px 8px;font-size:.8125rem;color:var(--tvDim);font-weight:700;}'
        + '.tv-sum-n{flex:0 0 auto;}'
        + '.tv-sum-nm{color:var(--tvFaint);font-weight:500;font-size:.8125rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}'
        /* 寬螢幕時整塊往左推，讓分類小標剛好落在「資料來源」那一欄下面（就是原本空著的那一格）*/
        + '@media (min-width:900px){.tv-det{margin-left:-132px;}}'
        + '.tv-det summary::-webkit-details-marker{display:none;}'
        + '.tv-det[open] summary{border-bottom:1px solid var(--tvLine);}'
        + '.tv-det-b{padding:12px 14px;display:grid;grid-template-columns:1fr 1fr;gap:16px;}'
        + '.tv-det-b.tv-one{grid-template-columns:1fr;}'
        + '.tv-g-t{font-size:.8125rem;font-weight:700;color:var(--tvDim);margin-bottom:7px;} .tv-g-t b{color:var(--tvInk);}'
        + '.tv-ul{margin:0;padding:0;list-style:none;max-height:260px;overflow:auto;}'
        + '.tv-ul li{padding:7px 0;border-top:1px solid var(--tvLine);font-size:.82rem;}'
        + '.tv-ul li:first-child{border-top:none;}'
        + '.tv-ul li b{margin-right:7px;}'
        + '.tv-pill{background:var(--tvWarnSoft);color:var(--tvWarn);border-radius:999px;padding:2px 9px;font-size:.8125rem;font-weight:700;}'
        + '.tv-pill-x{background:var(--tvSoft);color:var(--tvDim);}'
        + '.tv-ul li em{display:block;font-style:normal;color:var(--tvFaint);font-size:.8125rem;margin-top:2px;}'
        + '.tv-none{color:var(--tvFaint);font-size:.8125rem;padding:6px 0;}'
        + '.tv-note{grid-column:1/-1;font-size:.8125rem;color:var(--tvDim);background:var(--tvSoft);border-radius:10px;padding:9px 12px;margin-top:2px;}'
        + '@media (max-width:820px){.tv-det-b{grid-template-columns:1fr;}}'
        + '.tv-flowline{display:grid;gap:10px;}'
        + '.tv-fl{background:var(--tvSoft);border-radius:14px;padding:13px 16px;}'
        + '.tv-fl p{font-size:.85rem;color:var(--tvInk);opacity:.82;margin-top:4px;}'
        + '.tv-tag{border-radius:6px;padding:2px 10px;font-size:.8125rem;font-weight:700;margin-right:9px;background:var(--tvCard);}'
        /* 三個率 */
        + '.tv-rates{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}'
        + '.tv-rate{display:flex;gap:12px;align-items:flex-start;background:var(--tvSoft);border-radius:14px;padding:14px;}'
        + '.tv-rv{border:1.5px solid;border-radius:999px;padding:5px 13px;font-weight:800;font-size:1rem;white-space:nowrap;background:var(--tvCard);font-variant-numeric:tabular-nums;}'
        + '.tv-rate b{font-size:.9rem;} .tv-rate p{font-size:.8125rem;color:var(--tvDim);}'
        /* 按鈕 */
        + '.tv-close{border:1px solid var(--tvAcc) !important;background:var(--tvAcc) !important;color:#fff !important;border-radius:999px;padding:9px 20px;font-weight:700;cursor:pointer;font-size:.88rem;font-family:inherit;}'
        + '.tv-close:hover{filter:brightness(1.12);}'
        + '.tv-print{border:1px solid var(--tvLine) !important;background:var(--tvFill) !important;color:var(--tvInk) !important;border-radius:999px;padding:9px 18px;font-weight:700;cursor:pointer;font-size:.88rem;margin-right:8px;font-family:inherit;}'
        + '.tv-print:hover{border-color:var(--tvDim) !important;}'
        + '@media print{#tvBg,#tvBox{--tvPage:#fff;--tvCard:#fff;--tvFill:#F5F5F7;--tvInk:#1D1D1F;--tvDim:#6E6E73;--tvFaint:#8E8E93;--tvLine:#E5E5EA;--tvSoft:#F5F5F7;--tvHd:#fff;--tvOn:#fff;--tvAcc:#5B5BD6;--tvAccSoft:#EEEEFB;--tvGood:#1B8A4B;--tvWarn:#A8690B;} #tvBg{position:static;background:#fff;padding:0;overflow:visible;backdrop-filter:none;} #tvBox{box-shadow:none;max-width:none;padding:0;height:auto;overflow:visible;} #tvBox>.tv-hd{position:static;background:#fff;} .tv-close,.tv-print{display:none;} .tv-det{border-color:#ccc;} .tv-det summary{display:none;} .tv-det-b{display:grid !important;} .tv-ul{max-height:none;overflow:visible;} h3{page-break-after:avoid;} .tv-row,.tv-step,.tv-f,.tv-ex,.tv-fl,.tv-rate{page-break-inside:avoid;}}'
        /* 👤 業務選擇器：黏在標題下面，捲動時還看得到 */
        + '#tvBox .tv-whobar{position:sticky;top:0;z-index:4;background:var(--tvHd);-webkit-backdrop-filter:saturate(180%) blur(12px);backdrop-filter:saturate(180%) blur(12px);'
        +   'border-bottom:1px solid var(--tvLine);padding:12px 32px 13px;margin:0;display:flex;flex-direction:column;gap:7px;}'
        + '#tvBox .tv-whorow{display:flex;flex-wrap:wrap;gap:7px;align-items:center;}'
        + '#tvBox .tv-whorow.p{padding-left:16px;border-left:2px solid var(--tvLine);margin-left:2px;}'
        + '#tvBox .tv-wholb{font-size:.8125rem;font-weight:800;color:var(--tvFaint);letter-spacing:.06em;margin-right:2px;}'
        + '#tvBox .tv-who{font-size:.86rem;font-weight:800;color:var(--tvDim);background:var(--tvFill);border:1px solid var(--tvLine);'
        +   'border-radius:999px;padding:7px 16px;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:baseline;gap:6px;'
        +   'font-family:inherit;transition:all .12s;}'
        + '#tvBox .tv-who:hover{color:var(--tvInk);border-color:var(--tvAcc);}'
        + '#tvBox .tv-who.on{color:#fff;background:var(--tvAcc);border-color:var(--tvAcc);}'
        + '#tvBox .tv-who small{font-weight:600;opacity:.72;font-size:.9em;}'
        + '#tvBox .tv-who i{font-style:normal;font-weight:900;opacity:.85;font-variant-numeric:tabular-nums;}'
        + '#tvBox .tv-whohint{font-size:.8125rem;color:var(--tvFaint);}'
        /* 金色：這是整個視窗最重要的一個動作，所以讓它自己會呼吸 */
        + '#tvBox .tv-gold{border:1px solid var(--tvGold) !important;background:var(--tvGold) !important;color:var(--tvGoldOn) !important;'
        +   'border-radius:999px;padding:9px 20px;font-weight:800;cursor:pointer;font-size:.88rem;margin-right:8px;font-family:inherit;'
        +   'animation:tvGoldPulse 2.4s ease-in-out infinite;}'
        + '#tvBox .tv-gold:hover{filter:brightness(1.1);}'
        + '@keyframes tvGoldPulse{0%{box-shadow:0 0 0 0 var(--tvGoldGlow);}70%{box-shadow:0 0 0 10px transparent;}100%{box-shadow:0 0 0 0 transparent;}}'
        + '#tvBox .tv-whobar{border-bottom:2px solid var(--tvGold) !important;box-shadow:inset 0 0 0 100vmax var(--tvGoldSoft);}'
        + '#tvBox .tv-wholb{color:var(--tvGold) !important;}'
        + '#tvBox .tv-who{border-color:var(--tvGold) !important;background:var(--tvCard) !important;color:var(--tvInk) !important;}'
        + '#tvBox .tv-who:hover{filter:brightness(1.06);}'
        + '#tvBox .tv-who.on{background:var(--tvGold) !important;color:var(--tvGoldOn) !important;box-shadow:0 0 0 3px var(--tvGoldSoft);}'
        + '#tvBox .tv-whorow.p{border-left-color:var(--tvGold) !important;}'
        + '#tvBox .tv-whobar.flash{animation:tvBarFlash .9s ease-out 2;}'
        + '@keyframes tvBarFlash{0%,100%{outline:0 solid transparent;outline-offset:0;}35%{outline:3px solid var(--tvGold);outline-offset:-3px;}}'
        + '@media (prefers-reduced-motion:reduce){#tvBox .tv-gold,#tvBox .tv-whobar.flash{animation:none;}}'
        + '.fn-share{margin-top:6px;}'
        + '.fn-share-t{font-size:.8125rem;font-weight:700;color:var(--tvFaint);font-variant-numeric:tabular-nums;}'
        + '.fn-share-t b{color:var(--tvAcc);}'
        + '.fn-share-b{margin-top:3px;height:3px;border-radius:999px;background:var(--tvLine);overflow:hidden;max-width:150px;}'
        + '.fn-share-b i{display:block;height:100%;background:var(--tvAcc);border-radius:999px;}'
        + '@media print{#tvBox .tv-whobar{position:static;}}'
        + '@media (max-width:820px){#tvBox .tv-whobar{padding:10px 16px;} .tv-row{grid-template-columns:64px 1fr;gap:6px;} .tv-from{grid-column:2;justify-self:start;} .tv-how{grid-column:2;} .tv-steps,.tv-five,.tv-rates{grid-template-columns:1fr;}}'
        + '</style>';

      var html = '<div id="tvBg">' + css + '<div id="tvBox">'
        + '<div class="tv-hd"><div class="tv-hd-in">'
        + '<div><div style="font-size:.8125rem;font-weight:700;letter-spacing:.14em;color:var(--tvDim);">HOW TO READ · ' + y + ' 年 ' + m + ' 月</div>'
        + '<h2>' + _fnEsc(s.org) + (s.who ? '　·　<span style="color:var(--tvAcc);">👤 ' + _fnEsc(s.who) + (s.whoKind === 'g' ? '（整組）' : '') + '</span>' : '') + '　這張卡的每個數字是怎麼來的</h2>'
        + '<p style="color:var(--tvDim);font-size:.86rem;margin-top:4px;">下面全部用這張卡「現在的真實數字」現算，跟卡片一致。'
        + (a ? '資料來源：EIP 逐人明細（面談紀錄總表＋營業收支查詢）。' : '這家還沒同步逐人資料，部分欄位是手填值。') + '</p></div>'
        + '<div style="white-space:nowrap;">'
        + (_scope.bar ? '<button class="tv-gold" onclick="fnTeachWhoJump()" title="選一位業務，整個視窗的數字與名單都只剩他的">👤 ' + (s.who ? _fnEsc(s.who) + '　·　換人' : '看業務個人') + '</button>' : '')
        + '<button class="tv-print" onclick="window.print()">🖨 列印</button><button class="tv-close" onclick="fnTeachClose()">✕ 關閉（Esc）</button></div></div>'
        + _scope.bar + '</div>'

        + '<h3><i>1</i>上排這幾個數字</h3>' + top
        + '<h3><i>2</i>中間四格漏斗</h3>' + flow
        + '<h3><i>3</i>一個學生會被分成哪一種？三步驟判定</h3>' + rules
        + '<h3><i>3.5</i>「安排試聽」是怎麼被認出來的？（業務怎麼寫都抓得到）</h3>' + kw
        + '<h3><i>4</i>為什麼「實際面談 ' + s.interview + '」比「總報到 ' + s.checkin + '」還多？</h3>' + whyR
        + '<h3><i>5</i>「當下註冊 ' + s.onsite + '」是怎麼算出來的？</h3>' + five
        + (ex ? '<div class="tv-exs">' + ex + '</div><p style="font-size:.8125rem;color:var(--tvDim);margin-top:6px;">↑ 這幾位是這張卡裡的真實案例，點卡片的「👥 名單」可以看到全部。</p>' : '')
        + '<h3><i>6</i>跨月的因果：這個月的業績，有一半是上個月種的</h3>' + cross
        + '<h3><i>7</i>下面三個轉換率在看什麼</h3><div class="tv-rates">' + rateRows + '</div>'
        + '<div style="margin-top:22px;padding-top:14px;border-top:2px solid var(--tvLine);display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">'
        + '<div style="font-size:.84rem;color:var(--tvDim);">業務要做的只有三件事：<b style="color:var(--tvInk);">面談完當天建檔</b>　·　<b style="color:var(--tvInk);">有安排試聽就記錄</b>　·　<b style="color:var(--tvInk);">金額進 EIP 才算</b>。資料乾淨，數字才會替你說話。</div>'
        + '<button class="tv-close" onclick="fnTeachClose()">我懂了</button></div>'
        + '</div></div>';
      var old = document.getElementById('tvBg'); if (old) old.remove();
      try { document.body.style.overflow = 'hidden'; } catch(e){}   // 全螢幕時背景不要跟著捲
      var wrap = document.createElement('div'); wrap.innerHTML = html;
      document.body.appendChild(wrap.firstChild);
      fnChkCountAll();
      try { document.addEventListener('keydown', _fnTeachEsc); } catch(e){}
    }
function fnTeachWhoJump(){
      try {
        var box = document.getElementById('tvBox'); if (box) box.scrollTop = 0;
        var bar = document.querySelector('.tv-whobar');
        if (bar){ bar.classList.remove('flash'); void bar.offsetWidth; bar.classList.add('flash'); }
      } catch(e){}
    }
function fnTeachClose(){ var el = document.getElementById('tvBg'); if (el) el.remove(); try { document.body.style.overflow = ''; } catch(e2){} try { document.removeEventListener('keydown', _fnTeachEsc); } catch(e){} }
function _fnTeachEsc(e){ if (e.key === 'Escape') fnTeachClose(); }
function fnKbOpen(org){
      var list = _fnKbList(org);
      // ★ 2026/09：這整塊原本寫死白底深字，夜間模式點進來是一片白幕。
      //   改成跟教學視窗一樣：夜間是基底，body.day-mode 才切回日間。
      var css = '<style>'
        + '#kbBg{--kbPage:#141417;--kbCard:#1C1C1F;--kbInk:#F5F5F7;--kbDim:#A1A1A6;--kbFaint:#8A8A90;'
        +   '--kbLine:rgba(255,255,255,.11);--kbHd:rgba(20,20,23,.9);--kbAcc:#BF5AF2;}'
        + 'body.day-mode #kbBg{--kbPage:#FFFFFF;--kbCard:#FFFFFF;--kbInk:#1D1D1F;--kbDim:#55555A;--kbFaint:#6E6E73;'
        +   '--kbLine:#E5E5EA;--kbHd:rgba(255,255,255,.95);--kbAcc:#5B5BD6;}'
        + '#kbBg{position:fixed;inset:0;background:var(--kbPage);color:var(--kbInk);z-index:1200;overflow:auto;'
        + 'font-family:-apple-system,BlinkMacSystemFont,"Noto Sans TC","Microsoft JhengHei",sans-serif;-webkit-font-smoothing:antialiased;}'
        + '#kbBg .kb-hd{position:sticky;top:0;z-index:5;background:var(--kbHd);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border-bottom:1px solid var(--kbLine);padding:16px 28px;}'
        + '#kbBg .kb-hd-in,#kbBg .kb-in{max-width:960px;margin:0 auto;}'
        + '#kbBg .kb-hd-in{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}'
        + '#kbBg h2{font-size:1.25rem;margin:0;letter-spacing:-.01em;flex:0 0 auto;color:var(--kbInk);}'
        + '#kbBg .kb-sub{font-size:.8125rem;color:var(--kbFaint);flex-basis:100%;margin-top:2px;}'
        + '#kbBg input.kb-q{flex:1;min-width:200px;border:1px solid var(--kbLine) !important;border-radius:10px;padding:8px 12px;font-size:.9rem;font-family:inherit;'
        +   'background:var(--kbCard) !important;color:var(--kbInk) !important;}'
        + '#kbBg input.kb-q:focus{outline:none;border-color:var(--kbAcc) !important;box-shadow:0 0 0 3px rgba(191,90,242,.2);}'
        + '#kbBg button{border:1px solid var(--kbLine) !important;background:var(--kbCard) !important;color:var(--kbInk) !important;border-radius:10px;padding:8px 14px;cursor:pointer;font-weight:700;font-size:.85rem;font-family:inherit;}'
        + '#kbBg button:hover{border-color:var(--kbAcc) !important;color:var(--kbAcc) !important;}'
        + '#kbBg .kb-in{padding:18px 28px 60px;}'
        + '#kbBg .kb-i{border:1px solid var(--kbLine);border-radius:14px;padding:14px 16px;margin-top:12px;background:var(--kbCard);}'
        + '#kbBg .kb-i h4{margin:0;font-size:.95rem;color:var(--kbInk);}'
        + '#kbBg .kb-i .by{font-size:.8125rem;color:var(--kbFaint);font-weight:600;margin-left:8px;}'
        + '#kbBg .kb-i pre{white-space:pre-wrap;font-family:inherit;font-size:.87rem;line-height:1.65;margin:8px 0 0;color:var(--kbInk);}'
        + '#kbBg .kb-none{color:var(--kbFaint);padding:48px 0;text-align:center;}</style>';
      var body = list.length ? list.map(function(x){
          return '<div class="kb-i"><h4>' + _fnEsc(x.n) + '<span class="by">' + _fnEsc(x.by || '') + '　' + _fnWhen(x.at) + '</span></h4><pre>' + _fnEsc(x.t) + '</pre></div>';
        }).join('') : '<div class="kb-none">還沒有人貼過。<br>在名單上展開任何一位學員 → 複製提問 → 自己去問 AI → 把回答貼回來，這裡就會開始累積。</div>';
      var html = '<div id="kbBg">' + css
        + '<div class="kb-hd"><div class="kb-hd-in"><h2>📚 ' + _fnEsc(org) + '　追註冊知識庫</h2>'
        + '<input class="kb-q" type="search" placeholder="搜尋學員、關鍵字…" oninput="fnKbFilter(this)">'
        + '<button onclick="fnKbClose()">✕ 關閉（Esc）</button>'
        + '<div class="kb-sub">全院同仁自己去問 AI、再貼回來的追法，共 ' + list.length + ' 則。這裡只是知識庫的集結，不會自己去跑 AI。</div>'
        + '</div></div><div class="kb-in">' + body + '</div></div>';
      var old = document.getElementById('kbBg'); if (old) old.remove();
      var w = document.createElement('div'); w.innerHTML = html;
      document.body.appendChild(w.firstChild);
      try { document.body.style.overflow = 'hidden'; } catch(e){}
      try { document.addEventListener('keydown', _fnKbEsc); } catch(e){}
    }
function fnKbFilter(inp){
      var q = (inp.value || '').trim().toLowerCase();
      Array.prototype.forEach.call(document.querySelectorAll('#kbBg .kb-i'), function(el){
        el.style.display = (!q || el.textContent.toLowerCase().indexOf(q) >= 0) ? '' : 'none';
      });
    }
function fnKbClose(){
      var el = document.getElementById('kbBg'); if (el) el.remove();
      try { if (!document.getElementById('tvBg')) document.body.style.overflow = ''; } catch(e){}
      try { document.removeEventListener('keydown', _fnKbEsc); } catch(e){}
    }
function _fnKbEsc(e){ if (e.key === 'Escape'){ e.stopPropagation(); fnKbClose(); } }
function fnOpenReports(ym, org){
      var d = _fnDataFor(ym); var s = _fnOrgStats(d, org, ym);
      var reps = s.reports || [];
      var me = _fnMe();
      var groups = _fnGroupsFor(org, ym);
      var myGrp = _fnGroupOf(me, org, ym);
      var lastGrp = ''; try { lastGrp = localStorage.getItem('fn_rep_grp_' + org) || ''; } catch(e){}
      var defGrp = myGrp || lastGrp || '';
      // ── 各組本月報備筆數（0 筆標紅）──
      var cnt = {}; reps.forEach(function(r){ var g = r.grp || '未分組'; cnt[g] = (cnt[g] || 0) + 1; });
      var chips = groups.map(function(g){
        var n = cnt[g.name] || 0;
        return '<span class="fn-gchip' + (n ? '' : ' zero') + '" title="' + g.kind + '組・組長 ' + _fnEsc(g.leader) + '">' + _fnEsc(g.name) + ' <b>' + n + '</b></span>';
      });
      Object.keys(cnt).forEach(function(g){ if (!groups.some(function(x){ return x.name === g; })) chips.push('<span class="fn-gchip other">' + _fnEsc(g) + ' <b>' + cnt[g] + '</b></span>'); });
      var chipBar = groups.length || chips.length
        ? '<div class="fn-gbar"><span class="fn-gbar-t">各組本月報備</span>' + chips.join('') + (groups.length && Object.keys(cnt).every(function(g){ return !groups.some(function(x){ return x.name === g; }); }) && !reps.length ? '' : '') + '</div>'
        : '<div class="fn-gbar"><span class="fn-gbar-t">各組本月報備</span><span style="color:#999;font-size:.8125rem;">找不到 ' + _fnEsc(org) + ' 的組別（激勵分頁尚未同步 ' + ym + ' 的小組績效表）</span></div>';
      var stTag = function(r){
        var st = r.st;
        if (st === 'reg') return '<span style="color:#16a34a;font-weight:700;">✅ 已註冊（轉化成功）</span>';
        if (st === 'dup') return '<span style="color:#d97706;font-weight:700;">🔁 系統已偵測（有繳報名費或備註寫了試聽），不重複計</span>';
        if (st === 'ext-reg') return '<span style="color:#16a34a;font-weight:700;">✅ 外院 → 已在 ' + _fnEsc(r.regAt === org ? '本院' : r.regAt) + ' 註冊' + (r.regV ? '（' + _fnWan(r.regV) + '）' : '') + '</span>';
        if (st === 'ext-dup') return '<span style="color:#0e7490;font-weight:700;">🤖 系統已自動偵測到這位外院名單，不重複計</span>';
        if (st === 'ext') return '<span style="color:#0e7490;font-weight:700;">🏫 外院報備中（另列，不計入本院試聽）</span>';
        return '<span style="color:#2563eb;font-weight:700;">🖐 報備中（計入安排試聽）</span>';
      };
      var rows = reps.map(function(r){
        return '<div style="border-bottom:1px solid #eee;padding:9px 0;display:flex;gap:10px;align-items:flex-start;">'
          + '<div style="flex:1;line-height:1.55;"><b>' + _fnEsc(r.n) + '</b>'
          + (r.ext ? '<span class="fn-tag ext">🏫 外院' + (r.src ? '・原 ' + _fnEsc(r.src) : '') + '</span>' : '')
          + (r.grp ? '<span class="fn-tag grp">' + _fnEsc(r.grp) + '</span>' : '<span class="fn-tag none">未分組</span>')
          + (r.course ? '<span style="color:#666;">｜' + _fnEsc(r.course) + '</span>' : '')
          + (r.date ? '<span style="color:#666;">｜試聽日 ' + _fnEsc(r.date) + '</span>' : '')
          + '<div style="font-size:.8125rem;color:#777;margin-top:2px;">'
          + (r.sales ? '負責業務：' + _fnEsc(r.sales) + '　' : '') + stTag(r)
          + (r.note ? '<br>📝 ' + _fnEsc(r.note) : '')
          + '<br><span style="color:#aaa;">✍️ ' + _fnEsc(r.by || '未知') + ' 於 ' + _fnEsc(r.at || '—') + ' 報備</span></div></div>'
          + '<button onclick="fnDelReport(\'' + ym + '\',\'' + _fnEsc(org) + '\',\'' + r.id + '\')" style="border:none;background:#fdecec;color:#c33;border-radius:6px;padding:4px 9px;cursor:pointer;">🗑</button>'
          + '</div>';
      }).join('') || '<div style="color:#999;padding:14px 0;">尚無報備。沒繳報名費但已安排試聽的學員，從下方新增。</div>';
      // ── 系統自動偵測的外院名單（只顯示，已自動計入外院行）──
      var autoExt = (s.auto && s.auto.ext) ? s.auto.ext : [];
      var autoBlock = autoExt.length
        ? '<div style="margin-top:12px;padding:10px 12px;background:#ecfeff;border:1px solid #a5f3fc;border-radius:10px;">'
          + '<div style="font-weight:800;color:#0e7490;font-size:.85rem;">🤖 系統偵測到的外院名單 ' + autoExt.length + ' 位 <span style="font-weight:400;color:#0891b2;">（別家談過，本月在本院有報名／註冊；已自動計入「外院」行，不用再報備）</span></div>'
          + autoExt.map(function(x){ return '<div style="font-size:.8125rem;color:#155e75;padding:3px 0;">• <b>' + _fnEsc(x.n) + '</b>　原 ' + _fnEsc(x.src) + (x.o ? '・' + _fnEsc(x.o) : '') + '・' + x.d + ' 面談 → 本院' + (x.st === 'reg' ? ' <b style="color:#16a34a;">✅ 註冊 ' + x.r + '・' + _fnWan(x.v) + '</b>' : (x.a ? '報名 ' + x.a : '繳費 ' + x.r + '・' + x.v.toLocaleString() + '（未達 2 萬）') + '（經營中）') + (x.ours ? '・承辦 ' + _fnEsc(x.ours) : '') + '</div>'; }).join('')
          + '</div>'
        : '';
      var inp = 'style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:7px;font-size:.85rem;box-sizing:border-box;background:#fff;color:#1d1d1f;"';
      var grpOpts = '<option value="">— 組別 —</option>' + groups.map(function(g){ return '<option value="' + _fnEsc(g.name) + '"' + (g.name === defGrp ? ' selected' : '') + '>' + _fnEsc(g.name) + '（' + g.kind + '・' + _fnEsc(g.leader) + '）</option>'; }).join('')
        + (defGrp && !groups.some(function(g){ return g.name === defGrp; }) ? '<option value="' + _fnEsc(defGrp) + '" selected>' + _fnEsc(defGrp) + '</option>' : '')
        + '<option value="__other__">其他（自行輸入）</option>';
      var srcOpts = '<option value="">— 來源學院（外院時選）—</option>' + (typeof CK_ORG_LIST !== 'undefined' ? CK_ORG_LIST : []).filter(function(o){ return o !== org; }).map(function(o){ return '<option value="' + _fnEsc(o) + '">' + _fnEsc(o) + '</option>'; }).join('') + '<option value="其他學院">其他學院／不確定</option>';
      var html = '<div id="fnRepBg" onclick="if(event.target===this)this.remove()" style="position:fixed;inset:0;background:rgba(10,14,30,.55);z-index:999;display:flex;align-items:center;justify-content:center;padding:16px;">'
        + '<div style="background:#fff;color:#1d1d1f;border-radius:14px;max-width:600px;width:100%;max-height:88vh;overflow-y:auto;padding:20px;font-size:.9rem;box-shadow:0 18px 60px rgba(0,0,0,.35);">'
        + '<b style="font-size:1rem;">🖐 ' + _fnEsc(org) + '・報備試聽名單（' + ym + '）</b>'
        + '<div style="font-size:.8125rem;color:#888;margin:4px 0 8px;">沒繳報名費但有安排試聽 → 記名報備，計入「安排試聽」。外院名單（別家談過、我們安排試聽）選「外院」→ 另列不計率。學員之後註冊會自動標 ✅（外院掃七家）。全公司同步，每筆都記報備人、組別與時間。</div>'
        + chipBar
        + rows
        + autoBlock
        + '<div style="margin-top:14px;padding-top:12px;border-top:2px solid #eee;">'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">'
        + '<select id="fnRepGrp" ' + inp + ' onchange="var o=document.getElementById(\'fnRepGrpOther\');o.style.display=this.value===\'__other__\'?\'block\':\'none\';if(this.value===\'__other__\')o.focus();">' + grpOpts + '</select>'
        + '<input id="fnRepSales" placeholder="負責業務" value="' + _fnEsc(me) + '" ' + inp + '>'
        + '<input id="fnRepGrpOther" placeholder="組別名稱" style="display:none;grid-column:1 / -1;width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:7px;font-size:.85rem;box-sizing:border-box;background:#fff;color:#1d1d1f;">'
        + '<input id="fnRepName" placeholder="學員姓名（必填）" ' + inp + '>'
        + '<select id="fnRepType" ' + inp + ' onchange="document.getElementById(\'fnRepSrc\').style.display=this.value===\'ext\'?\'block\':\'none\';"><option value="own">本院試聽（計入安排試聽）</option><option value="ext">🏫 外院試聽（另列，不計率）</option></select>'
        + '<select id="fnRepSrc" style="display:none;grid-column:1 / -1;width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:7px;font-size:.85rem;box-sizing:border-box;background:#fff;color:#1d1d1f;">' + srcOpts + '</select>'
        + '<input id="fnRepCourse" placeholder="試聽課程（例：商用平面）" ' + inp + '>'
        + '<input id="fnRepDate" type="date" ' + inp + '>'
        + '</div>'
        + '<div style="margin-top:8px;"><input id="fnRepNote" placeholder="備註（選填）" ' + inp + '></div>'
        + '<div style="font-size:.8125rem;color:#999;margin-top:6px;">組別＝依登入者「' + _fnEsc(me || '未登入') + '」比對 EIP 小組績效表自動帶入' + (myGrp ? '（' + _fnEsc(myGrp) + '）' : '（找不到，請手選）') + '；負責業務預設登入者，報組員的單改名字即可。</div>'
        + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px;">'
        + '<button onclick="document.getElementById(\'fnRepBg\').remove()" style="padding:8px 16px;border:1px solid #ddd;background:#fff;color:#555;border-radius:8px;cursor:pointer;">關閉</button>'
        + '<button onclick="fnAddReport(\'' + ym + '\',\'' + _fnEsc(org) + '\')" style="padding:8px 16px;border:none;background:#4a6cf7;color:#fff;border-radius:8px;cursor:pointer;font-weight:700;">＋ 報備</button>'
        + '</div></div></div></div>';
      var old = document.getElementById('fnRepBg'); if (old) old.remove();
      document.body.insertAdjacentHTML('beforeend', html);
      try { var nm = document.getElementById('fnRepName'); if (nm) nm.focus(); } catch(e){}
    }

// Excel 函式庫改成用到才下載（以前每次開頁都載 860KB）
(function(){
  var _dct = downloadChTemplate, _ces = chExcelSelected;
  downloadChTemplate = function(){ var a = arguments, t = this; motivLoadSheetJS(function(){ _dct.apply(t, a); }); };
  chExcelSelected = function(){ var a = arguments, t = this; motivLoadSheetJS(function(){ _ces.apply(t, a); }); };
})();
window.__pcLazyReady = true;

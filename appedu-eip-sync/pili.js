/* ═══════════════════════════════════════════════
   Appedu EIP 激勵同步 v5.80｜2026-10-31｜霹靂表單「需補件」→ 13:40 日會（v5.82：一天一次，當天第一次打開分頁 1 分鐘後送；v5.83：多送客戶姓名、要補什麼、補件回覆）
   只在 Ivan 的 Chrome 開著霹靂表單（start-a-new-quest-41.lovable.app）、而且已經登入時才動：
   - v5.82（10/31 Ivan）：一天只送一次——當天打開霹靂表單分頁 1 分鐘後送；今天已經送過就不送。不管幾點開機都會補到當天的。分頁開過夜的話，隔天也會自己送一次
   - 只讀「狀態＝需補件」的案件；送案件編號、學院、承辦人、廠商、認列月份、建立日
   - v5.83（10/31 Ivan：內部用，要看學生姓名）：多送客戶姓名、最近一次審核寫的「要補什麼」、補件回覆。電話、身分證一律不讀、不送
   - 送到 Apps Script「業績數據橋接」（班況橋接 v5.6 收 kind=霹靂補件）
   跟 EIP 是不同網站，不會影響 EIP 的速度
   ═══════════════════════════════════════════════ */
(function(){
  'use strict';
  if (window.top !== window) return;
  if (location.hostname !== 'start-a-new-quest-41.lovable.app') return;
  var API = 'https://script.google.com/macros/s/AKfycbxBFayHnfG5NUoj0CjIe8qwlfdFwt0FQeVD-QH6ocBu3dhHWpioOEmLk908dsTGVlznYA/exec';
  var SB = 'https://nipwyotvfgzafshbugff.supabase.co/rest/v1/';
  var KEY = 'appedu_pili_last', busy = false, _anon = null;
  function today0(){ var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime(); }
  function token(){
    try {
      var k = Object.keys(localStorage).filter(function(x){ return /^sb-.*-auth-token$/.test(x); })[0]; if (!k) return null;
      var s = JSON.parse(localStorage.getItem(k)); return s.access_token || (s.currentSession && s.currentSession.access_token) || null;
    } catch(e){ return null; }
  }
  async function anon(){
    if (_anon) return _anon;
    var urls = Array.prototype.map.call(document.querySelectorAll('script[src]'), function(s){ return s.src; })
      .concat(performance.getEntriesByType('resource').map(function(e){ return e.name; }))
      .filter(function(u){ return /\/assets\/index-[^/]+\.js$/.test(u); });
    urls = urls.filter(function(u, i){ return urls.indexOf(u) === i; });
    for (var i = 0; i < urls.length; i++){
      try { var t = await fetch(urls[i]).then(function(r){ return r.text(); });
        var m = t.match(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/); if (m) return (_anon = m[0]); } catch(e){}
    }
    return null;
  }
  async function run(){
    if (busy) return; busy = true;
    try {
      var last = 0; try { last = +(localStorage.getItem(KEY) || 0); } catch(e){}
      if (last >= today0()) return;   // 今天已經送過
      var tk = token(), ak = await anon();
      if (!tk || !ak){ console.log('[霹靂補件] 還沒登入，等下一次'); return; }
      var H = { apikey: ak, Authorization: 'Bearer ' + tk };
      var vs = await fetch(SB + 'vendors?select=id,name', { headers: H }).then(function(r){ return r.json(); });
      var vm = {}; (Array.isArray(vs) ? vs : []).forEach(function(v){ vm[v.id] = v.name; });
      var rows = [], from = 0;
      while (true){
        var r = await fetch(SB + 'customers?select=id,case_no,customer_name,college,handler,vendor_id,recognition_month,created_at,custom_data->resubmission_replies,custom_data->case_requirements&status=eq.needs_info&order=created_at.asc',
          { headers: Object.assign({ Range: from + '-' + (from + 999) }, H) });
        var j = await r.json();
        if (!Array.isArray(j)){ console.warn('[霹靂補件] 讀不到（登入過期？），等下一次', j); return; }
        rows = rows.concat(j); if (j.length < 1000 || from >= 9000) break; from += 1000;
      }
      // v5.83：每一件最近一次審核寫的「要補什麼」（review_records.items：類別－項目＋備註）
      var rv = {}, ids = rows.map(function(x){ return x.id; }).filter(Boolean);
      for (var q = 0; q < ids.length; q += 80){
        try { var rr = await fetch(SB + 'review_records?select=customer_id,items,created_at&customer_id=in.(' + ids.slice(q, q + 80).join(',') + ')&order=created_at.desc', { headers: H }).then(function(x){ return x.json(); });
          (Array.isArray(rr) ? rr : []).forEach(function(v){ if (!rv[v.customer_id]) rv[v.customer_id] = v; }); } catch(e){}
      }
      function reqOf(x){ var v = rv[x.id], L = [];
        var items = v && v.items; if (typeof items === 'string') { try { items = JSON.parse(items); } catch(e){ items = []; } }
        (items || []).forEach(function(it){ var t = [it.category_label, it.item_label].filter(Boolean).join('－'); if (it.note) t += '（' + it.note + '）'; if (t) L.push(t); });
        (x.case_requirements || []).forEach(function(t){ if (t && L.indexOf(t) < 0) L.push(t); });
        return { q: L.join('、'), qd: v ? String(v.created_at || '').slice(0, 10) : '' }; }
      function replyOf(x, qd){ var a = x.resubmission_replies || []; if (!a.length) return null; var r = a[a.length - 1];
        var d = String(r.completed_at || '').slice(0, 10); if (qd && d && d < qd) return null;   // 回覆比最近一次審核早＝那是上一輪的，不算
        return { t: r.note || '', d: d, by: r.completed_by_name || '' }; }
      var body = { kind: '霹靂補件', at: new Date().toISOString(), rows: rows.map(function(x){ var q2 = reqOf(x), rp = replyOf(x, q2.qd);
        return { no: x.case_no || '', name: x.customer_name || '', college: x.college || '', handler: x.handler || '', vendor: vm[x.vendor_id] || '', month: x.recognition_month || '', created: x.created_at || '',
          req: q2.q, reqAt: q2.qd, reply: rp ? rp.t : '', replyAt: rp ? rp.d : '', replyBy: rp ? rp.by : '' }; }) };
      // Apps Script 還沒換成 v5.6（會收霹靂補件的版本）就不送，避免送進舊的業績快照
      var ver = 0; try { ver = +((await fetch(API, { cache: 'no-store' }).then(function(r){ return r.json(); })).v || 0); } catch(e){}
      if (ver < 5.6){ console.log('[霹靂補件] Apps Script 還是舊版（v' + ver + '），先不送'); return; }
      await fetch(API, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
      try { localStorage.setItem(KEY, String(Date.now())); } catch(e){}
      console.log('[霹靂補件] 送出 ' + rows.length + ' 件需補件');
    } catch(e){ console.warn('[霹靂補件] 這次沒送成', e); }
    finally { busy = false; }
  }
  setTimeout(run, 60000);   // 打開 1 分鐘後
  setInterval(run, 10 * 60 * 1000);
})();

/* ============================================================
   text-zoom.js — 跨頁文字放大（全站共用一個設定）
   ------------------------------------------------------------
   localStorage('appedu_text_zoom')：'1' 標準 / '1.5' 放大 / '2' 加大(放大一倍)
   任一頁調整 → 透過 storage 事件即時同步，其餘頁面下次載入也會套用同一級。
   頁面可選設定（在載入本檔前）：
     window.TEXT_ZOOM_CFG = { target / targets, mount / mounts }
       target(s) — 要被放大的元素選擇器（單一字串或陣列）；不給 → document.body
       mount(s)  — 控制列要掛進去的容器選擇器（單一或陣列）；不給 → 右下角浮動
   ============================================================ */
(function(){
  var cfg = window.TEXT_ZOOM_CFG || {};
  var LEVELS = [
    { k:'1',   label:'標準' },
    { k:'1.5', label:'放大' },
    { k:'2',   label:'加大' }
  ];
  var targets = cfg.targets || (cfg.target ? [cfg.target] : null); // null = 用 body
  var mounts  = cfg.mounts  || (cfg.mount  ? [cfg.mount]  : null); // null = 浮動
  function curLevel(){
    var v = '1';
    try{ v = localStorage.getItem('appedu_text_zoom') || '1'; }catch(e){}
    return LEVELS.some(function(l){ return l.k === v; }) ? v : '1';
  }
  function apply(){
    var v = curLevel(), zf = parseFloat(v) || 1;
    if(targets){
      targets.forEach(function(sel){
        var t = document.querySelector(sel);
        if(t) t.style.zoom = v;
      });
    } else if(document.body){
      document.body.style.zoom = v;
      // ★ 2026/07 修正「放大後上方選單搆不到」：
      //   固定高度版型（html,body{height:100%} + 內容區自己捲動，例：業績數據中心）在 body zoom > 1 時，
      //   body 會比視窗高 → 整份文件被往下捲、上方 header/分頁列跑出畫面且捲不回去。
      //   解法：把 body 寬高反向補償（zoom 1.5 → 高度 100/1.5 %），版面永遠剛好填滿視窗。
      //   一般自然捲動的頁面 html 高度是 auto，百分比高度無效 → 完全不受影響。
      if (zf === 1){
        document.body.style.height = '';
        document.body.style.width  = '';
      } else {
        document.body.style.height = (100 / zf) + '%';
        document.body.style.width  = (100 / zf) + '%';
      }
      // 把可能已經被推歪的文件捲回原點（救回已經卡住的狀態）
      try{ document.documentElement.scrollTop = 0; document.documentElement.scrollLeft = 0; }catch(e){}
    }
    var ctrls = document.querySelectorAll('.tz-control'), i, j;
    for(i=0;i<ctrls.length;i++){
      // 浮動控制列在被縮放的 body 內 → 反向縮回；掛在獨立容器的不用
      ctrls[i].style.zoom = targets ? 1 : (1 / zf);
      var btns = ctrls[i].querySelectorAll('.tz-btn');
      for(j=0;j<btns.length;j++){
        btns[j].classList.toggle('tz-on', btns[j].getAttribute('data-z') === v);
      }
    }
  }
  function setLevel(v){
    try{ localStorage.setItem('appedu_text_zoom', v); }catch(e){}
    apply();
  }
  // ★ 收合狀態（截圖時可一鍵縮成小角標，記憶偏好；每台裝置各自，不同步）
  function isCollapsed(){ try{ return localStorage.getItem('appedu_tz_collapsed') === '1'; }catch(e){ return false; } }
  function setCollapsed(v){ try{ localStorage.setItem('appedu_tz_collapsed', v ? '1' : '0'); }catch(e){}
    var c = document.querySelector('.tz-control.tz-float');
    if(c){ c.classList.toggle('tz-collapsed', !!v); pokeIdle(); }
  }
  // ★ 閒置自動變半透明：3 秒沒互動 → 淡出；滑到/點到 → 恢復
  var _idleT = null;
  function pokeIdle(){
    var c = document.querySelector('.tz-control.tz-float');
    if(!c) return;
    c.classList.remove('tz-idle');
    if(_idleT) clearTimeout(_idleT);
    _idleT = setTimeout(function(){ if(c) c.classList.add('tz-idle'); }, 3000);
  }
  function makeControl(floating){
    var box = document.createElement('div');
    box.className = 'tz-control' + (floating ? ' tz-float' : '');
    var inner = '';
    if(floating){
      // 收合把手（縮起來時只剩這顆小圓鈕；展開時當「收合」鈕）
      inner += '<button type="button" class="tz-handle" title="收合／展開文字大小列">A±</button>';
    }
    inner += '<span class="tz-cap">文字</span>' + LEVELS.map(function(l){
      return '<button type="button" class="tz-btn" data-z="' + l.k + '">' + l.label + '</button>';
    }).join('');
    box.innerHTML = inner;
    var bb = box.querySelectorAll('.tz-btn');
    for(var i=0;i<bb.length;i++){
      bb[i].addEventListener('click', function(){ setLevel(this.getAttribute('data-z')); pokeIdle(); });
    }
    var handle = box.querySelector('.tz-handle');
    if(handle){
      handle.addEventListener('click', function(e){ e.stopPropagation(); setCollapsed(!box.classList.contains('tz-collapsed')); });
    }
    if(floating){
      if(isCollapsed()) box.classList.add('tz-collapsed');
      box.addEventListener('mouseenter', pokeIdle);
      box.addEventListener('click', pokeIdle);
      box.addEventListener('touchstart', pokeIdle, {passive:true});
    }
    return box;
  }
  function build(){
    if(document.querySelector('.tz-control')) return;
    var st = document.createElement('style');
    st.textContent =
      '.tz-control{display:flex;gap:3px;align-items:center;background:rgba(20,28,46,0.94);'
    + 'border:1px solid rgba(120,160,220,0.32);border-radius:999px;padding:5px 7px;'
    + 'box-shadow:0 4px 18px rgba(0,0,0,0.32);font-family:-apple-system,"Noto Sans TC",sans-serif;'
    + 'transition:opacity .3s ease;}'
    + '.tz-control.tz-float{position:fixed;right:12px;bottom:12px;z-index:99995;}'
    // 閒置淡出（滑到/點到會恢復）— 截圖時比較不擋
    + '.tz-control.tz-float.tz-idle{opacity:.22;}'
    + '.tz-control.tz-float.tz-idle:hover{opacity:1;}'
    + '.tz-control .tz-cap{font-size:11px;font-weight:800;color:#9bb3d8;margin:0 4px 0 3px;}'
    + '.tz-control .tz-btn{border:none;border-radius:999px;padding:5px 11px;font-size:12px;'
    + 'font-weight:700;cursor:pointer;background:transparent;color:#9bb3d8;font-family:inherit;line-height:1;}'
    + '.tz-control .tz-btn:hover{background:rgba(120,160,220,0.18);}'
    + '.tz-control .tz-btn.tz-on{background:#0071e3;color:#fff;}'
    // 收合把手
    + '.tz-control .tz-handle{border:none;border-radius:999px;width:26px;height:26px;flex:0 0 auto;cursor:pointer;'
    + 'background:rgba(120,160,220,0.16);color:#9bb3d8;font-size:11px;font-weight:800;font-family:inherit;line-height:1;padding:0;}'
    + '.tz-control .tz-handle:hover{background:rgba(120,160,220,0.3);}'
    // 收合狀態：只剩把手，其餘藏起來
    + '.tz-control.tz-collapsed{padding:3px;opacity:.5;}'
    + '.tz-control.tz-collapsed:hover{opacity:1;}'
    + '.tz-control.tz-collapsed.tz-idle{opacity:.5;}'
    + '.tz-control.tz-collapsed .tz-cap,.tz-control.tz-collapsed .tz-btn{display:none;}'
    + 'body.day-mode .tz-control{background:rgba(255,255,255,0.96);border-color:#d2d2d7;box-shadow:0 4px 18px rgba(0,0,0,0.12);}'
    + 'body.day-mode .tz-control .tz-cap{color:#6e6e73;}'
    + 'body.day-mode .tz-control .tz-btn{color:#6e6e73;}'
    + 'body.day-mode .tz-control .tz-btn:hover{background:#ebebed;}'
    + 'body.day-mode .tz-control .tz-btn.tz-on{background:#0071e3;color:#fff;}'
    + 'body.day-mode .tz-control .tz-handle{background:#eef1f5;color:#6e6e73;}'
    + 'body.day-mode .tz-control .tz-handle:hover{background:#e2e6ec;}';
    document.head.appendChild(st);
    if(mounts){
      mounts.forEach(function(sel){
        var m = document.querySelector(sel);
        if(m) m.appendChild(makeControl(false));
      });
      // 指定的容器都不存在 → 退回右下角浮動
      if(!document.querySelector('.tz-control')) document.body.appendChild(makeControl(true));
    } else {
      document.body.appendChild(makeControl(true));
    }
  }
  function init(){ build(); apply(); pokeIdle(); }
  if(document.body) init();
  else document.addEventListener('DOMContentLoaded', init);
  window.addEventListener('storage', function(e){
    if(!e.key || e.key === 'appedu_text_zoom') apply();
  });
  window.applyTextZoom = apply;
})();

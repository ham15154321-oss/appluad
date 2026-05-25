/* ============================================================
   text-zoom.js — 跨頁文字放大（全站共用一個設定）
   ------------------------------------------------------------
   localStorage('appedu_text_zoom')：'1' 標準 / '1.5' 放大 / '2' 加大(放大一倍)
   任一頁調整 → 透過 storage 事件即時同步，其餘頁面下次載入也會套用同一級。
   頁面可選設定（在載入本檔前）：
     window.TEXT_ZOOM_CFG = { target:'#選擇器', mount:'#選擇器' }
       target — 要被放大的元素（預設 document.body）
       mount  — 控制列要掛進去的容器（預設右下角浮動）
   ============================================================ */
(function(){
  var cfg = window.TEXT_ZOOM_CFG || {};
  var LEVELS = [
    { k:'1',   label:'標準' },
    { k:'1.5', label:'放大' },
    { k:'2',   label:'加大' }
  ];
  function curLevel(){
    var v = '1';
    try{ v = localStorage.getItem('appedu_text_zoom') || '1'; }catch(e){}
    return LEVELS.some(function(l){ return l.k === v; }) ? v : '1';
  }
  function apply(){
    var v = curLevel(), zf = parseFloat(v) || 1;
    if(cfg.target){
      var t = document.querySelector(cfg.target);
      if(t) t.style.zoom = v;
    } else if(document.body){
      document.body.style.zoom = v;
    }
    // 浮動控制列在 body 內，body 被放大時要反向縮回，維持正常大小
    var ctrl = document.getElementById('tz-control');
    if(ctrl) ctrl.style.zoom = cfg.target ? 1 : (1 / zf);
    var btns = document.querySelectorAll('#tz-control .tz-btn');
    for(var i=0;i<btns.length;i++){
      btns[i].classList.toggle('tz-on', btns[i].getAttribute('data-z') === v);
    }
  }
  function setLevel(v){
    try{ localStorage.setItem('appedu_text_zoom', v); }catch(e){}
    apply();
  }
  function build(){
    if(document.getElementById('tz-control')) return;
    var st = document.createElement('style');
    st.textContent =
      '#tz-control{display:flex;gap:3px;align-items:center;background:rgba(20,28,46,0.94);'
    + 'border:1px solid rgba(120,160,220,0.32);border-radius:999px;padding:5px 7px;'
    + 'box-shadow:0 4px 18px rgba(0,0,0,0.32);font-family:-apple-system,"Noto Sans TC",sans-serif;}'
    + '#tz-control.tz-float{position:fixed;right:12px;bottom:12px;z-index:99995;}'
    + '#tz-control .tz-cap{font-size:11px;font-weight:800;color:#9bb3d8;margin:0 4px 0 3px;}'
    + '#tz-control .tz-btn{border:none;border-radius:999px;padding:5px 11px;font-size:12px;'
    + 'font-weight:700;cursor:pointer;background:transparent;color:#9bb3d8;font-family:inherit;line-height:1;}'
    + '#tz-control .tz-btn:hover{background:rgba(120,160,220,0.18);}'
    + '#tz-control .tz-btn.tz-on{background:#0071e3;color:#fff;}'
    + 'body.day-mode #tz-control{background:rgba(255,255,255,0.96);border-color:#d2d2d7;box-shadow:0 4px 18px rgba(0,0,0,0.12);}'
    + 'body.day-mode #tz-control .tz-cap{color:#6e6e73;}'
    + 'body.day-mode #tz-control .tz-btn{color:#6e6e73;}'
    + 'body.day-mode #tz-control .tz-btn:hover{background:#ebebed;}'
    + 'body.day-mode #tz-control .tz-btn.tz-on{background:#0071e3;color:#fff;}';
    document.head.appendChild(st);
    var box = document.createElement('div');
    box.id = 'tz-control';
    box.innerHTML = '<span class="tz-cap">文字</span>' + LEVELS.map(function(l){
      return '<button type="button" class="tz-btn" data-z="' + l.k + '">' + l.label + '</button>';
    }).join('');
    var mountEl = cfg.mount ? document.querySelector(cfg.mount) : null;
    if(mountEl){ mountEl.appendChild(box); }
    else { box.classList.add('tz-float'); document.body.appendChild(box); }
    var btns = box.querySelectorAll('.tz-btn');
    for(var i=0;i<btns.length;i++){
      btns[i].addEventListener('click', function(){ setLevel(this.getAttribute('data-z')); });
    }
  }
  function init(){ build(); apply(); }
  if(document.body) init();
  else document.addEventListener('DOMContentLoaded', init);
  // 其他頁面改了 → 即時同步
  window.addEventListener('storage', function(e){
    if(!e.key || e.key === 'appedu_text_zoom') apply();
  });
  window.applyTextZoom = apply;
})();

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
  function makeControl(floating){
    var box = document.createElement('div');
    box.className = 'tz-control' + (floating ? ' tz-float' : '');
    box.innerHTML = '<span class="tz-cap">文字</span>' + LEVELS.map(function(l){
      return '<button type="button" class="tz-btn" data-z="' + l.k + '">' + l.label + '</button>';
    }).join('');
    var bb = box.querySelectorAll('.tz-btn');
    for(var i=0;i<bb.length;i++){
      bb[i].addEventListener('click', function(){ setLevel(this.getAttribute('data-z')); });
    }
    return box;
  }
  function build(){
    if(document.querySelector('.tz-control')) return;
    var st = document.createElement('style');
    st.textContent =
      '.tz-control{display:flex;gap:3px;align-items:center;background:rgba(20,28,46,0.94);'
    + 'border:1px solid rgba(120,160,220,0.32);border-radius:999px;padding:5px 7px;'
    + 'box-shadow:0 4px 18px rgba(0,0,0,0.32);font-family:-apple-system,"Noto Sans TC",sans-serif;}'
    + '.tz-control.tz-float{position:fixed;right:12px;bottom:12px;z-index:99995;}'
    + '.tz-control .tz-cap{font-size:11px;font-weight:800;color:#9bb3d8;margin:0 4px 0 3px;}'
    + '.tz-control .tz-btn{border:none;border-radius:999px;padding:5px 11px;font-size:12px;'
    + 'font-weight:700;cursor:pointer;background:transparent;color:#9bb3d8;font-family:inherit;line-height:1;}'
    + '.tz-control .tz-btn:hover{background:rgba(120,160,220,0.18);}'
    + '.tz-control .tz-btn.tz-on{background:#0071e3;color:#fff;}'
    + 'body.day-mode .tz-control{background:rgba(255,255,255,0.96);border-color:#d2d2d7;box-shadow:0 4px 18px rgba(0,0,0,0.12);}'
    + 'body.day-mode .tz-control .tz-cap{color:#6e6e73;}'
    + 'body.day-mode .tz-control .tz-btn{color:#6e6e73;}'
    + 'body.day-mode .tz-control .tz-btn:hover{background:#ebebed;}'
    + 'body.day-mode .tz-control .tz-btn.tz-on{background:#0071e3;color:#fff;}';
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
  function init(){ build(); apply(); }
  if(document.body) init();
  else document.addEventListener('DOMContentLoaded', init);
  window.addEventListener('storage', function(e){
    if(!e.key || e.key === 'appedu_text_zoom') apply();
  });
  window.applyTextZoom = apply;
})();

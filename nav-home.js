/* ============================================================
   赫綠設計學院 - 全頁面導航列 + 登出按鈕
   ============================================================ */
(function(){
  // iframe 內不顯示
  try { if (window.parent !== window) return; } catch(e){ return; }

  var path = decodeURIComponent(location.pathname);
  var isIndex = path.endsWith('index.html') || path.endsWith('/');
  var isHome = path.indexOf('人力發展') !== -1;

  function create(){
    if (document.getElementById('navFloatBar')) return;

    // 注入 CSS
    var style = document.createElement('style');
    style.textContent = [
      '#navFloatBar {',
      '  position:fixed; bottom:16px; left:50%; transform:translateX(-50%);',
      '  z-index:99990; display:flex; gap:8px; align-items:center;',
      '  padding:6px 10px;',
      '  background:rgba(10,15,30,.85);',
      '  backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);',
      '  border:1px solid rgba(255,215,0,.2); border-radius:14px;',
      '  box-shadow:0 4px 24px rgba(0,0,0,.5);',
      '}',
      '#navFloatBar .nav-btn {',
      '  display:flex; align-items:center; gap:5px;',
      '  border-radius:10px; text-decoration:none; font-family:inherit;',
      '  cursor:pointer; transition:all .2s; white-space:nowrap; border:none;',
      '}',
      '#navFloatBar .nav-btn-home {',
      '  padding:9px 18px;',
      '  background:linear-gradient(135deg,rgba(255,215,0,.15),rgba(255,180,0,.08));',
      '  border:1px solid rgba(255,215,0,.4);',
      '  color:#ffd700; font-size:14px; font-weight:800; letter-spacing:1px;',
      '}',
      '#navFloatBar .nav-btn-overview {',
      '  padding:7px 12px;',
      '  background:rgba(255,255,255,.04);',
      '  border:1px solid rgba(160,200,255,.2);',
      '  color:rgba(160,200,255,.8); font-size:12px; font-weight:600; letter-spacing:1px;',
      '}',
      '#navFloatBar .nav-btn-logout {',
      '  padding:7px 12px;',
      '  background:rgba(255,80,80,.06);',
      '  border:1px solid rgba(255,100,100,.25);',
      '  color:rgba(255,160,160,.8); font-size:12px; font-weight:600; letter-spacing:1px;',
      '}',
      '#navFloatBar .nav-btn-logout:hover {',
      '  background:rgba(255,80,80,.15); border-color:rgba(255,100,100,.5);',
      '  color:#ff8888;',
      '}',
      '',
      '@media (max-width:768px) {',
      '  #navFloatBar { bottom:12px; padding:5px 8px; gap:6px; border-radius:12px; }',
      '  #navFloatBar .nav-btn-home { padding:7px 14px; font-size:12px; }',
      '  #navFloatBar .nav-btn-overview { padding:5px 10px; font-size:11px; }',
      '  #navFloatBar .nav-btn-logout { padding:5px 10px; font-size:11px; }',
      '}',
      '@media (max-width:480px) {',
      '  #navFloatBar { bottom:8px; padding:4px 6px; gap:5px; border-radius:10px; }',
      '  #navFloatBar .nav-btn-home { padding:6px 10px; font-size:11px; border-radius:8px; }',
      '  #navFloatBar .nav-btn-overview { padding:5px 8px; font-size:10px; border-radius:8px; }',
      '  #navFloatBar .nav-btn-logout { padding:5px 8px; font-size:10px; border-radius:8px; }',
      '}',
    ].join('\n');
    document.head.appendChild(style);

    var bar = document.createElement('div');
    bar.id = 'navFloatBar';

    // 首頁按鈕
    if (!isHome) {
      var homeBtn = document.createElement('a');
      homeBtn.href = './%E4%BA%BA%E5%8A%9B%E7%99%BC%E5%B1%95.html';
      homeBtn.className = 'nav-btn nav-btn-home';
      homeBtn.innerHTML = '🏠 首頁';
      bar.appendChild(homeBtn);
    }

    // 總覽按鈕
    if (!isIndex) {
      var overviewBtn = document.createElement('a');
      overviewBtn.href = './index.html';
      overviewBtn.className = 'nav-btn nav-btn-overview';
      overviewBtn.innerHTML = '📋 總覽';
      bar.appendChild(overviewBtn);
    }

    // 登出按鈕（所有頁面都顯示）
    var logoutBtn = document.createElement('button');
    logoutBtn.className = 'nav-btn nav-btn-logout';
    logoutBtn.innerHTML = '🚪 登出';
    logoutBtn.onclick = function(){
      sessionStorage.removeItem('appedu_session');
      localStorage.removeItem('appedu_remembered_session');
      localStorage.setItem('appedu_logout_event', Date.now().toString());
      location.href = './index.html';
    };
    bar.appendChild(logoutBtn);

    document.body.appendChild(bar);
  }

  if (document.body) create();
  else document.addEventListener('DOMContentLoaded', create);
})();

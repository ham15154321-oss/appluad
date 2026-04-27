/* ============================================================
   赫綠設計學院 — 登入狀態檢查
   ------------------------------------------------------------
   放在每個子頁面（非 index.html）的 <head>。
   沒有登入 → 跳轉到 index.html 總覽登入頁。
   iframe 內不檢查。
   ============================================================ */
(function(){
  // iframe 內不檢查
  try{ if(window.parent !== window) return; }catch(e){ return; }

  // 已經在 index.html 就不檢查
  var path = decodeURIComponent(location.pathname);
  if(path.endsWith('index.html') || path.endsWith('/')) return;

  function hasSession(){
    try{
      var s = JSON.parse(sessionStorage.getItem('appedu_session'));
      if(s && s.user) return true;
    }catch(e){}
    try{
      var r = JSON.parse(localStorage.getItem('appedu_remembered_session'));
      if(r && r.user){
        sessionStorage.setItem('appedu_session', JSON.stringify(r));
        return true;
      }
    }catch(e){}
    return false;
  }

  if(!hasSession()){
    // 未登入 → 導回總覽登入頁
    location.replace('./index.html');
  }
})();

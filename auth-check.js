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
    // ★ 主要依據：持久化登入狀態（localStorage，永遠記住）
    //   必須跟 index.html 的 getSession() 用同一組 key，否則會無限互踢造成畫面狂閃。
    //   sessionStorage 關掉瀏覽器就清空，不能拿來當唯一判斷。
    try{
      var empNo = localStorage.getItem('appedu_emp_no');
      var charName = localStorage.getItem('appedu_logged_character');
      if(empNo && charName){
        // 補回 sessionStorage，讓同分頁內其他舊程式碼也讀得到
        try{
          if(!sessionStorage.getItem('appedu_session')){
            sessionStorage.setItem('appedu_session', JSON.stringify({
              user: empNo,
              displayName: charName,
              isAdmin: localStorage.getItem('appedu_is_admin') === '1',
              loginTime: parseInt(localStorage.getItem('appedu_login_at')||'0', 10) || Date.now()
            }));
          }
        }catch(e){}
        return true;
      }
    }catch(e){}
    // 向下相容：舊的 session key
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

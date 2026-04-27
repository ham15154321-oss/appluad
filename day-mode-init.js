/* ☀️ 白天模式初始化 — 所有頁面共用
   讀取 localStorage('appedu_day_mode')，若為 '1' 則加上 day-mode class
   也監聽即時切換（從首頁切換時 iframe 會收到 storage 事件） */
(function(){
  function apply(){
    var isDay = false;
    try{ isDay = localStorage.getItem('appedu_day_mode') === '1'; }catch(e){}
    document.body.classList.toggle('day-mode', isDay);
    document.documentElement.classList.toggle('day-mode', isDay);
  }
  // 頁面載入時立即套用
  if(document.body) apply();
  else document.addEventListener('DOMContentLoaded', apply);
  // 監聽首頁即時切換
  window.addEventListener('storage', function(e){
    if(e.key === 'appedu_day_mode') apply();
  });
  // 也監聽自訂事件（同頁面切換）
  window.addEventListener('daymode-changed', apply);
})();

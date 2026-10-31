/* ═══════════════════════════════════════════════
   Appedu EIP 激勵同步 — Background Service Worker
   負責 fetch EIP 頁面（利用 extension 的 host_permissions）
   ═══════════════════════════════════════════════ */

/* ★ v5.79（10/30 Ivan）點工具列圖示打開小視窗時，順便看資料夾裡有沒有新版；有就自己重新載入（兩個 Chrome 帳號各點一次就好）
   正在讀 EIP（最後一次讀 EIP 或 keepalive 不到 3 分鐘）就先不換，避免同步讀到一半斷掉 */
var _lastEip = 0;
function _verNum(v){ return String(v || '0').split('.').map(function(x){ return +x || 0; }); }
function _newer(a, b){ var x = _verNum(a), y = _verNum(b); for (var i = 0; i < Math.max(x.length, y.length); i++){ if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; }
async function _checkUpdate(idleMs){
  var cur = chrome.runtime.getManifest().version, disk = cur;
  try { disk = (await (await fetch(chrome.runtime.getURL('manifest.json') + '?t=' + Date.now(), { cache: 'no-store' })).json()).version || cur; } catch(e){ return { state: 'error', cur: cur, error: String(e && e.message || e) }; }
  if (!_newer(disk, cur)) return { state: 'same', cur: cur };
  if (Date.now() - _lastEip < (idleMs || 120000)) { _arm(); return { state: 'busy', cur: cur, disk: disk }; }
  setTimeout(function(){ chrome.runtime.reload(); }, 400);
  return { state: 'reload', cur: cur, disk: disk };
}
/* ★ v5.84（10/31 Ivan：要自動）點圖示時剛好在讀 EIP → 記下來，每 10 秒看一次，EIP 停了 20 秒（同步跑的時候每 12 秒一定會敲一次）就自己換，最多等 15 分鐘；
   EIP 同步跑完（content.js 送 syncDone）也看一次。不加權限、不定時巡；Chrome 把背景休眠的話，下一次同步跑完或點圖示會再接上 */
var _pendT = 0, _pendUntil = 0;
function _arm(){ if (!_pendUntil || Date.now() > _pendUntil) _pendUntil = Date.now() + 15 * 60000; if (_pendT) return;
  _pendT = setTimeout(function(){ _pendT = 0; if (Date.now() > _pendUntil) { _pendUntil = 0; return; } _checkUpdate(20000); }, 10000); }

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse){
  if (msg.action === 'checkUpdate'){
    _checkUpdate().then(sendResponse);
    return true;
  }
  if (msg.action === 'syncDone'){ _lastEip = Date.now(); setTimeout(function(){ _checkUpdate(20000); }, 21000); return false; }   // v5.84 同步跑完 → 20 秒內沒有再讀 EIP 就換新版
  if (msg.action === 'keepalive' || msg.action === 'fetchEip') _lastEip = Date.now();
  // ★ v5.15：keepalive ping — content.js 每 12 秒敲一次，收到就立刻回，
  //   讓 Chrome 持續看到活動、不把 service worker 回收（逐頁抓取時避免吊死）。
  if (msg.action === 'keepalive'){
    sendResponse({ ok: true, t: Date.now() });
    return false;
  }
  if (msg.action === 'fetchEip'){
    doFetch(msg.url, msg.post)
      .then(function(html){ sendResponse({ ok: true, html: html }); })
      .catch(function(err){ sendResponse({ ok: false, error: err.message }); });
    return true; // 非同步回應
  }
});

async function doFetch(url, post){
  // ★ v5.6：加逾時 — EIP 沒回應時自動中斷，避免按鈕無限轉圈圈
  //   v5.15：30 秒→20 秒。EIP 正常 1~2 秒就回，20 秒已很寬裕；縮短可讓 content 端重試更快接手。
  var ctrl = new AbortController();
  var timer = setTimeout(function(){ ctrl.abort(); }, 20000);
  var resp;
  try {
    var opt = { credentials: 'include', signal: ctrl.signal };
    if (post){                                   // 狀態歷史記錄那支 _ajax 是 POST
      opt.method = 'POST';
      opt.headers = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' };
      opt.body = post;
    }
    resp = await fetch(url, opt);
  } catch(e){
    clearTimeout(timer);
    if (e && e.name === 'AbortError') throw new Error('EIP 逾時無回應（20 秒）— 可能忙線，請稍後再試');
    throw e;
  }
  clearTimeout(timer);
  if (!resp.ok) throw new Error('HTTP ' + resp.status + ' — 可能未登入 EIP');
  var buf = await resp.arrayBuffer();

  // EIP 系統可能用 Big5 或 UTF-8
  var textBig5 = '', textUtf8 = '';
  try { textBig5 = new TextDecoder('big5').decode(buf); } catch(e){}
  try { textUtf8 = new TextDecoder('utf-8').decode(buf); } catch(e){}

  // JSON 回應（_ajax 那幾支）一律當 UTF-8
  try { JSON.parse(textUtf8); return textUtf8; } catch(e){}
  if (textUtf8.indexOf('學院') >= 0 || textUtf8.indexOf('姓名') >= 0 || textUtf8.indexOf('業績') >= 0){
    return textUtf8;
  }
  if (textBig5.indexOf('學院') >= 0 || textBig5.indexOf('姓名') >= 0 || textBig5.indexOf('業績') >= 0){
    return textBig5;
  }
  return textUtf8 || textBig5;
}

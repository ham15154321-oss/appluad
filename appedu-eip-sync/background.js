/* ═══════════════════════════════════════════════
   Appedu EIP 激勵同步 — Background Service Worker
   負責 fetch EIP 頁面（利用 extension 的 host_permissions）
   ═══════════════════════════════════════════════ */

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse){
  // ★ v5.15：keepalive ping — content.js 每 12 秒敲一次，收到就立刻回，
  //   讓 Chrome 持續看到活動、不把 service worker 回收（逐頁抓取時避免吊死）。
  if (msg.action === 'keepalive'){
    sendResponse({ ok: true, t: Date.now() });
    return false;
  }
  if (msg.action === 'fetchEip'){
    doFetch(msg.url)
      .then(function(html){ sendResponse({ ok: true, html: html }); })
      .catch(function(err){ sendResponse({ ok: false, error: err.message }); });
    return true; // 非同步回應
  }
});

async function doFetch(url){
  // ★ v5.6：加逾時 — EIP 沒回應時自動中斷，避免按鈕無限轉圈圈
  //   v5.15：30 秒→20 秒。EIP 正常 1~2 秒就回，20 秒已很寬裕；縮短可讓 content 端重試更快接手。
  var ctrl = new AbortController();
  var timer = setTimeout(function(){ ctrl.abort(); }, 20000);
  var resp;
  try {
    resp = await fetch(url, { credentials: 'include', signal: ctrl.signal });
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

  if (textUtf8.indexOf('學院') >= 0 || textUtf8.indexOf('姓名') >= 0 || textUtf8.indexOf('業績') >= 0){
    return textUtf8;
  }
  if (textBig5.indexOf('學院') >= 0 || textBig5.indexOf('姓名') >= 0 || textBig5.indexOf('業績') >= 0){
    return textBig5;
  }
  return textUtf8 || textBig5;
}

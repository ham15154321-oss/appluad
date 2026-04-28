/* ═══════════════════════════════════════════════
   Appedu EIP 激勵同步 — Background Service Worker
   負責 fetch EIP 頁面（利用 extension 的 host_permissions）
   ═══════════════════════════════════════════════ */

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse){
  if (msg.action === 'fetchEip'){
    doFetch(msg.url)
      .then(function(html){ sendResponse({ ok: true, html: html }); })
      .catch(function(err){ sendResponse({ ok: false, error: err.message }); });
    return true; // 非同步回應
  }
});

async function doFetch(url){
  var resp = await fetch(url, { credentials: 'include' });
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

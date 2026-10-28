#!/usr/bin/env python3
"""把 page_css.css + page_body.html 組成 GitHub 上的 1340.html（版面跟 Apps Script 版一模一樣，資料改用 fetch 拿）"""
import sys, pathlib
here = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.')
out = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else here / '1340.html')
css = (here / 'page_css.css').read_text(encoding='utf-8')
body = (here / 'page_body.html').read_text(encoding='utf-8')
i = body.index('<script>'); j = body.rindex('</script>')
markup, app = body[:i], body[i + len('<script>'):j]
assert '</script' not in app.lower()

API = 'https://script.google.com/macros/s/AKfycbxBFayHnfG5NUoj0CjIe8qwlfdFwt0FQeVD-QH6ocBu3dhHWpioOEmLk908dsTGVlznYA/exec'
VER = 'p2.5'

extra_css = r"""
  /* ── 1340.html 外殼：載入中、更新提示、選區 ── */
  #pgWait{min-height:70vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;color:var(--label2);font-size:.9375rem}
  #pgWait i{width:26px;height:26px;border-radius:50%;border:2.5px solid var(--fill);border-top-color:var(--label2);animation:pgSpin .8s linear infinite}
  @keyframes pgSpin{to{transform:rotate(360deg)}}
  #pgPill{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom) + 16px);z-index:30;transform:translate(-50%,12px);opacity:0;pointer-events:none;
    background:var(--glass);-webkit-backdrop-filter:blur(22px) saturate(180%);backdrop-filter:blur(22px) saturate(180%);border:.5px solid var(--sep);box-shadow:var(--shadow);
    color:var(--label2);font:inherit;font-size:.8125rem;font-weight:600;border-radius:999px;padding:8px 14px;white-space:nowrap;transition:opacity 200ms ease,transform 260ms cubic-bezier(.2,.9,.25,1)}
  #pgPill.on{opacity:1;transform:translate(-50%,0)}
  #pgPill.tap{pointer-events:auto;color:var(--blue)}
  #pgPill.tap:active{transform:translate(-50%,0) scale(.96)}
  #pgPick{min-height:100vh;display:flex;flex-direction:column;justify-content:center;gap:14px;padding:24px 16px;max-width:420px;margin:0 auto}
  #pgPick[hidden],#appRoot[hidden]{display:none}
  #pgPick h1{margin:0 0 6px;font-size:1.75rem;letter-spacing:-.022em}
  #pgPick a{display:block;background:var(--card);box-shadow:var(--shadow);border-radius:18px;padding:20px;color:var(--label);text-decoration:none;font-size:1.25rem;font-weight:700;transition:transform 100ms ease-out}
  #pgPick a:active{transform:scale(.97)}
  #pgPick a small{display:block;font-size:.8125rem;font-weight:500;color:var(--label2);margin-top:4px}
  @media (prefers-reduced-motion:reduce){#pgWait i{animation:none}#pgPill{transition:none}}
"""

loader = r"""
(function(){
  var API = '__API__';
  window.PG_API = API;   // p2.0：會議模式三區總覽要拿另外兩區
  var q = new URLSearchParams(location.search), r = q.get('r') || '', d = q.get('d') || '';
  var root = document.getElementById('appRoot'), wait = document.getElementById('pgWait'), pill = document.getElementById('pgPill');
  var RG = { '中區': ['中區', '13:40'], '建國': ['高雄建國', '13:40'], '桃區': ['桃區', '13:30'] };   // p1.2 加桃區
  if (!RG[r]) {   // 沒帶 ?r= → 選區
    wait.remove(); root.remove();
    var pk = document.getElementById('pgPick'); pk.hidden = false;
    pk.querySelectorAll('a').forEach(function(a){ a.href = location.pathname + '?r=' + encodeURIComponent(a.dataset.r); });
    return;
  }
  document.getElementById('pgPick').remove();
  document.title = RG[r][0] + ' ' + RG[r][1];
  document.getElementById('pgWaitT').textContent = RG[r][0] + ' ' + RG[r][1] + ' 載入中…';
  var KEY = r + '|' + (d || 'latest');
  var APP = document.getElementById('appSrc').textContent, PRISTINE = root.innerHTML;
  var shown = '', touched = false, pillT = 0, fresh = false;
  ['touchstart', 'pointerdown', 'wheel', 'keydown'].forEach(function(ev){ window.addEventListener(ev, function(){ touched = true; }, { passive:true, once:true }); });

  function say(t, tap, ms){
    clearTimeout(pillT); pill.onclick = tap || null; pill.classList.toggle('tap', !!tap);
    if (!t) { pill.classList.remove('on'); return; }
    pill.textContent = t; pill.classList.add('on');
    if (ms) pillT = setTimeout(function(){ pill.classList.remove('on'); }, ms);
  }
  function run(txt){
    var data; try { data = JSON.parse(txt); } catch (e) { return false; }
    if (!data || data.ok === false || !data.r) return false;
    data.baseUrl = location.pathname;   // 日期選單換日用
    window.DATA = data;
    if (shown) {   // 第二次畫：版面換回乾淨的，window／document 上的監聽第一次就掛好了，不重複掛
      root.innerHTML = PRISTINE;
      var wa = window.addEventListener, da = document.addEventListener;
      window.addEventListener = function(){}; document.addEventListener = function(){};
      try { (0, eval)(APP); } finally { delete window.addEventListener; delete document.addEventListener; if (window.addEventListener !== wa) window.addEventListener = wa; if (document.addEventListener !== da) document.addEventListener = da; }
    } else {
      wait.remove(); root.hidden = false;
      (0, eval)(APP);
    }
    shown = txt; return true;
  }

  /* 上一次的資料記在 IndexedDB（這個網站的 localStorage 已經被業績數據中心塞滿） */
  var dbP = new Promise(function(res){
    try { var o = indexedDB.open('pg1340', 1); o.onupgradeneeded = function(){ o.result.createObjectStore('kv'); };
      o.onsuccess = function(){ res(o.result); }; o.onerror = function(){ res(null); }; o.onblocked = function(){ res(null); };
    } catch (e) { res(null); }
  });
  function dbGet(k){ return dbP.then(function(db){ return db ? new Promise(function(res){
    try { var g = db.transaction('kv').objectStore('kv').get(k); g.onsuccess = function(){ res(g.result || null); }; g.onerror = function(){ res(null); }; } catch (e) { res(null); } }) : null; }); }
  function dbPut(k, v){ dbP.then(function(db){ if (db) try { db.transaction('kv', 'readwrite').objectStore('kv').put(v, k); } catch (e) {} }); }

  dbGet(KEY).then(function(c){ if (c && !shown && run(c) && !fresh) say('更新中…'); });

  var ctl = window.AbortController ? new AbortController() : null;
  if (ctl) setTimeout(function(){ ctl.abort(); }, 40000);
  fetch(API + '?r=' + encodeURIComponent(r) + (d ? '&d=' + encodeURIComponent(d) : '') + '&fmt=json', { cache:'no-store', signal: ctl ? ctl.signal : undefined })
    .then(function(x){ return x.text(); })
    .then(function(t){
      if (t.charAt(0) !== '{') throw new Error('not json');
      var o = JSON.parse(t); if (o.ok === false || !o.r) throw new Error(o.error || 'bad');
      fresh = true; dbPut(KEY, t);
      if (t === shown) { say(''); return; }
      var had = !!shown;
      if (!had || !touched) { run(t); say(had ? '已更新' : '', null, 1200); return; }
      // p2.3：議程、日期、同步時間換了 → 不等使用者點，直接換掉（留在原本看的位置）
      var old = {}; try { old = JSON.parse(shown); } catch (e) {}
      if (old.agendaDate !== o.agendaDate || old.date !== o.date || old.syncAt !== o.syncAt) {
        var y = window.scrollY; run(t); window.scrollTo(0, y); say('已換成最新資料', null, 1800); return;
      }
      say('有新資料・點一下更新', function(){ run(t); window.scrollTo(0, 0); say('已更新', null, 1200); });
    })
    .catch(function(){
      fresh = true;
      dbGet(KEY).then(function(){   // 等上一次的資料讀完再決定
        if (shown) say('連不上，先顯示上次的資料', null, 4000);
        else document.getElementById('pgWaitT').textContent = '連不上，等一下再重新整理';
      });
    });
})();
""".replace('__API__', API)

html = f"""<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<meta name="pg1340-version" content="{VER}">
<title>13:40</title>
<link rel="preconnect" href="https://script.google.com">
<link rel="preconnect" href="https://script.googleusercontent.com" crossorigin>
<style>{css}{extra_css}</style>
</head>
<body>
<!-- 13:40 日會網頁｜{VER}｜版面原始檔：1340網頁版面/page_css.css、page_body.html（改版面改那兩個，再跑 build1340.py 重組）｜資料：Apps Script 業績數據橋接 ?r=&fmt=json -->
<div id="pgWait"><i></i><span id="pgWaitT">載入中…</span></div>
<div id="pgPick" hidden><h1>日會</h1><a data-r="中區">中區<small>台一・台二・台三｜13:40</small></a><a data-r="桃區">桃區<small>壢一・壢二・壢三｜13:30</small></a><a data-r="建國">高雄建國<small>建國｜13:40</small></a></div>
<div id="appRoot" hidden>
{markup}</div>
<button id="pgPill" type="button"></button>
<script type="text/plain" id="appSrc">{app}</script>
<script>{loader}</script>
</body>
</html>
"""
out.write_text(html, encoding='utf-8')
print(out, len(html))

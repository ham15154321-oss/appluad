// Anthropic API Proxy — Cloudflare Workers
// ------------------------------------------------------------
// 你的 API key 只存在 Worker 的 secret 裡，永遠不會出現在前端原始碼。
// 前端打 https://<your-worker>.workers.dev/v1/...，proxy 轉發到 api.anthropic.com。
//
// 支援：
//   - 任何 endpoint（/v1/messages、/v1/models、/v1/messages/batches…）
//   - SSE 串流（streaming 回應自動 pass-through）
//   - CORS preflight + origin 白名單
// ------------------------------------------------------------

const ANTHROPIC_HOST = 'https://api.anthropic.com';

// ⚠️ 改成你自己的網域。本機開發保留 localhost。
// 部署完之後務必把 'https://your-site.example.com' 換掉。
const ALLOWED_ORIGINS = [
  'https://ham15154321-oss.github.io', // ← 你的 GitHub Pages（user/org 頁與 project 頁同 origin）
  // 本機開發伺服器（涵蓋常見 port，避免每次新工具又要回來加白名單）
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:4000',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5500',
  'http://localhost:8000',
  'http://localhost:8001',
  'http://localhost:8080',
  'http://localhost:8081',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5500',
  'http://127.0.0.1:8000',
  'http://127.0.0.1:8001',
  'http://127.0.0.1:8080',
  'null', // 用 file:// 直接打開 HTML 時 Origin 會是 'null'
];

// 從 client 收到的這些 header 一律不轉發給 Anthropic
// （避免被夾帶 key、cookie、假造 IP、或讓 Anthropic 誤判成瀏覽器直連）
const STRIP_REQ_HEADERS = new Set([
  // 連線相關
  'host',
  'cf-connecting-ip',
  'cf-ipcountry',
  'cf-ray',
  'cf-visitor',
  'cf-worker',
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-real-ip',
  // 認證相關（key 由 Worker 注入，不接受前端傳）
  'authorization',
  'x-api-key',
  'cookie',
  // 瀏覽器專屬 — 必須剔除，否則 Anthropic 會把 Worker 誤判為瀏覽器直連
  // 並要求 anthropic-dangerous-direct-browser-access header
  'origin',
  'referer',
  'user-agent',
  'sec-fetch-mode',
  'sec-fetch-site',
  'sec-fetch-dest',
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'accept-language',
  'accept-encoding',
  'pragma',
  'cache-control',
]);

function buildCors(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, anthropic-version, anthropic-beta, anthropic-dangerous-direct-browser-access',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function jsonResponse(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = buildCors(origin);

    // 1) CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // 2) Origin 白名單（瀏覽器才會帶 Origin；server-to-server 沒有 Origin 時放行）
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return jsonResponse(
        { error: { type: 'forbidden', message: 'Origin not allowed' } },
        403,
        cors,
      );
    }

    // 3) 健康檢查
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/healthz') {
      return jsonResponse({ ok: true, proxy: 'anthropic' }, 200, cors);
    }

    // 4) 只允許轉發 /v1/* 路徑（避免 proxy 變成開放轉發器）
    if (!url.pathname.startsWith('/v1/')) {
      return jsonResponse(
        { error: { type: 'not_found', message: 'Only /v1/* is proxied' } },
        404,
        cors,
      );
    }

    // 5) 準備上游請求
    const upstreamUrl = ANTHROPIC_HOST + url.pathname + url.search;

    const fwdHeaders = new Headers();
    for (const [k, v] of request.headers) {
      if (!STRIP_REQ_HEADERS.has(k.toLowerCase())) {
        fwdHeaders.set(k, v);
      }
    }
    // 注入後端憑證
    if (!env.ANTHROPIC_API_KEY) {
      return jsonResponse(
        { error: { type: 'config_error', message: 'ANTHROPIC_API_KEY not set on worker' } },
        500,
        cors,
      );
    }
    fwdHeaders.set('x-api-key', env.ANTHROPIC_API_KEY);
    if (!fwdHeaders.has('anthropic-version')) {
      fwdHeaders.set('anthropic-version', '2023-06-01');
    }

    // 6) 轉發（body 用串流，streaming endpoint 也能直接 pass-through）
    let upstream;
    try {
      upstream = await fetch(upstreamUrl, {
        method: request.method,
        headers: fwdHeaders,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      });
    } catch (err) {
      return jsonResponse(
        { error: { type: 'upstream_error', message: String(err) } },
        502,
        cors,
      );
    }

    // 7) 把 response 串回 client，保留 streaming
    const respHeaders = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(cors)) respHeaders.set(k, v);
    // hop-by-hop / 由 Workers 自行處理
    respHeaders.delete('content-encoding');
    respHeaders.delete('content-length');

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    });
  },
};

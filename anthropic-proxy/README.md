# Anthropic Proxy（Cloudflare Workers）

把 Anthropic API key 從前端搬到後端的最小成本方案。前端打你的 Worker，Worker 帶 key 去打 `api.anthropic.com`。Key 永遠不會出現在公開原始碼。

## 安全特性

- API key 存在 Cloudflare Secret，**不會進 git**。
- Origin 白名單（`ALLOWED_ORIGINS`）：只有你的網域能呼叫。
- 拒絕轉發 `/v1/*` 以外的路徑，避免變開放轉發器。
- 從 client 收到的 `x-api-key` / `Authorization` 一律剝除，前端塞 key 也沒用。

## 一次性準備

1. 申請 Cloudflare 免費帳號：<https://dash.cloudflare.com/sign-up>
2. 安裝 Node.js（>= 18）。
3. 進這個資料夾安裝 wrangler：
   ```bash
   cd anthropic-proxy
   npm install
   npx wrangler login
   ```

## 改設定

打開 `src/index.js`，把 `ALLOWED_ORIGINS` 換成你的網域。本機開發用的 localhost 可以保留：

```js
const ALLOWED_ORIGINS = [
  'https://your-username.github.io', // ← 你的 GitHub Pages
  'http://localhost:5173',
];
```

## 本機測試

1. 複製 `.dev.vars.example` → `.dev.vars`，填入 **新申請、還沒外洩** 的 key。
2. 啟動：
   ```bash
   npm run dev
   ```
3. Worker 會跑在 `http://localhost:8787`。把 `frontend-example.html` 裡的 `PROXY_BASE` 改成 `http://localhost:8787`，用瀏覽器打開測試。

## 正式部署

```bash
npx wrangler secret put ANTHROPIC_API_KEY
# 互動式貼入新 key，存進 Cloudflare Secret，不會進 git

npm run deploy
```

部署完會給你一個 `https://anthropic-proxy.<你的子網域>.workers.dev` 網址。把 `frontend-example.html` 裡的 `PROXY_BASE` 換成這個。

## 前端改法

原本前端直接打：
```js
fetch('https://api.anthropic.com/v1/messages', {
  headers: { 'x-api-key': 'sk-ant-...' /* ← 這裡會被掃 */ },
  body: ...,
});
```

改成打 proxy（**完全不帶 key**）：
```js
fetch('https://anthropic-proxy.YOUR-SUBDOMAIN.workers.dev/v1/messages', {
  headers: { 'Content-Type': 'application/json' },
  body: ...,
});
```

`anthropic-version` 之類的 header 不用設，proxy 會自動補。

## Streaming（打字機效果）

完全支援。`stream: true` 的回應會原樣 pass-through，前端用 `getReader()` 解 SSE 即可。範例見 `frontend-example.html` 的 `callStream()`。

## 觀察 / Debug

```bash
npx wrangler tail
```

即時看 Worker log。

## 之後想加更多防護？

- **Rate limit**：用 [Cloudflare Workers Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)，幾行設定就好。
- **Shared secret**：前端帶 `X-Client-Token`，Worker 比對 `env.CLIENT_TOKEN`，不對就 401。
- **Cloudflare Turnstile**：前端先過 captcha 拿 token，Worker 驗證 token 後才放行。

## 資料夾結構

```
anthropic-proxy/
├── src/
│   └── index.js          ← Worker 主程式
├── wrangler.toml         ← Cloudflare 設定
├── package.json          ← npm scripts
├── .gitignore            ← 排除 .dev.vars / node_modules
├── .dev.vars.example     ← 本機 key 範本
├── frontend-example.html ← 串接範例（一次回 + streaming）
└── README.md
```

## 部署成本

Cloudflare Workers 免費方案：每天 100,000 次請求。一般個人專案完全夠用。

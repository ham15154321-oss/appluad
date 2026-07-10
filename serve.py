#!/usr/bin/env python3
# 太空指揮部本機伺服器 — 永遠提供最新檔案（關閉瀏覽器快取，改完程式重新整理就生效）
import http.server
import socketserver

PORT = 8000

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # 安靜模式，不洗版

socketserver.ThreadingTCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(("", PORT), NoCacheHandler) as httpd:
    print(f"🚀 太空指揮部 http://localhost:{PORT}/ 已啟動（無快取模式 — 檔案改完重新整理就是最新版）")
    print("⚠️  這個視窗請勿關閉。要停止請按 Control + C。")
    httpd.serve_forever()

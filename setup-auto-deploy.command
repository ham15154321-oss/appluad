#!/bin/bash
# ═══════════════════════════════════════
# 自動部署 開關
# 第一次雙擊：啟用（編輯任何檔案後 30 秒自動推送）
# 第二次雙擊：停用
# ═══════════════════════════════════════

LABEL="com.ivan.appluad.autodeploy"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
WATCH_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/基本功/營銷部每月簡報/2022年/遊戲化實踐版"
SCRIPT="$WATCH_DIR/auto-deploy.sh"

echo ""
echo "════════════════════════════════"
echo " appluad 自動部署 開關"
echo "════════════════════════════════"
echo ""

# ─── 偵測目前狀態 ─────────────────────────────────────
if launchctl list | grep -q "$LABEL"; then
  STATUS="enabled"
elif [ -f "$PLIST" ]; then
  STATUS="installed_not_loaded"
else
  STATUS="disabled"
fi

# ─── 已啟用 → 詢問是否停用 ────────────────────────────
if [ "$STATUS" = "enabled" ] || [ "$STATUS" = "installed_not_loaded" ]; then
  echo "目前狀態：✅ 自動部署 已啟用"
  echo ""
  read -p "要停用嗎？(y/N) " yn
  if [ "$yn" = "y" ] || [ "$yn" = "Y" ]; then
    launchctl unload "$PLIST" 2>/dev/null
    rm -f "$PLIST"
    echo ""
    echo "❌ 自動部署 已停用"
    echo "   之後改檔案不會自動推送，要手動雙擊 deploy.command"
  else
    echo ""
    echo "保持啟用狀態，沒有變動。"
  fi
  echo ""
  read -p "按 Enter 關閉..."
  exit 0
fi

# ─── 未啟用 → 啟用 ────────────────────────────────────
echo "目前狀態：⭕ 自動部署 未啟用"
echo ""

# 檢查必要檔案
if [ ! -f "$SCRIPT" ]; then
  echo "❌ 找不到 auto-deploy.sh：$SCRIPT"
  echo "   請確認資料夾裡有這個檔案"
  read -p "按 Enter 關閉..."
  exit 1
fi
chmod +x "$SCRIPT"

# 檢查 Desktop appluad
if [ ! -d "$HOME/Desktop/appluad/.git" ]; then
  echo "❌ 找不到 ~/Desktop/appluad（git repo）"
  echo "   請先用 deploy.command 至少手動部署一次，確認 GitHub 登入有效"
  read -p "按 Enter 關閉..."
  exit 1
fi

echo "啟用後，背景每 60 秒會自動檢查一次。"
echo "有變更就推送到 GitHub，沒變更就什麼都不做。"
echo ""
read -p "確認啟用？(Y/n) " yn
if [ "$yn" = "n" ] || [ "$yn" = "N" ]; then
  echo "取消，沒有啟用。"
  read -p "按 Enter 關閉..."
  exit 0
fi

# 寫入 plist
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/propertylist-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$SCRIPT</string>
    </array>
    <key>StartInterval</key>
    <integer>60</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$HOME/Library/Logs/appluad-autodeploy-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>$HOME/Library/Logs/appluad-autodeploy-stderr.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>HOME</key>
        <string>$HOME</string>
    </dict>
</dict>
</plist>
EOF

# 載入
launchctl unload "$PLIST" 2>/dev/null
if launchctl load "$PLIST" 2>&1; then
  echo ""
  echo "✅ 自動部署 已啟用！"
  echo ""
  echo "📌 背景每 60 秒檢查一次，有變更就自動推送到 GitHub。"
  echo "📌 推送完成 / 失敗 都會跳 macOS 通知。"
  echo "📌 紀錄檔：~/Library/Logs/appluad-autodeploy.log"
  echo "📌 想立刻部署不等：雙擊 deploy.command（手動觸發）"
  echo "📌 想停用：再雙擊一次這個 setup-auto-deploy.command"
else
  echo ""
  echo "❌ 啟用失敗，請把整個視窗截圖給 Claude"
fi

echo ""
read -p "按 Enter 關閉..."

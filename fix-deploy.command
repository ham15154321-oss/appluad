#!/bin/bash
# ═══════════════════════════════════════
# 修復部署 — 當 deploy.command 跳出 [rejected] / failed to push 時使用
# 雙擊執行即可：自動把本機對齊 GitHub，再重新部署
# ═══════════════════════════════════════

SRC="$HOME/Library/Mobile Documents/com~apple~CloudDocs/基本功/營銷部每月簡報/2022年/遊戲化實踐版"
DEST="$HOME/Desktop/appluad"

echo ""
echo "🔧 修復部署中..."
echo "════════════════════════════════"

# 檢查來源 / 目標
if [ ! -d "$SRC" ]; then
  echo "❌ 找不到來源資料夾：$SRC"
  read -p "按 Enter 關閉..."
  exit 1
fi
if [ ! -d "$DEST/.git" ]; then
  echo "❌ 找不到 Git repo：$DEST"
  echo "   請確認桌面有 appluad 資料夾且已 git init"
  read -p "按 Enter 關閉..."
  exit 1
fi

cd "$DEST"

# 步驟 1：把 Desktop 那邊「強制對齊」到 GitHub 最新狀態
echo "📥 從 GitHub 拉取最新狀態..."
git fetch origin
if [ $? -ne 0 ]; then
  echo "❌ 拉取失敗（檢查網路或 GitHub 登入）"
  read -p "按 Enter 關閉..."
  exit 1
fi

echo "🔄 重置本機到 origin/main（捨棄上次失敗的 commit）..."
git reset --hard origin/main

# 步驟 2：把 iCloud 的最新內容覆蓋過去
echo "📂 同步 iCloud 檔案..."
rsync -av --delete \
  --exclude='.git' \
  --exclude='.DS_Store' \
  --exclude='node_modules' \
  --exclude='deploy.command' \
  --exclude='fix-deploy.command' \
  "$SRC/" "$DEST/"

echo ""
echo "📦 推送到 GitHub..."
git add -A

if git diff --cached --quiet; then
  echo "✅ 沒有新的變更，已經是最新版本！"
  read -p "按 Enter 關閉..."
  exit 0
fi

MSG="修復部署 $(date '+%Y/%m/%d %H:%M')"
git commit -m "$MSG"
git push

if [ $? -eq 0 ]; then
  echo ""
  echo "════════════════════════════════"
  echo "✅ 修復部署成功！"
  echo "🌐 網址：https://ham15154321-oss.github.io/appluad/"
  echo "   GitHub Pages 約 1～2 分鐘後更新"
  echo "════════════════════════════════"
else
  echo ""
  echo "❌ 推送還是失敗，請把整個視窗截圖給 Claude 看"
fi

echo ""
read -p "按 Enter 關閉..."

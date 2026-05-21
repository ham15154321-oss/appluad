#!/bin/bash
# ═══════════════════════════════════════
# 一鍵部署到 GitHub Pages（整合版）
# 雙擊此檔案即可自動部署，下列三種情境全部自動處理：
#   1. 平常更新：rsync iCloud → Desktop → commit → push
#   2. push 被拒（remote 比 local 新）：自動 fetch + reset + 重推
#   3. 沒有新變更但要強制觸發 GitHub Pages 重建：詢問是否做空 commit
# ═══════════════════════════════════════

SRC="$HOME/Library/Mobile Documents/com~apple~CloudDocs/基本功/營銷部每月簡報/2022年/遊戲化實踐版"
DEST="$HOME/Desktop/appluad"

echo ""
echo "🚀 開始部署到 GitHub Pages..."
echo "════════════════════════════════"

# ─── 檢查路徑 ─────────────────────────────────────────
if [ ! -d "$SRC" ]; then
  echo "❌ 找不到來源資料夾：$SRC"
  read -p "按 Enter 關閉..."
  exit 1
fi
if [ ! -d "$DEST/.git" ]; then
  echo "❌ 找不到 Git repo：$DEST"
  read -p "按 Enter 關閉..."
  exit 1
fi

# ─── 共用：rsync iCloud → Desktop ────────────────────
do_rsync() {
  rsync -av --delete \
    --exclude='.git' \
    --exclude='.DS_Store' \
    --exclude='node_modules' \
    --exclude='*.command' \
    --exclude='auto-deploy.sh' \
    --exclude='*.log' \
    "$SRC/" "$DEST/"
}

# ─── Step 1：同步檔案 ─────────────────────────────────
echo "📂 同步 iCloud 檔案到 Desktop..."
do_rsync

cd "$DEST"

# 確保 .nojekyll 存在（讓 GitHub Pages 跳過 Jekyll 處理）
touch .nojekyll

# ─── Step 2：嘗試 commit ──────────────────────────────
echo ""
echo "📦 檢查變更..."
git add -A

if git diff --cached --quiet; then
  # 沒有新變更 → 詢問是否強制觸發 GitHub Pages 重建
  echo "ℹ️  沒有新檔案變更。"
  echo ""
  echo "是否要強制觸發 GitHub Pages 重建？"
  echo "  （適用於：已部署但 GitHub Pages 顯示舊版、build 卡住等狀況）"
  read -p "輸入 y 強制重建，其他鍵直接結束：" yn
  if [ "$yn" != "y" ] && [ "$yn" != "Y" ]; then
    echo "✅ 已是最新版本，結束。"
    read -p "按 Enter 關閉..."
    exit 0
  fi
  MSG="觸發 Pages 重建 $(date '+%Y/%m/%d %H:%M:%S')"
  git commit --allow-empty -m "$MSG"
else
  MSG="更新 $(date '+%Y/%m/%d %H:%M')"
  git commit -m "$MSG"
fi

# ─── Step 3：嘗試 push ────────────────────────────────
echo ""
echo "🚀 推送到 GitHub..."
PUSH_OUTPUT=$(git push 2>&1)
PUSH_RESULT=$?
echo "$PUSH_OUTPUT"

# 推送成功 → 結束
if [ $PUSH_RESULT -eq 0 ]; then
  echo ""
  echo "════════════════════════════════"
  echo "✅ 部署成功！"
  echo "🌐 網址：https://ham15154321-oss.github.io/appluad/"
  echo "🔍 build 進度：https://github.com/ham15154321-oss/appluad/actions"
  echo "════════════════════════════════"
  read -p "按 Enter 關閉..."
  exit 0
fi

# ─── Step 4：push 被拒 → 自動修復重推 ─────────────────
if echo "$PUSH_OUTPUT" | grep -qE 'rejected|fetch first|non-fast-forward'; then
  echo ""
  echo "⚠️  GitHub 上有更新的 commit，自動修復中..."
  echo "📥 拉取 origin/main..."
  if ! git fetch origin; then
    echo "❌ 拉取失敗（檢查網路或 GitHub 登入）"
    read -p "按 Enter 關閉..."
    exit 1
  fi

  echo "🔄 重置本機到 origin/main 並重新部署..."
  git reset --hard origin/main

  do_rsync
  touch .nojekyll
  git add -A

  if git diff --cached --quiet; then
    MSG2="觸發 Pages 重建 $(date '+%Y/%m/%d %H:%M:%S')"
    git commit --allow-empty -m "$MSG2"
  else
    MSG2="修復部署 $(date '+%Y/%m/%d %H:%M')"
    git commit -m "$MSG2"
  fi

  echo ""
  echo "🚀 重新推送..."
  if git push; then
    echo ""
    echo "════════════════════════════════"
    echo "✅ 修復部署成功！"
    echo "🌐 網址：https://ham15154321-oss.github.io/appluad/"
    echo "════════════════════════════════"
  else
    echo ""
    echo "❌ 修復後推送還是失敗，請把整個視窗截圖給 Claude"
  fi
else
  echo ""
  echo "❌ 推送失敗（不是常見的 reject 錯誤）"
  echo "   請把整個視窗截圖給 Claude 看細節"
fi

echo ""
read -p "按 Enter 關閉..."

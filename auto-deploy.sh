#!/bin/bash
# ═══════════════════════════════════════
# 自動部署核心：被 launchd 在檔案變更時呼叫
# 不要手動執行；要啟用/停用請雙擊 setup-auto-deploy.command
# ═══════════════════════════════════════

SRC="$HOME/Library/Mobile Documents/com~apple~CloudDocs/基本功/營銷部每月簡報/2022年/遊戲化實踐版"
DEST="$HOME/Desktop/appluad"
LOG="$HOME/Library/Logs/appluad-autodeploy.log"
LOCKFILE="/tmp/appluad-autodeploy.lock"

mkdir -p "$(dirname "$LOG")"
log() { echo "[$(date '+%m/%d %H:%M:%S')] $1" >> "$LOG"; }
notify() {
  osascript -e "display notification \"$2\" with title \"appluad\" subtitle \"$1\"" 2>/dev/null
}

# ─── 防止同時執行多個 ─────────────────────────────────
if [ -f "$LOCKFILE" ]; then
  LOCK_PID=$(cat "$LOCKFILE" 2>/dev/null)
  if [ -n "$LOCK_PID" ] && ps -p "$LOCK_PID" > /dev/null 2>&1; then
    log "另一個實例在跑（PID $LOCK_PID），跳過"
    exit 0
  fi
fi
echo $$ > "$LOCKFILE"
trap "rm -f $LOCKFILE" EXIT

# ─── Debounce：等 30 秒讓使用者完成編輯 ───────────────
sleep 30

log "──── 開始 auto-deploy ────"

# ─── 路徑檢查 ─────────────────────────────────────────
if [ ! -d "$SRC" ]; then
  log "❌ 找不到來源：$SRC"
  exit 1
fi
if [ ! -d "$DEST/.git" ]; then
  log "❌ 找不到 Git repo：$DEST"
  notify "部署失敗" "找不到 ~/Desktop/appluad"
  exit 1
fi

# ─── 共用 rsync ───────────────────────────────────────
do_rsync() {
  rsync -a --delete \
    --exclude='.git' \
    --exclude='.DS_Store' \
    --exclude='node_modules' \
    --exclude='*.command' \
    --exclude='auto-deploy.sh' \
    --exclude='*.log' \
    "$SRC/" "$DEST/" >> "$LOG" 2>&1
}

# ─── Step 1：同步 ─────────────────────────────────────
do_rsync
cd "$DEST" || exit 1
touch .nojekyll
git add -A >> "$LOG" 2>&1

# ─── Step 2：判斷變更 ─────────────────────────────────
if git diff --cached --quiet; then
  log "ℹ️  無變更，跳過（自動部署不會做空 commit）"
  exit 0
fi

# 列出有哪些檔案變更（給通知用）
CHANGED=$(git diff --cached --name-only | head -3 | sed 's|.*/||' | tr '\n' ',' | sed 's/,$//')
NUM=$(git diff --cached --name-only | wc -l | tr -d ' ')

# ─── Step 3：commit + push ────────────────────────────
MSG="自動部署 $(date '+%Y/%m/%d %H:%M')"
git commit -m "$MSG" >> "$LOG" 2>&1
log "📦 commit 完成（$NUM 檔變更：$CHANGED）"

PUSH_OUTPUT=$(git push 2>&1)
PUSH_RESULT=$?
echo "$PUSH_OUTPUT" >> "$LOG"

if [ $PUSH_RESULT -eq 0 ]; then
  log "✅ 推送成功"
  notify "已部署" "$NUM 檔變更（$CHANGED）"
  exit 0
fi

# ─── Step 4：push 被拒 → 自動修復 ─────────────────────
if echo "$PUSH_OUTPUT" | grep -qE 'rejected|fetch first|non-fast-forward'; then
  log "⚠️  push 被拒，自動修復..."
  git fetch origin >> "$LOG" 2>&1
  git reset --hard origin/main >> "$LOG" 2>&1
  do_rsync
  touch .nojekyll
  git add -A >> "$LOG" 2>&1
  if git diff --cached --quiet; then
    git commit --allow-empty -m "$MSG" >> "$LOG" 2>&1
  else
    git commit -m "$MSG" >> "$LOG" 2>&1
  fi
  if git push >> "$LOG" 2>&1; then
    log "✅ 修復後推送成功"
    notify "修復後已部署" "$NUM 檔變更"
  else
    log "❌ 修復後仍失敗"
    notify "部署失敗" "請查看 $LOG"
  fi
else
  log "❌ 推送失敗（非 reject 錯誤）"
  notify "部署失敗" "請查看 $LOG"
fi

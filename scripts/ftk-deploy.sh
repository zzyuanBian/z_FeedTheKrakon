#!/usr/bin/env bash
# ftk-deploy.sh — pull latest main, rebuild, restart the game under pm2.
# Called by the GitHub webhook listener (webhook.js); safe to run by hand.
#
# Design notes:
# - Only fast-forwards; if the working tree diverged (hotfix on the box),
#   the pull fails and NOTHING is restarted — the old game keeps running.
# - Rebuild failure also keeps the old process alive (build first, then swap).
# - The game holds rooms in memory: every restart wipes live matches. This
#   is accepted (same as Railway redeploy); a deploy with no changes exits
#   early WITHOUT restarting, so webhook retries are harmless.

set -euo pipefail
cd "$(dirname "$0")"

echo "[deploy] $(date '+%F %T') checking for updates…"

OLD_HEAD=$(git rev-parse HEAD)

# Fetch + fast-forward only. `--ff-only` turns an accidental divergence into
# a clean failure instead of a merge commit nobody reviews.
git fetch origin main
if [ "$(git rev-parse origin/main)" = "$OLD_HEAD" ]; then
  echo "[deploy] already up to date ($OLD_HEAD), nothing to do"
  exit 0
fi

git merge --ff-only origin/main
NEW_HEAD=$(git rev-parse HEAD)
echo "[deploy] $OLD_HEAD -> $NEW_HEAD"

echo "[deploy] installing deps (if lockfile changed)…"
npm install --no-audit --no-fund

echo "[deploy] building client…"
npm run build --workspace=@ftk/client

echo "[deploy] restarting ftk…"
pm2 restart ftk --update-env

echo "[deploy] done: live at $(git describe --always)"

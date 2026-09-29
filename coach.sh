#!/usr/bin/env bash
# OpenFront Coach build — local, singleplayer-only training copy of OpenFront.
#
#   ./coach.sh install   # one-off: clone OpenFront, apply the coach patch, install deps
#   ./coach.sh start     # run it, then open http://localhost:9000 in Chrome
#   ./coach.sh update    # try the latest OpenFront; falls back to the pinned version
#   ./coach.sh pull      # get the latest coach from GitHub and re-apply it (fast)
#   ./coach.sh review <game ID or URL> "<your name>"
#                        # replay a finished online game and write a review log
#
# Needs: git, and any Node.js (e.g. `brew install node`). The script fetches the
# exact Node 24 / npm 12 that OpenFront requires into the project folder.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="${OPENFRONT_COACH_DIR:-$HOME/openfront-coach/game}"
TOOLS="$HOME/openfront-coach/.toolchain"
REPO="${OPENFRONT_REPO:-https://github.com/openfrontio/OpenFrontIO.git}"
PIN="4d8608d7e3516bcae5152c75d54f7dd70e23bbb3" # tested 26 Sep 2026
PATCH="$HERE/coach.patch"
REPLAY="$HOME/openfront-coach/replay"
REVIEWS="$HOME/openfront-coach/reviews"
NAMEFILE="$HOME/openfront-coach/.player-name"

say() { printf '\033[1;36m[coach]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[coach]\033[0m %s\n' "$*" >&2; exit 1; }

toolchain() {
  command -v git >/dev/null || die "git not found — run: xcode-select --install"
  command -v npm >/dev/null || die "Node.js not found — run: brew install node"
  if [ ! -x "${TOOLS}/node_modules/.bin/node" ] || [ ! -x "${TOOLS}/node_modules/.bin/npm" ]; then
    say "Fetching Node 24 + npm 12 into ${TOOLS} (one-off)..."
    mkdir -p "${TOOLS}"
    npm install --prefix "${TOOLS}" --no-save --silent node@24 npm@12
  fi
  export PATH="${TOOLS}/node_modules/.bin:$PATH"
  say "Using node $(node -v), npm $(npm -v)"
}

apply_patch() {
  cd "${DIR}"
  # Wipe any previous coach patch (including staged files) before re-applying.
  git reset -q --hard HEAD
  git clean -fdq src/client/coach 2>/dev/null || true
  git apply "$PATCH"
}

install() {
  toolchain
  if [ ! -d "${DIR}/.git" ]; then
    say "Cloning OpenFront into ${DIR}..."
    mkdir -p "$(dirname "${DIR}")"
    git clone -q "$REPO" "${DIR}"
  fi
  cd "${DIR}"
  git fetch -q origin "$PIN" 2>/dev/null || git fetch -q origin
  git checkout -q "$PIN"
  say "Applying coach patch..."
  apply_patch
  say "Installing dependencies (a few minutes the first time)..."
  npm run inst
  say "Done. Run: bash $0 start"
}

update() {
  toolchain
  [ -d "${DIR}/.git" ] || die "Not installed yet — run: $0 install"
  cd "${DIR}"
  git reset -q --hard HEAD
  git clean -fdq src/client/coach 2>/dev/null || true
  git fetch -q origin main
  git checkout -q origin/main
  if git apply --check "$PATCH" 2>/dev/null; then
    git apply "$PATCH"
    say "Patched latest OpenFront ($(git rev-parse --short HEAD))."
  else
    say "Patch doesn't fit latest OpenFront — staying on the tested version."
    git checkout -q "$PIN"; apply_patch
  fi
  npm run inst
}

start() {
  toolchain
  [ -d "${DIR}/.git" ] || die "Not installed yet — run: $0 install"
  cd "${DIR}"
  say "Starting on http://localhost:9000 (Ctrl+C to stop). Lobby/API errors in the log are normal offline — use SOLO."
  ( sleep 12; open "http://localhost:9000" 2>/dev/null || true ) &
  npm run dev
}

pull() {
  command -v git >/dev/null || die "git not found — run: xcode-select --install"
  [ -d "$HERE/.git" ] || die "This folder isn't a git clone. Clone it with: git clone https://github.com/iansyder8/openfront-coach.git ~/openfront-coach/kit"
  say "Pulling the latest coach..."
  git -C "$HERE" pull --ff-only -q
  if [ -d "${DIR}/.git" ]; then
    apply_patch
    say "Coach updated ($(git -C "$HERE" log -1 --format='%h %s')). Run: bash $0 start"
  else
    say "Pulled. Not installed yet — run: $0 install"
  fi
}

review() {
  local id="${1:-}" name="${2:-}"
  [ -n "$id" ] || die "usage: $0 review <game ID or URL> \"<your in-game name>\""
  id="${id%%\?*}"; id="${id%/}"; id="${id##*[/#=]}"   # accept a full game URL
  if [ -z "$name" ] && [ -f "$NAMEFILE" ]; then name="$(cat "$NAMEFILE")"; fi
  [ -n "$name" ] || die "Give your in-game name: $0 review $id \"YourName\""
  printf '%s' "$name" > "$NAMEFILE"
  toolchain
  mkdir -p "$REVIEWS"
  local rec="$REVIEWS/$id.record.json"
  if [ ! -s "$rec" ]; then
    say "Downloading game $id..."
    curl -sfL "https://api.openfront.io/public/game/$id" -o "$rec" || {
      rm -f "$rec"
      die "Couldn't download game $id. Check the ID; games take a minute or two to appear after they end."
    }
  fi
  local commit
  commit="$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(r.gitCommit||r.info?.gitCommit||"")' "$rec")"
  [ -n "$commit" ] || die "The game record has no version info, so it can't be replayed."
  if [ ! -d "$REPLAY/.git" ] && [ ! -f "$REPLAY/.git" ]; then
    say "Setting up the replay copy of OpenFront (one-off)..."
    git clone -q "$REPO" "$REPLAY"
  fi
  cd "$REPLAY"
  if [ "$(git rev-parse HEAD 2>/dev/null)" != "$commit" ]; then
    say "Switching replay copy to the version that game ran on (${commit:0:8})..."
    git fetch -q origin "$commit" 2>/dev/null || git fetch -q origin
    git reset -q --hard
    git checkout -q --detach "$commit"
  fi
  local lock; lock="$(git hash-object package-lock.json)"
  if [ ! -d node_modules ] || [ "$(cat .coach-lock 2>/dev/null)" != "$lock" ]; then
    say "Installing dependencies for this version (a few minutes)..."
    npm run inst >/dev/null
    printf '%s' "$lock" > .coach-lock
  fi
  cp "$HERE/CoachReview.ts" tests/replay/CoachReview.ts
  say "Replaying (about 15-60 seconds)..."
  npx --no-install tsx tests/replay/CoachReview.ts "$rec" --player "$name" --out "$REVIEWS/$id-review.json"
  say "Review saved: $REVIEWS/$id-review.json"
  if command -v pbcopy >/dev/null; then
    pbcopy < "$REVIEWS/$id-review.json" && say "Copied to the clipboard — paste it to Claude."
  fi
}

case "${1:-}" in
  install) install ;;
  start) start ;;
  update) update ;;
  pull) pull ;;
  review) shift; review "$@" ;;
  *) echo "usage: $0 install | start | pull | update | review <game ID> \"<name>\""; exit 1 ;;
esac

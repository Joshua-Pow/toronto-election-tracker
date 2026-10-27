#!/usr/bin/env bash
# Share the tracker from a Mac through a free Cloudflare quick tunnel (*.trycloudflare.com).
#
#   scripts/share-cloudflare.sh             # private link if ACCESS_KEY is set or .access_key exists, else open
#   scripts/share-cloudflare.sh --new-key   # make a fresh private key (saved to .access_key, chmod 600)
#   scripts/share-cloudflare.sh --open      # no key: anyone with the URL can view
#   PORT=8026 ACCESS_KEY=... scripts/share-cloudflare.sh
#
# What it does: starts the server bound to 127.0.0.1 only (nothing on your Wi-Fi/LAN can reach it),
# starts `cloudflared tunnel --url http://127.0.0.1:$PORT`, prints the public URL, keeps the Mac
# awake with caffeinate while it runs, and stops both on Ctrl-C. Installs nothing.
# Needs: node >= 18 and cloudflared already on your PATH (if missing: `brew install cloudflared`).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8026}"
MODE=auto
for a in "$@"; do case "$a" in
  --new-key) MODE=new ;; --open) MODE=open ;;
  -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
  *) echo "unknown option: $a" >&2; exit 2 ;;
esac; done

command -v node >/dev/null || { echo "node is not installed (need Node 18+)." >&2; exit 1; }
command -v cloudflared >/dev/null || { echo "cloudflared is not installed. Install it yourself with: brew install cloudflared" >&2; exit 1; }
[ -d "$ROOT/node_modules/leaflet" ] || { echo "Run 'npm install' in $ROOT first." >&2; exit 1; }
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use (is the tracker already running, maybe with HOST=0.0.0.0?). Stop it first, or use PORT=8027." >&2; exit 1
fi

umask 077
KEY="${ACCESS_KEY:-}"
case "$MODE" in
  new)  KEY="$(openssl rand -base64 33 | tr '+/' '-_' | tr -d '=\n')"; printf '%s\n' "$KEY" > "$ROOT/.access_key"; chmod 600 "$ROOT/.access_key" ;;
  open) KEY="" ;;
  auto) if [ -z "$KEY" ] && [ -s "$ROOT/.access_key" ]; then KEY="$(tr -d '\n' < "$ROOT/.access_key")"; fi ;;
esac
if [ -n "$KEY" ] && [ "${#KEY}" -lt 24 ]; then echo "ACCESS_KEY must be at least 24 characters." >&2; exit 1; fi

LOGDIR="$ROOT/logs"; mkdir -p "$LOGDIR"
TLOG="$LOGDIR/cloudflared.log"; : > "$TLOG"
cleanup() {
  trap - INT TERM EXIT
  [ -n "${TPID:-}" ] && kill "$TPID" 2>/dev/null || true
  [ -n "${SPID:-}" ] && kill "$SPID" 2>/dev/null || true
  [ -n "${CPID:-}" ] && kill "$CPID" 2>/dev/null || true
  printf 'NOT LIVE (stopped %s)\n' "$(TZ=America/Toronto date '+%Y-%m-%d %H:%M ET')" > "$ROOT/PUBLIC_URL.txt"
  echo; echo "Stopped. The link no longer works."
}
trap cleanup INT TERM EXIT

# 1. server: loopback only, whatever HOST says elsewhere
( cd "$ROOT" && HOST=127.0.0.1 PORT="$PORT" ACCESS_KEY="$KEY" exec node server.js ) >> "$LOGDIR/server.log" 2>&1 &
SPID=$!
for _ in $(seq 1 20); do curl -fsS -o /dev/null "http://127.0.0.1:$PORT/healthz" 2>/dev/null && break; sleep 0.5; done
curl -fsS -o /dev/null "http://127.0.0.1:$PORT/healthz" || { echo "Server didn't start; see $LOGDIR/server.log" >&2; exit 1; }

# 2. tunnel (no account, no config file; --no-autoupdate so it never modifies itself)
cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:$PORT" > "$TLOG" 2>&1 &
TPID=$!
URL=""
for _ in $(seq 1 60); do
  URL="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$TLOG" | head -1 || true)"
  [ -n "$URL" ] && break; sleep 1
  kill -0 "$TPID" 2>/dev/null || break
done
[ -n "$URL" ] || { echo "cloudflared didn't give a URL; see $TLOG" >&2; exit 1; }

# 3. keep the Mac awake while sharing (built into macOS)
if command -v caffeinate >/dev/null; then caffeinate -i -w "$SPID" & CPID=$!; fi

LINK="$URL/"; [ -n "$KEY" ] && LINK="$URL/?key=$KEY"
printf '%s\n' "$LINK" > "$ROOT/PUBLIC_URL.txt"; chmod 600 "$ROOT/PUBLIC_URL.txt"
echo
echo "Live at: $LINK"
if [ -n "$KEY" ]; then echo "Private link: only people with this exact URL (key included) can open it. Anyone you give it to can pass it on."
else echo "OPEN link: anyone with the URL can view. Run with --new-key for a private link."; fi
echo "Server bound to 127.0.0.1:$PORT (not reachable from your LAN). The link works only while this window stays open and the Mac is awake."
echo "Press Ctrl-C to stop sharing."
wait "$TPID"

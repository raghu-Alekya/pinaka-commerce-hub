#!/usr/bin/env bash
# Start (or restart) all Nest backend services on Ubuntu/Linux.
# Usage:
#   bash ./scripts/launch-pdh.sh
#   bash ./scripts/launch-pdh.sh --restart
#   bash ./scripts/launch-pdh.sh --skip-docker
set -euo pipefail

RESTART=0
SKIP_DOCKER=0
STARTUP_TIMEOUT_SECONDS=120

while [[ $# -gt 0 ]]; do
  case "$1" in
    --restart|-Restart) RESTART=1; shift ;;
    --skip-docker|-SkipDocker) SKIP_DOCKER=1; shift ;;
    --timeout)
      STARTUP_TIMEOUT_SECONDS="${2:?missing timeout}"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 [--restart] [--skip-docker] [--timeout SECONDS]" >&2
      exit 1
      ;;
  esac
done

SERVICE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_ROOT="$SERVICE_ROOT/logs"
mkdir -p "$LOG_ROOT"
cd "$SERVICE_ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "node is not installed or not on PATH." >&2
  exit 1
fi

LOCK_FILE="/tmp/pinaka-commerce-hub-launcher.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "The service launcher is already running." >&2
  exit 1
fi

services=(
  "gateway:3000"
  "connector-service:3001"
  "order-service:3002"
  "merchant-service:3003"
  "menu-service:3004"
  "inventory-service:3005"
  "analytics-service:3006"
  "pos-integration-service:3007"
  "notification-service:3008"
  "admin-api:3009"
  "auth-service:3010"
)

port_pids() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -tlnp "sport = :$port" 2>/dev/null \
      | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' \
      | sort -u
  elif command -v lsof >/dev/null 2>&1; then
    lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
  else
    echo "Need ss or lsof to detect listening ports." >&2
    exit 1
  fi
}

show_logs() {
  local name="$1"
  for suffix in err out; do
    local path="$LOG_ROOT/$name.$suffix.log"
    echo "Log: $path"
    if [[ -f "$path" ]]; then
      tail -n 20 "$path" || true
    fi
  done
}

if [[ "$SKIP_DOCKER" -eq 0 ]]; then
  docker compose --project-directory "$SERVICE_ROOT" -f "$SERVICE_ROOT/docker-compose.yml" up -d
  pg_ready=0
  for _ in $(seq 1 30); do
    if docker compose --project-directory "$SERVICE_ROOT" exec -T postgres pg_isready -U pdh_user >/dev/null 2>&1; then
      pg_ready=1
      break
    fi
    sleep 1
  done
  if [[ "$pg_ready" -ne 1 ]]; then
    echo "Docker PostgreSQL did not become ready. Check: docker compose logs postgres" >&2
    exit 1
  fi
  docker compose --project-directory "$SERVICE_ROOT" exec -T postgres \
    psql -U pdh_user -d postgres -c \
    "SELECT 'CREATE DATABASE pinaka_commerce_hub' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'pinaka_commerce_hub')\gexec" \
    >/dev/null || true
  echo "PostgreSQL ready: pinaka_commerce_hub"
fi

for item in "${services[@]}"; do
  name="${item%%:*}"
  port="${item##*:}"
  entry="$SERVICE_ROOT/apps/$name/src/main.ts"
  relative_entry="apps/$name/src/main.ts"

  if [[ ! -f "$entry" ]]; then
    echo "$name: missing entry point $entry" >&2
    exit 1
  fi

  mapfile -t pids < <(port_pids "$port")
  if [[ ${#pids[@]} -gt 0 && -n "${pids[0]:-}" ]]; then
    for pid in "${pids[@]}"; do
      cmd="$(ps -p "$pid" -o args= 2>/dev/null || true)"
      if [[ "$cmd" != *"$relative_entry"* && "$cmd" != *"$entry"* ]]; then
        echo "Port $port belongs to another process (PID $pid): $cmd" >&2
        exit 1
      fi
      if [[ "$RESTART" -eq 1 ]]; then
        kill "$pid" 2>/dev/null || true
      fi
    done

    if [[ "$RESTART" -eq 0 ]]; then
      echo "$name: already running on $port; reused."
      continue
    fi

    deadline=$((SECONDS + 10))
    while [[ -n "$(port_pids "$port")" ]]; do
      if (( SECONDS > deadline )); then
        echo "Port $port did not become free." >&2
        exit 1
      fi
      sleep 0.2
    done
  fi

  out_log="$LOG_ROOT/$name.out.log"
  err_log="$LOG_ROOT/$name.err.log"
  : >"$out_log"
  : >"$err_log"

  nohup node --import tsx "$entry" >>"$out_log" 2>>"$err_log" &
  pid=$!
  echo "$name: starting (PID $pid); waiting up to ${STARTUP_TIMEOUT_SECONDS}s for port $port."

  ready=0
  deadline=$((SECONDS + STARTUP_TIMEOUT_SECONDS))
  while (( SECONDS <= deadline )); do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "$name exited early." >&2
      show_logs "$name"
      exit 1
    fi
    if port_pids "$port" | grep -qx "$pid"; then
      ready=1
      break
    fi
    # Some environments hide pid in ss; accept any listener on the port after our process is alive.
    if [[ -n "$(port_pids "$port")" ]] && kill -0 "$pid" 2>/dev/null; then
      ready=1
      break
    fi
    sleep 0.3
  done

  if [[ "$ready" -ne 1 ]]; then
    echo "$name did not bind port $port within ${STARTUP_TIMEOUT_SECONDS}s. PID $pid may still be starting." >&2
    show_logs "$name"
    exit 1
  fi

  echo "$name: ready on $port (PID $pid)."
done

echo "Backend ready: ports 3000-3010."
echo "Re-run without --restart to reuse running services. Use --restart to reload them."

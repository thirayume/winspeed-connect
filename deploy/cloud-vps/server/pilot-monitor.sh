#!/usr/bin/env bash
set -Eeuo pipefail

MODE="${1:-collect}"
DAYS="${2:-7}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="${WORLD_FERT_APP_ROOT:-$(realpath "$SCRIPT_DIR/../../..")}"
STATE_DIR="/var/lib/worldfert-pilot"
LOG_DIR="/var/log/worldfert-pilot"
METRICS_FILE="$LOG_DIR/metrics.csv"
CRON_FILE="/etc/cron.d/worldfert-pilot-monitor"

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "ERROR: run as root" >&2
    exit 1
  fi
}

container_health() {
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null || printf 'missing'
}

install_monitor() {
  require_root
  if ! [[ "$DAYS" =~ ^[1-9][0-9]*$ ]]; then
    echo "ERROR: days must be a positive integer" >&2
    exit 1
  fi

  install -d -m 0750 "$STATE_DIR" "$LOG_DIR"
  date +%s > "$STATE_DIR/started_epoch"
  printf '%s\n' "$(( $(date +%s) + DAYS * 86400 ))" > "$STATE_DIR/end_epoch"
  printf '%s\n' "$DAYS" > "$STATE_DIR/days"
  rm -f "$STATE_DIR/completed" "$STATE_DIR/stopped"
  : > "$METRICS_FILE"

  cat > "$CRON_FILE" <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/5 * * * * root $SCRIPT_DIR/pilot-monitor.sh collect >> $LOG_DIR/cron.log 2>&1
EOF
  chmod 0644 "$CRON_FILE"
  collect_metrics
  echo "Pilot monitor installed: ${DAYS} days, every 5 minutes"
}

collect_metrics() {
  require_root
  install -d -m 0750 "$STATE_DIR" "$LOG_DIR"
  [[ -s "$STATE_DIR/end_epoch" ]] || {
    echo "ERROR: pilot monitor is not installed" >&2
    exit 1
  }

  local now end_epoch timestamp load1 mem_available_mb swap_used_mb disk_used_pct
  local containers_running backend_health mssql_health mysql_health api_fields api_ok api_sql api_mysql
  now="$(date +%s)"
  end_epoch="$(<"$STATE_DIR/end_epoch")"
  if (( now > end_epoch )); then
    date --iso-8601=seconds > "$STATE_DIR/completed"
    exit 0
  fi

  exec 9>"$STATE_DIR/collect.lock"
  flock -n 9 || exit 0

  timestamp="$(date --iso-8601=seconds)"
  load1="$(awk '{print $1}' /proc/loadavg)"
  mem_available_mb="$(awk '/MemAvailable:/ {printf "%d", $2 / 1024}' /proc/meminfo)"
  swap_used_mb="$(free -m | awk '/Swap:/ {print $2-$7}')"
  disk_used_pct="$(df -P / | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
  containers_running="$(docker ps -q | wc -l | tr -d ' ')"
  backend_health="$(container_health wf-backend)"
  mssql_health="$(container_health wf-mssql)"
  mysql_health="$(container_health wf-mysql)"
  api_fields="$(docker exec wf-backend node -e 'fetch("http://127.0.0.1:3000/api/health").then(r=>r.json()).then(j=>process.stdout.write([j.ok===true,j.db?.sqlserver||"down",j.db?.mysql||"down"].join("|"))).catch(()=>process.stdout.write("false|down|down"))' 2>/dev/null || printf 'false|down|down')"
  IFS='|' read -r api_ok api_sql api_mysql <<< "$api_fields"

  if [[ ! -s "$METRICS_FILE" ]]; then
    echo 'timestamp,epoch,load1,mem_available_mb,swap_used_mb,disk_used_pct,containers_running,backend_health,mssql_health,mysql_health,api_ok,api_sqlserver,api_mysql' > "$METRICS_FILE"
  fi
  printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' \
    "$timestamp" "$now" "$load1" "$mem_available_mb" "$swap_used_mb" "$disk_used_pct" \
    "$containers_running" "$backend_health" "$mssql_health" "$mysql_health" \
    "$api_ok" "$api_sql" "$api_mysql" >> "$METRICS_FILE"
}

report_metrics() {
  require_root
  [[ -s "$METRICS_FILE" ]] || {
    echo "ERROR: no pilot metrics found" >&2
    exit 1
  }

  echo "WorldFert pilot monitor"
  echo "Started: $(date -d "@$(<"$STATE_DIR/started_epoch")" --iso-8601=seconds)"
  echo "Planned end: $(date -d "@$(<"$STATE_DIR/end_epoch")" --iso-8601=seconds)"
  [[ -f "$STATE_DIR/completed" ]] && echo "Completed: $(<"$STATE_DIR/completed")"
  [[ -f "$STATE_DIR/stopped" ]] && echo "Stopped: $(<"$STATE_DIR/stopped")"
  awk -F, '
    NR == 1 { next }
    NR == 2 {
      min_mem=$4; max_disk=$6; max_load=$3;
    }
    {
      samples++;
      if ($4 < min_mem) min_mem=$4;
      if ($6 > max_disk) max_disk=$6;
      if ($3 > max_load) max_load=$3;
      if ($8 != "healthy") backend_fail++;
      if ($9 != "healthy") mssql_fail++;
      if ($10 != "healthy") mysql_fail++;
      if ($11 != "true" || $12 != "up" || $13 != "up") api_fail++;
    }
    END {
      printf "Samples: %d\n", samples;
      printf "Max load1: %.2f\n", max_load;
      printf "Minimum available RAM: %d MB\n", min_mem;
      printf "Maximum root disk usage: %d%%\n", max_disk;
      printf "Backend unhealthy samples: %d\n", backend_fail+0;
      printf "MSSQL unhealthy samples: %d\n", mssql_fail+0;
      printf "MySQL unhealthy samples: %d\n", mysql_fail+0;
      printf "API/DB failed samples: %d\n", api_fail+0;
    }
  ' "$METRICS_FILE"
}

stop_monitor() {
  require_root
  rm -f "$CRON_FILE"
  install -d -m 0750 "$STATE_DIR"
  date --iso-8601=seconds > "$STATE_DIR/stopped"
  echo "Pilot monitor stopped; metrics were preserved in $METRICS_FILE"
}

case "$MODE" in
  install) install_monitor ;;
  collect) collect_metrics ;;
  report) report_metrics ;;
  stop) stop_monitor ;;
  *)
    echo "Usage: $0 {install [days]|collect|report|stop}" >&2
    exit 2
    ;;
esac

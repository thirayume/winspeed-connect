#!/usr/bin/env bash
# =============================================================
# office-setup.sh — first-time settings on the Ubuntu VM (on-prem with the office SQL Server)
# =============================================================
#   bash office-setup.sh
#
# Creates .env (from .env.office.example, with random JWT_SECRET / MIGRATE_SECRET) and .env.migrator.local, both
# readable by this user only. The random values are written straight to the files and never printed. The SQL Server
# administrator types the two database passwords in with nano; run this again until nothing is left to fill.
# =============================================================
set -euo pipefail
cd "$(dirname "$0")"

command -v docker >/dev/null 2>&1 || { echo "Docker is not installed: see ONPREM-SERVER-PREP step 4"; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "openssl is missing: sudo apt -y install openssl"; exit 1; }
rand() { openssl rand -base64 48 | tr -d '/+=\n' | head -c 40; }

umask 077
if [ ! -f .env ]; then
  cp .env.office.example .env
  sed -i "s|^JWT_SECRET=CHANGE_ME\$|JWT_SECRET=$(rand)|; s|^MIGRATE_SECRET=CHANGE_ME\$|MIGRATE_SECRET=$(rand)|" .env
  echo "created .env (random app secrets filled in)"
fi
if [ ! -f .env.migrator.local ]; then
  cat > .env.migrator.local <<'EOF'
# migrator login from sql/office-logins.sql; read only by the one-off migrate service, never by the API
ONPREM_MIGRATOR_USER=wf_migrator
ONPREM_MIGRATOR_PASSWORD=CHANGE_ME
EOF
  echo "created .env.migrator.local"
fi
chmod 600 .env .env.migrator.local

left=$(grep -hoE '^[A-Z_]+=CHANGE_ME$' .env .env.migrator.local | cut -d= -f1 | tr '\n' ' ' || true)
if [ -n "$left" ]; then
  echo "still to fill in: $left"
  echo "  nano .env   /   nano .env.migrator.local   (a password must not contain \$, or put it in single quotes)"
  echo "then run: bash office-setup.sh"
  exit 2
fi

echo "settings complete. next steps:"
echo "  docker compose -f docker-compose.office.yml build"
echo "  docker compose -f docker-compose.office.yml run --rm --no-deps backend node scripts/onprem-preflight.cjs"
echo "  docker compose -f docker-compose.office.yml --profile migrate run --rm migrate --plan"

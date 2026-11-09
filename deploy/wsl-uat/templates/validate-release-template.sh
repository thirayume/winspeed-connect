#!/usr/bin/env bash
# Syntax only. No secrets read, no daemon use, no images pulled, no services/SQL started.
set -euo pipefail
cd "$(dirname "$0")"
docker compose --env-file /dev/null -f compose.release.example.yml config --no-interpolate --no-env-resolution --quiet
printf '%s\n' 'Compose template syntax OK. Live deployment, env identity, TLS, Caddy and SQL NOT RUN.'

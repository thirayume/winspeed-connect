#!/usr/bin/env bash
# Draft provisioning script. Default is a plan; --apply is a FUTURE owner-approved host change.
# Never executes SQL, reads app secrets, changes IP/firewall, or starts Sale-App.
set -euo pipefail
if [[ "${1:---plan}" != "--apply" ]]; then
  printf '%s\n' 'PLAN ONLY: validate fresh Ubuntu 24.04; configure official Docker APT repository;' \
    'install owner-reviewed pinned Docker, containerd, Buildx and Compose versions.' \
    'No host change. Supply versions and explicit --apply only after IT/owner approves inventory.'
  exit 0
fi
[[ "$EUID" -eq 0 ]] || { printf '%s\n' 'Run as root only on the approved VM'; exit 1; }
. /etc/os-release
[[ "$ID" == "ubuntu" && "$VERSION_ID" == "24.04" ]] || { printf '%s\n' 'This draft is for Ubuntu 24.04 only'; exit 1; }
! command -v docker >/dev/null 2>&1 || { printf '%s\n' 'Existing Docker found: use a reviewed upgrade plan instead'; exit 1; }
: "${DOCKER_VERSION:?Set the IT-reviewed package version}"
: "${CONTAINERD_VERSION:?Set the IT-reviewed package version}"
: "${BUILDX_VERSION:?Set the IT-reviewed package version}"
: "${COMPOSE_VERSION:?Set the IT-reviewed package version}"
apt-get update
apt-get install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update
apt-get install -y "docker-ce=$DOCKER_VERSION" "docker-ce-cli=$DOCKER_VERSION" \
  "containerd.io=$CONTAINERD_VERSION" "docker-buildx-plugin=$BUILDX_VERSION" "docker-compose-plugin=$COMPOSE_VERSION"
docker --version
docker compose version
printf '%s\n' 'Docker installed. Sale-App, SQL, firewall and deployment NOT RUN.'

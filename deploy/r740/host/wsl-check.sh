#!/bin/sh
# Read-only WSL check for Sale-App, called by Check-SaleAppHost.ps1.
# Prints facts only; it does not install, start, stop or change anything.
echo "distro: $(. /etc/os-release 2>/dev/null; echo "$PRETTY_NAME")"
echo "kernel: $(uname -r)"
echo "pid1: $(ps -p 1 -o comm= 2>/dev/null)"
echo "--- /etc/wsl.conf"
cat /etc/wsl.conf 2>/dev/null || echo "(none)"
echo "--- docker"
if command -v docker >/dev/null 2>&1; then
  echo "docker cli: $(command -v docker)"
  docker version --format 'client {{.Client.Version}} / server {{.Server.Version}} {{.Server.Os}}' 2>&1 | head -3
  docker info --format 'OSType={{.OSType}} Root={{.DockerRootDir}} Storage={{.Driver}} Cgroup={{.CgroupDriver}}' 2>&1 | head -3
  docker compose version 2>&1 | head -1
  docker context ls 2>&1 | head -6
  echo "--- containers"
  docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' 2>&1 | head -30
  echo "--- images"
  docker images --format 'table {{.Repository}}:{{.Tag}}\t{{.Size}}' 2>&1 | head -30
  echo "volumes: $(docker volume ls -q 2>/dev/null | wc -l)"
else
  echo "docker cli: NOT FOUND"
fi
if command -v systemctl >/dev/null 2>&1; then
  echo "systemd docker: active=$(systemctl is-active docker 2>&1) enabled=$(systemctl is-enabled docker 2>&1)"
fi
echo "--- network"
ip -4 -o addr show 2>/dev/null | awk '{print $2, $4}'
ip route 2>/dev/null | head -3
grep nameserver /etc/resolv.conf 2>/dev/null | head -2
echo "--- disk"
df -h / /mnt/c /mnt/d 2>/dev/null
echo "--- tools"
for t in git python3 curl; do printf '%s: %s\n' "$t" "$(command -v "$t" || echo missing)"; done

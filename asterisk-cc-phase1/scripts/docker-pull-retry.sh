#!/usr/bin/env bash
# Pull images one-by-one (helps on slow/unstable links to Docker Hub)
set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
[[ -f .env ]] && set -a && source .env && set +a

AST="${ASTERISK_IMAGE:-andrius/asterisk:20-cert}"

images=(
  "postgres:16"
  "${AST}"
  "python:3.10-slim"
  "grafana/grafana:latest"
  "prom/prometheus:latest"
  "crazymax/fail2ban:latest"
)

pull_one() {
  local img="$1"
  local n=0
  until docker pull "${img}"; do
    n=$((n + 1))
    if [[ ${n} -ge 5 ]]; then
      echo "FAILED after 5 attempts: ${img}" >&2
      return 1
    fi
    echo "Retry ${n}/5 in 15s: ${img}"
    sleep 15
  done
  echo "OK: ${img}"
}

for img in "${images[@]}"; do
  pull_one "${img}"
done

echo ""
echo "All images pulled. Start stack:"
echo "  docker compose up -d postgres asterisk-a webui grafana prometheus fail2ban"

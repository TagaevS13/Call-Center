#!/usr/bin/env bash
# Prometheus metrics for Asterisk (robinmarechal/asterisk_exporter).
set -euo pipefail

EXPORTER="${EXPORTER_BIN:-/var/spool/asterisk/asterisk_exporter}"
LISTEN="${EXPORTER_LISTEN:-0.0.0.0:9815}"
AST_BIN="${ASTERISK_BIN:-/usr/sbin/asterisk}"
[[ -x "${AST_BIN}" ]] || AST_BIN="/usr/sbin/asterisk-bin"

install_exporter() {
  if [[ -x "${EXPORTER}" ]]; then
    return 0
  fi
  ARCH="$(uname -m)"
  case "${ARCH}" in
    x86_64) ARCH=amd64 ;;
    aarch64) ARCH=arm64 ;;
    *) echo "Unsupported arch: ${ARCH}" >&2; return 1 ;;
  esac
  VER="1.1.1"
  TAR="asterisk_exporter-${VER}.linux-${ARCH}.tar.gz"
  URL="https://github.com/robinmarechal/asterisk_exporter/releases/download/v${VER}/${TAR}"
  TMP="/tmp/${TAR}"
  echo "Downloading asterisk_exporter ${VER}..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "${TMP}" "${URL}"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "${TMP}" "${URL}"
  else
    echo "curl/wget required to install asterisk_exporter" >&2
    return 1
  fi
  tar -xzf "${TMP}" -C /tmp
  BIN="$(find /tmp -maxdepth 3 -name asterisk_exporter -type f 2>/dev/null | head -1)"
  if [[ -z "${BIN}" ]]; then
    echo "asterisk_exporter binary not found in archive" >&2
    return 1
  fi
  cp "${BIN}" "${EXPORTER}"
  chmod +x "${EXPORTER}"
  rm -f "${TMP}"
  find /tmp -maxdepth 2 -type d -name 'asterisk_exporter-*' -exec rm -rf {} + 2>/dev/null || true
}

if ! install_exporter; then
  echo "asterisk_exporter not installed, skipping metrics" >&2
  exit 0
fi

# Avoid stale process after crash/restart
pkill -f "${EXPORTER}.*9815" 2>/dev/null || true
sleep 1

# Wait until Asterisk CLI responds
for i in $(seq 1 30); do
  if "${AST_BIN}" -rx "core show version" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# agents/sip collectors panic when no peers/agents are registered (lab)
exec "${EXPORTER}" \
  --web.listen-address="${LISTEN}" \
  --asterisk.path="${AST_BIN}" \
  --no-collector.agents \
  --no-collector.sip \
  --collector.core \
  --log.level=info

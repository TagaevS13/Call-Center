#!/usr/bin/env bash
# Run ON the server: sudo bash scripts/fix-native-stack.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CC_ENV="/etc/cc/cc.env"

log() { echo "[fix-native] $*" >&2; }

[[ "$(id -u)" -eq 0 ]] || { echo "Run: sudo bash $0"; exit 1; }

log "=== 1. Remove broken asterisk drop-in ==="
rm -f /etc/systemd/system/asterisk.service.d/cc.conf
rmdir /etc/systemd/system/asterisk.service.d 2>/dev/null || true

log "=== 2. Install systemd units ==="
# Self-contained: create cc-asterisk if missing from repo (older deploys)
if [[ ! -f "${REPO_ROOT}/ops/systemd/native/cc-asterisk.service" ]]; then
  log "Creating cc-asterisk.service inline (missing from repo on server)"
  cat > /etc/systemd/system/cc-asterisk.service << 'UNITEOF'
[Unit]
Description=Asterisk PBX (Call Center native)
After=network-online.target cc-asterisk-prestart.service cc-gsm-routes.service
Wants=network-online.target cc-gsm-routes.service
Requires=cc-asterisk-prestart.service

[Service]
Type=simple
User=asterisk
Group=asterisk
EnvironmentFile=-/etc/cc/cc.env
ExecStartPre=/bin/bash /opt/cc/scripts/asterisk-prestart.sh
ExecStart=/usr/sbin/asterisk -f -U asterisk -G asterisk
ExecReload=/usr/sbin/asterisk -rx 'core reload'
Restart=on-failure
RestartSec=4
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNITEOF
fi
for u in cc-asterisk cc-asterisk-prestart cc-reload-watcher cc-asterisk-exporter \
  cc-ami-listener cc-media-debug cc-webui cc-coturn cc-postgres-exporter cc-node-exporter; do
  src="${REPO_ROOT}/ops/systemd/native/${u}.service"
  [[ -f "${src}" ]] || continue
  sed -i 's/\r$//' "${src}"
  install -m 644 "${src}" "/etc/systemd/system/${u}.service"
done
if [[ -f "${REPO_ROOT}/ops/systemd/cc-gsm-routes.service" ]]; then
  install -m 644 "${REPO_ROOT}/ops/systemd/cc-gsm-routes.service" /etc/systemd/system/
fi

log "=== 3. Ensure asterisk 20 binary ==="
if [[ ! -x /usr/sbin/asterisk ]] && [[ -x /usr/src/asterisk-20.20.0/main/asterisk ]]; then
  install -m 755 /usr/src/asterisk-20.20.0/main/asterisk /usr/sbin/asterisk
fi
[[ -x /usr/sbin/asterisk ]] || { log "ERROR: /usr/sbin/asterisk missing"; exit 1; }
log "Binary: $(/usr/sbin/asterisk -V 2>&1 | head -1)"

log "=== 4. Stop old asterisk ==="
systemctl stop asterisk cc-asterisk 2>/dev/null || true
pkill -x asterisk 2>/dev/null || true
sleep 2

log "=== 5. Permissions + prestart ==="
mkdir -p /var/run/asterisk /var/log/asterisk /var/spool/asterisk
chown -R asterisk:asterisk /var/run/asterisk /var/log/asterisk /var/spool/asterisk 2>/dev/null || true
chmod +x "${REPO_ROOT}/asterisk/scripts/"*.sh 2>/dev/null || true
bash "${REPO_ROOT}/asterisk/scripts/asterisk-prestart.sh"

log "=== 6. Enable cc-asterisk (disable debian asterisk) ==="
systemctl daemon-reload
systemctl disable asterisk 2>/dev/null || true
systemctl reset-failed asterisk cc-asterisk 2>/dev/null || true
systemctl enable cc-gsm-routes cc-asterisk-prestart cc-asterisk \
  cc-reload-watcher cc-asterisk-exporter cc-ami-listener cc-media-debug \
  cc-webui cc-coturn cc-postgres-exporter cc-node-exporter 2>/dev/null || true

log "=== 7. Start services ==="
systemctl start cc-gsm-routes 2>/dev/null || true
systemctl start cc-asterisk-prestart
systemctl start cc-asterisk
sleep 4
systemctl start cc-reload-watcher cc-asterisk-exporter cc-ami-listener cc-media-debug 2>/dev/null || true
systemctl start cc-webui cc-coturn 2>/dev/null || true
systemctl start cc-postgres-exporter cc-node-exporter 2>/dev/null || true
systemctl restart prometheus grafana-server 2>/dev/null || true

log "=== 8. Smoke ==="
for svc in cc-asterisk cc-reload-watcher cc-asterisk-exporter cc-ami-listener cc-webui cc-coturn grafana-server prometheus postgresql; do
  st="$(systemctl is-active "${svc}" 2>/dev/null || echo inactive)"
  log "  ${svc}: ${st}"
done
asterisk -rx "core show version" 2>/dev/null | head -1 || log "  asterisk CLI: FAIL"
asterisk -rx "module show like pgsql" 2>/dev/null | grep -E 'cdr_pgsql|cel_pgsql' || true
curl -sfI http://127.0.0.1:9000/ >/dev/null && log "  WebUI :9000: OK" || log "  WebUI :9000: FAIL"
docker --version 2>/dev/null && log "  WARNING: docker still present" || log "  Docker: removed"

log "=== Done ==="

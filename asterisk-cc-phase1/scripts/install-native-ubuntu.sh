#!/usr/bin/env bash
# Native Ubuntu install for asterisk-cc-phase1 (no Docker).
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-/opt/call-center/asterisk-cc-phase1}"
CC_ENV="/etc/cc/cc.env"
BACKUP_DATE="$(date +%Y-%m-%d)"

log() { echo "[install-native] $*" >&2; }
die() { log "ERROR: $*"; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "Run as root: sudo bash $0"

[[ -d "${REPO_ROOT}" ]] || die "Repo not found at ${REPO_ROOT}"

cd "${REPO_ROOT}"

if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example .env
    log "Created .env from .env.example — set passwords before production use"
  else
    die ".env missing"
  fi
fi

# shellcheck disable=SC1091
set -a && source .env && set +a

PG_PORT="${PG_PORT:-5433}"
PG_DB="${PG_DB:-asterisk_cc}"
PG_SUPER_USER="${PG_SUPER_USER:-postgres}"
PG_SUPER_PASSWORD="${PG_SUPER_PASSWORD:-changeme}"
PG_USER="${PG_USER:-asterisk}"
PG_PASSWORD="${PG_PASSWORD:-changeme}"
PUBLIC_DOMAIN="${PUBLIC_DOMAIN:-172.16.6.183}"
GRAFANA_PUBLISH_PORT="${GRAFANA_PUBLISH_PORT:-3001}"
PROMETHEUS_PUBLISH_PORT="${PROMETHEUS_PUBLISH_PORT:-9091}"

log "=== 1. APT packages ==="
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y \
  postgresql postgresql-contrib postgresql-client libpq5 \
  python3 python3-venv python3-pip python3-dev \
  coturn fail2ban \
  openssl git curl rsync wget ca-certificates gnupg \
  libpq-dev build-essential software-properties-common

# Asterisk (package name varies) — upgrade to 20 LTS if apt gives 18.x
apt-get install -y asterisk 2>/dev/null || apt-get install -y asterisk asterisk-config 2>/dev/null || true
apt-get install -y asterisk-modules 2>/dev/null || true
if ! asterisk -V 2>/dev/null | grep -qE 'Asterisk 2[0-9]\.'; then
  log "Asterisk $(asterisk -V 2>/dev/null || echo unknown) — building 20 LTS from source"
  bash "${REPO_ROOT}/scripts/build-asterisk20.sh"
fi
command -v asterisk >/dev/null || die "asterisk not installed"

# Grafana official repo
install -d -m 0755 /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/grafana.gpg ]]; then
  wget -q -O - https://apt.grafana.com/gpg.key | gpg --dearmor -o /etc/apt/keyrings/grafana.gpg
  echo "deb [signed-by=/etc/apt/keyrings/grafana.gpg] https://apt.grafana.com stable main" \
    > /etc/apt/sources.list.d/grafana.list
fi
apt-get update -qq
apt-get install -y grafana prometheus 2>/dev/null || apt-get install -y grafana 2>/dev/null || true

PG_VER="$(ls /etc/postgresql 2>/dev/null | sort -rn | head -1 || true)"
[[ -n "${PG_VER}" ]] || PG_VER="$(psql --version 2>/dev/null | grep -oE '[0-9]+' | head -1 || echo 14)"
log "PostgreSQL version: ${PG_VER}"

log "=== 2. /etc/cc/cc.env ==="
mkdir -p /etc/cc
grep -v '^#' .env | grep -v '^$' > "${CC_ENV}.tmp" || true
chmod 640 "${CC_ENV}.tmp"
chown root:asterisk "${CC_ENV}.tmp" 2>/dev/null || chown root:root "${CC_ENV}.tmp"
mv "${CC_ENV}.tmp" "${CC_ENV}"

log "=== 3. PostgreSQL on port ${PG_PORT} ==="
PG_CONF=""
PG_HBA=""
if [[ -d /etc/postgresql ]]; then
  PG_VER="$(ls /etc/postgresql | sort -rn | head -1)"
  PG_CONF="/etc/postgresql/${PG_VER}/main/postgresql.conf"
  PG_HBA="/etc/postgresql/${PG_VER}/main/pg_hba.conf"
fi

# If SMSC/other uses 5432, create dedicated CC cluster on PG_PORT
if ss -tln | grep -q ':5432 ' && [[ "${PG_PORT}" != "5432" ]]; then
  CLUSTER="cc"
  if ! pg_lsclusters 2>/dev/null | grep -q "^${PG_VER}[[:space:]]*${CLUSTER}[[:space:]]"; then
    log "Creating PostgreSQL cluster ${PG_VER}/${CLUSTER} on port ${PG_PORT}"
    pg_createcluster "${PG_VER}" "${CLUSTER}" --port="${PG_PORT}" || true
  fi
  PG_CONF="/etc/postgresql/${PG_VER}/${CLUSTER}/postgresql.conf"
  PG_HBA="/etc/postgresql/${PG_VER}/${CLUSTER}/pg_hba.conf"
  systemctl start "postgresql@${PG_VER}-${CLUSTER}" 2>/dev/null || true
fi

if [[ -f "${PG_CONF}" ]]; then
  if grep -q "^port[[:space:]]*=" "${PG_CONF}"; then
    sed -i "s/^port[[:space:]]*=.*/port = ${PG_PORT}/" "${PG_CONF}"
  else
    echo "port = ${PG_PORT}" >> "${PG_CONF}"
  fi
  sed -i "s/^#listen_addresses.*/listen_addresses = '127.0.0.1'/" "${PG_CONF}" 2>/dev/null || true
  grep -q "127.0.0.1/32" "${PG_HBA}" || echo "host all all 127.0.0.1/32 scram-sha-256" >> "${PG_HBA}"
  systemctl restart "postgresql@${PG_VER}-main.service" 2>/dev/null || \
    systemctl restart "postgresql@${PG_VER}-cc.service" 2>/dev/null || \
    systemctl restart postgresql
fi

sleep 2
sudo -u postgres psql -p "${PG_PORT}" -tc "SELECT 1" >/dev/null 2>&1 || die "PostgreSQL not responding on port ${PG_PORT}"

sudo -u postgres psql -p "${PG_PORT}" -tc "SELECT 1 FROM pg_roles WHERE rolname='${PG_SUPER_USER}'" | grep -q 1 || \
  sudo -u postgres createuser -s "${PG_SUPER_USER}" 2>/dev/null || true
sudo -u postgres psql -p "${PG_PORT}" -c "ALTER USER ${PG_SUPER_USER} WITH PASSWORD '${PG_SUPER_PASSWORD}';" 2>/dev/null || true

if ! sudo -u postgres psql -p "${PG_PORT}" -tc "SELECT 1 FROM pg_database WHERE datname='${PG_DB}'" | grep -q 1; then
  sudo -u postgres psql -p "${PG_PORT}" -c "CREATE DATABASE ${PG_DB} OWNER ${PG_SUPER_USER};"
fi

if ! sudo -u postgres psql -p "${PG_PORT}" -tc "SELECT 1 FROM pg_roles WHERE rolname='${PG_USER}'" | grep -q 1; then
  sudo -u postgres psql -p "${PG_PORT}" -c "CREATE USER ${PG_USER} WITH PASSWORD '${PG_PASSWORD}';"
  sudo -u postgres psql -p "${PG_PORT}" -c "GRANT ALL PRIVILEGES ON DATABASE ${PG_DB} TO ${PG_USER};"
fi

log "=== 4. SQL schema ==="
export PGPASSWORD="${PG_SUPER_PASSWORD}"
mapfile -t SQL_FILES < <(find "${REPO_ROOT}/postgres/sql" -name '*.sql' -printf '%f\n' | sort -V)
for f in "${SQL_FILES[@]}"; do
  log "  applying ${f}"
  psql -h 127.0.0.1 -p "${PG_PORT}" -U "${PG_SUPER_USER}" -d "${PG_DB}" -f "${REPO_ROOT}/postgres/sql/${f}" \
    2>&1 | grep -viE '^(NOTICE|already exists|ERROR:  role .* already exists)' || true
done
unset PGPASSWORD

log "=== 5. Symlinks and directories ==="
mkdir -p /opt/cc /var/log/asterisk /var/spool/asterisk /var/lib/asterisk

link_or_replace() {
  local target="$1" link="$2"
  if [[ -L "${link}" ]]; then
    rm -f "${link}"
  elif [[ -e "${link}" ]]; then
    mv "${link}" "${link}.bak.${BACKUP_DATE}"
  fi
  ln -sfn "${target}" "${link}"
}

link_or_replace "${REPO_ROOT}/asterisk/etc" /etc/asterisk
link_or_replace "${REPO_ROOT}/asterisk/scripts" /opt/cc/scripts
link_or_replace "${REPO_ROOT}/webui/data" /opt/cc/webui-data
link_or_replace "${REPO_ROOT}/asterisk/static-http" /var/lib/asterisk/static-http
link_or_replace "${REPO_ROOT}/asterisk/sounds/custom" /var/lib/asterisk/sounds/custom

if [[ ! -L /var/spool/asterisk/recordings ]] && [[ ! -d "${REPO_ROOT}/recordings" ]]; then
  mkdir -p "${REPO_ROOT}/recordings"
fi
if [[ -d "${REPO_ROOT}/recordings" ]]; then
  link_or_replace "${REPO_ROOT}/recordings" /var/spool/asterisk/recordings
fi

chown -R asterisk:asterisk /var/log/asterisk /var/spool/asterisk /var/lib/asterisk 2>/dev/null || true
chmod +x "${REPO_ROOT}/asterisk/scripts/"*.sh 2>/dev/null || true
chmod +x /opt/cc/scripts/*.sh 2>/dev/null || true

log "=== 6. Asterisk prestart ==="
bash /opt/cc/scripts/asterisk-prestart.sh

log "=== 7. WebUI venv ==="
python3 -m venv "${REPO_ROOT}/webui/.venv"
"${REPO_ROOT}/webui/.venv/bin/pip" install -q -U pip
"${REPO_ROOT}/webui/.venv/bin/pip" install -q -r "${REPO_ROOT}/webui/requirements.txt"

log "=== 8. coturn ==="
install -m 644 "${REPO_ROOT}/ops/coturn/turnserver.conf" /etc/turnserver.conf
sed -i "s/listening-ip=.*/listening-ip=${PUBLIC_DOMAIN}/" /etc/turnserver.conf
sed -i "s/relay-ip=.*/relay-ip=${PUBLIC_DOMAIN}/" /etc/turnserver.conf
sed -i "s/external-ip=.*/external-ip=${PUBLIC_DOMAIN}/" /etc/turnserver.conf
sed -i "s/realm=.*/realm=${PUBLIC_DOMAIN}/" /etc/turnserver.conf

log "=== 9. Prometheus ==="
install -d /etc/prometheus
install -m 644 "${REPO_ROOT}/monitoring/prometheus/prometheus.yml" /etc/prometheus/prometheus.yml
install -m 644 "${REPO_ROOT}/monitoring/prometheus/alerts.yml" /etc/prometheus/alerts.yml 2>/dev/null || true
mkdir -p /var/lib/prometheus
chown prometheus:prometheus /var/lib/prometheus 2>/dev/null || chown nobody:nogroup /var/lib/prometheus 2>/dev/null || true

if [[ -f /etc/default/prometheus ]]; then
  sed -i "s|^ARGS=.*|ARGS=\"--config.file=/etc/prometheus/prometheus.yml --storage.tsdb.path=/var/lib/prometheus --web.enable-lifecycle --web.listen-address=127.0.0.1:${PROMETHEUS_PUBLISH_PORT}\"|" /etc/default/prometheus 2>/dev/null || true
elif [[ ! -x /usr/bin/prometheus ]] && [[ ! -x /usr/local/bin/prometheus ]]; then
  PROM_VER="2.54.1"
  curl -fsSL "https://github.com/prometheus/prometheus/releases/download/v${PROM_VER}/prometheus-${PROM_VER}.linux-amd64.tar.gz" -o "/tmp/prometheus.tar.gz"
  tar -xzf /tmp/prometheus.tar.gz -C /tmp
  install -m 755 "/tmp/prometheus-${PROM_VER}.linux-amd64/prometheus" /usr/local/bin/prometheus
  install -m 755 "/tmp/prometheus-${PROM_VER}.linux-amd64/promtool" /usr/local/bin/promtool
  rm -rf /tmp/prometheus.tar.gz "/tmp/prometheus-${PROM_VER}.linux-amd64"
  cat > /etc/systemd/system/prometheus.service <<EOF
[Unit]
Description=Prometheus
After=network-online.target

[Service]
User=prometheus
Group=prometheus
ExecStart=/usr/local/bin/prometheus --config.file=/etc/prometheus/prometheus.yml --storage.tsdb.path=/var/lib/prometheus --web.enable-lifecycle --web.listen-address=127.0.0.1:${PROMETHEUS_PUBLISH_PORT}
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF
  id prometheus &>/dev/null || useradd --no-create-home --shell /usr/sbin/nologin prometheus
fi

log "=== 10. Grafana ==="
install -d /etc/grafana/provisioning/datasources /etc/grafana/provisioning/dashboards
rsync -a "${REPO_ROOT}/monitoring/grafana/provisioning/" /etc/grafana/provisioning/
rsync -a "${REPO_ROOT}/monitoring/grafana/dashboards/" /etc/grafana/dashboards/ 2>/dev/null || \
  install -d /etc/grafana/dashboards && cp -a "${REPO_ROOT}/monitoring/grafana/dashboards/"* /etc/grafana/dashboards/ 2>/dev/null || true

if [[ -f /etc/grafana/grafana.ini ]]; then
  sed -i "s/^;\\?http_port = .*/http_port = ${GRAFANA_PUBLISH_PORT}/" /etc/grafana/grafana.ini 2>/dev/null || true
fi
if [[ -f /etc/default/grafana-server ]]; then
  grep -q GRAFANA_PUBLISH_PORT /etc/default/grafana-server || \
    echo "GRAFANA_PUBLISH_PORT=${GRAFANA_PUBLISH_PORT}" >> /etc/default/grafana-server
fi

log "=== 11. fail2ban ==="
install -m 644 "${REPO_ROOT}/monitoring/fail2ban/filter.d/asterisk.conf" /etc/fail2ban/filter.d/asterisk.conf 2>/dev/null || \
  cp "${REPO_ROOT}/monitoring/fail2ban/filter.d/asterisk.conf" /etc/fail2ban/filter.d/
install -m 644 "${REPO_ROOT}/monitoring/fail2ban/jail.local" /etc/fail2ban/jail.d/cc-asterisk.local

log "=== 12. Exporters (binary) ==="
ARCH="$(uname -m)"
case "${ARCH}" in
  x86_64) DL_ARCH=amd64 ;;
  aarch64) DL_ARCH=arm64 ;;
  *) die "Unsupported arch: ${ARCH}" ;;
esac

NE_VER="1.8.2"
NE_TAR="node_exporter-${NE_VER}.linux-${DL_ARCH}.tar.gz"
curl -fsSL "https://github.com/prometheus/node_exporter/releases/download/v${NE_VER}/${NE_TAR}" -o "/tmp/${NE_TAR}"
tar -xzf "/tmp/${NE_TAR}" -C /tmp
install -m 755 "/tmp/node_exporter-${NE_VER}.linux-${DL_ARCH}/node_exporter" /usr/local/bin/node_exporter
rm -rf "/tmp/${NE_TAR}" "/tmp/node_exporter-${NE_VER}.linux-${DL_ARCH}"

PE_VER="0.15.0"
PE_TAR="postgres_exporter-${PE_VER}.linux-${DL_ARCH}.tar.gz"
if ! curl -fsSL --connect-timeout 30 --max-time 120 \
  "https://github.com/prometheus-community/postgres_exporter/releases/download/v${PE_VER}/${PE_TAR}" \
  -o "/tmp/${PE_TAR}"; then
  log "postgres_exporter download failed — skip (retry later)"
else
  tar -xzf "/tmp/${PE_TAR}" -C /tmp
  install -m 755 "/tmp/postgres_exporter-${PE_VER}.linux-${DL_ARCH}/postgres_exporter" /usr/local/bin/postgres_exporter
  rm -rf "/tmp/${PE_TAR}" "/tmp/postgres_exporter-${PE_VER}.linux-${DL_ARCH}"
fi

log "=== 13. systemd units ==="
for unit in "${REPO_ROOT}/ops/systemd/native/"*.service; do
  install -m 644 "${unit}" "/etc/systemd/system/$(basename "${unit}")"
done
install -m 644 "${REPO_ROOT}/ops/systemd/cc-gsm-routes.service" /etc/systemd/system/cc-gsm-routes.service
mkdir -p /etc/systemd/system/asterisk.service.d
install -m 644 "${REPO_ROOT}/ops/systemd/native/asterisk.service.d-cc.conf" \
  /etc/systemd/system/asterisk.service.d/cc.conf

# postgres_exporter DSN from cc.env
mkdir -p /etc/systemd/system/cc-postgres-exporter.service.d
cat > /etc/systemd/system/cc-postgres-exporter.service.d/override.conf <<EOF
[Service]
Environment=DATA_SOURCE_NAME=postgresql://${PG_SUPER_USER}:${PG_SUPER_PASSWORD}@127.0.0.1:${PG_PORT}/${PG_DB}?sslmode=disable
EOF

# Grafana admin password
mkdir -p /etc/systemd/system/grafana-server.service.d
cat > /etc/systemd/system/grafana-server.service.d/cc-override.conf <<EOF
[Service]
Environment=GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD:-changeme}
Environment=GF_SERVER_ROOT_URL=${GRAFANA_ROOT_URL:-http://${PUBLIC_DOMAIN}:${GRAFANA_PUBLISH_PORT}/}
Environment=GF_SERVER_HTTP_PORT=${GRAFANA_PUBLISH_PORT}
EOF

log "=== 14. cron ==="
sed "s/PG_HOST=.*/PG_HOST=127.0.0.1/" "${REPO_ROOT}/asterisk/scripts/cron.d-cc" | \
  sed "s/PG_PORT=.*/PG_PORT=${PG_PORT}/" | \
  sed "s/PG_DB=.*/PG_DB=${PG_DB}/" | \
  sed "s/PG_PASSWORD=.*/PG_PASSWORD=${PG_PASSWORD}/" > /etc/cron.d/cc
chmod 644 /etc/cron.d/cc

systemctl daemon-reload

log "=== 15. Enable services ==="
systemctl enable cc-gsm-routes.service
systemctl enable cc-asterisk-prestart.service
systemctl enable cc-reload-watcher.service cc-asterisk-exporter.service cc-ami-listener.service
systemctl enable cc-media-debug.service cc-webui.service cc-coturn.service
systemctl enable cc-postgres-exporter.service cc-node-exporter.service
systemctl disable asterisk 2>/dev/null || true
systemctl enable cc-asterisk.service

systemctl start cc-gsm-routes.service || true
systemctl restart postgresql 2>/dev/null || true
systemctl start cc-asterisk-prestart.service
systemctl restart cc-asterisk
systemctl start cc-reload-watcher.service cc-asterisk-exporter.service cc-ami-listener.service
systemctl start cc-media-debug.service cc-webui.service cc-coturn.service
systemctl start cc-postgres-exporter.service cc-node-exporter.service
systemctl restart prometheus grafana-server fail2ban 2>/dev/null || \
  systemctl restart prometheus grafana fail2ban 2>/dev/null || true

log "=== 16. Smoke checks ==="
sleep 5
systemctl is-active cc-asterisk && log "  cc-asterisk: OK" || log "  cc-asterisk: FAIL"
systemctl is-active cc-webui && log "  webui: OK" || log "  webui: FAIL"
systemctl is-active cc-coturn && log "  coturn: OK" || log "  coturn: FAIL"
asterisk -rx "core show version" 2>/dev/null | head -1 || true
curl -sf "http://127.0.0.1:9000/" >/dev/null && log "  HTTP :9000: OK" || log "  HTTP :9000: FAIL"
curl -sf "http://127.0.0.1:${PROMETHEUS_PUBLISH_PORT}/-/ready" >/dev/null && log "  Prometheus :${PROMETHEUS_PUBLISH_PORT}: OK" || log "  Prometheus: FAIL"

log "=== Done ==="
log "Web UI:  http://${PUBLIC_DOMAIN}:9000/"
log "Agent:   https://${PUBLIC_DOMAIN}:9443/agent/"
log "Grafana: http://${PUBLIC_DOMAIN}:${GRAFANA_PUBLISH_PORT}/"
log "Prom:    http://${PUBLIC_DOMAIN}:${PROMETHEUS_PUBLISH_PORT}/"

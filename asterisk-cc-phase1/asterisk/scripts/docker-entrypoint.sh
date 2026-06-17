#!/bin/bash
set -euo pipefail

CONF_DIR="/etc/asterisk"
KEY_DIR="${CONF_DIR}/keys"
PUBLIC_IP="${PUBLIC_DOMAIN:-172.16.6.183}"
GSM_MEDIA_IP="${GSM_MEDIA_ADDRESS:-172.16.4.19}"
GSM_SIGNAL_IP="${GSM_SIGNAL_ADDRESS:-172.16.4.19}"
AGENT_WEBRTC_MODE="${AGENT_WEBRTC_MODE:-manual}"

# TLS для WSS (SAN = IP сервера, иначе браузер рвёт WebSocket)
mkdir -p "${KEY_DIR}"
if [[ ! -s "${KEY_DIR}/asterisk.pem" ]] || [[ ! -s "${KEY_DIR}/asterisk.key" ]]; then
  echo "docker-entrypoint: generating TLS cert for ${PUBLIC_IP}" >&2
  openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout "${KEY_DIR}/asterisk.key" \
    -out "${KEY_DIR}/asterisk.pem" \
    -subj "/CN=${PUBLIC_IP}" \
    -addext "subjectAltName=IP:${PUBLIC_IP},DNS:${PUBLIC_IP}" 2>/dev/null \
    || openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
      -keyout "${KEY_DIR}/asterisk.key" \
      -out "${KEY_DIR}/asterisk.pem" \
      -subj "/CN=${PUBLIC_IP}"
  chmod 640 "${KEY_DIR}/asterisk.key" "${KEY_DIR}/asterisk.pem" 2>/dev/null || true
fi
chown asterisk:asterisk "${KEY_DIR}"/* 2>/dev/null || true
chmod 640 "${KEY_DIR}/asterisk.key" "${KEY_DIR}/asterisk.pem" 2>/dev/null || true

# WebRTC ICE: все IP хоста → PUBLIC_IP (агенты на 192.168.x слышат через .6.183, не .4.19)
ICE_EXTRA="${CONF_DIR}/rtp_ice_extra.conf"
{
  echo "; auto-generated $(date -Is)"
  echo "[ice_host_candidates]"
  echo "172.16.4.19 => ${PUBLIC_IP}"
  echo "172.16.6.183 => ${PUBLIC_IP}"
  echo "; GSM subnets: signal ${SIP_PROVIDER_SIGNAL_NET:-10.1.5.8/29} media ${SIP_PROVIDER_MEDIA_NET:-10.1.5.64/27}"
  for ip in $(hostname -I 2>/dev/null); do
    [[ -z "${ip}" || "${ip}" == "${PUBLIC_IP}" ]] && continue
    echo "${ip} => ${PUBLIC_IP}"
  done
} > "${ICE_EXTRA}.tmp"
mv "${ICE_EXTRA}.tmp" "${ICE_EXTRA}"

# Заглушки для include'ов, генерируемых cc_config_sync.py (иначе Asterisk падает на
# отсутствующем #include до первой синхронизации из БД). Не перезаписываем существующие.
for gen in pjsip_agents.conf queues_generated.conf vdn_generated.conf; do
  [[ -s "${CONF_DIR}/${gen}" ]] || echo "; placeholder — заполняется cc_config_sync.py из БД" > "${CONF_DIR}/${gen}"
done

# Переключаемый WebRTC-профиль для [agent-tpl] (#include в pjsip.conf).
# AGENT_WEBRTC_MODE=manual — ручной набор (текущее поведение, bundle=no, webrtc=no).
# AGENT_WEBRTC_MODE=standard — стандартный webrtc=yes (avpf/dtls/ice/rtcp_mux/bundle включает сам).
WEBRTC_INC="${CONF_DIR}/pjsip_agent_webrtc.conf"
if [[ "${AGENT_WEBRTC_MODE}" == "standard" ]]; then
  cat > "${WEBRTC_INC}.tmp" <<EOF
; auto-generated $(date -Is) — AGENT_WEBRTC_MODE=standard
webrtc=yes
dtls_cert_file=${KEY_DIR}/asterisk.pem
dtls_private_key=${KEY_DIR}/asterisk.key
EOF
else
  cat > "${WEBRTC_INC}.tmp" <<EOF
; auto-generated $(date -Is) — AGENT_WEBRTC_MODE=manual
use_avpf=yes
media_encryption=dtls
dtls_verify=fingerprint
dtls_setup=actpass
dtls_cert_file=${KEY_DIR}/asterisk.pem
dtls_private_key=${KEY_DIR}/asterisk.key
ice_support=yes
media_use_received_transport=no
rtcp_mux=yes
; bundle=no: на части клиентов Chrome/Edge bundle=yes ломает inbound SRTP
bundle=no
webrtc=no
EOF
fi
mv "${WEBRTC_INC}.tmp" "${WEBRTC_INC}"
echo "docker-entrypoint: AGENT_WEBRTC_MODE=${AGENT_WEBRTC_MODE}" >&2

for pattern in cdr_pgsql.conf cel_pgsql.conf manager.conf ari.conf pjsip_provider.conf pjsip.conf; do
  src="${CONF_DIR}/${pattern}"
  if [[ -f "${src}" ]]; then
    sed \
      -e "s|\${SIP_PROVIDER_SIGNAL_NET}|${SIP_PROVIDER_SIGNAL_NET:-10.1.5.8/29}|g" \
      -e "s|\${SIP_PROVIDER_MEDIA_NET}|${SIP_PROVIDER_MEDIA_NET:-10.1.5.64/27}|g" \
      -e "s|\${GSM_MEDIA_ADDRESS}|${GSM_MEDIA_IP}|g" \
      -e "s|\${GSM_SIGNAL_ADDRESS}|${GSM_SIGNAL_IP}|g" \
      -e "s|\${PUBLIC_DOMAIN}|${PUBLIC_IP}|g" \
      "${src}" > "${src}.tmp"
    mv "${src}.tmp" "${src}"
  fi
done

for pattern in cdr_pgsql.conf cel_pgsql.conf manager.conf ari.conf; do
  src="${CONF_DIR}/${pattern}"
  if [[ -f "${src}" ]]; then
    sed \
      -e "s|\${PG_HOST}|${PG_HOST:-127.0.0.1}|g" \
      -e "s|\${PG_PORT}|${PG_PORT:-5433}|g" \
      -e "s|\${PG_DB}|${PG_DB:-asterisk_cc}|g" \
      -e "s|\${PG_USER}|${PG_USER:-asterisk}|g" \
      -e "s|\${PG_PASSWORD}|${PG_PASSWORD:-changeme}|g" \
      -e "s|\${ASTERISK_AMI_PASSWORD}|${ASTERISK_AMI_PASSWORD:-changeme}|g" \
      -e "s|\${ASTERISK_ARI_PASSWORD}|${ASTERISK_ARI_PASSWORD:-changeme}|g" \
      "${src}" > "${src}.tmp"
    mv "${src}.tmp" "${src}"
  fi
done

chmod +x /opt/cc/scripts/start_asterisk_exporter.sh 2>/dev/null || true
chmod +x /opt/cc/scripts/*.agi 2>/dev/null || true
chmod +x /opt/cc/scripts/cc_config_sync.py 2>/dev/null || true
chmod +x /opt/cc/scripts/asterisk_log_maintenance.sh 2>/dev/null || true
/opt/cc/scripts/asterisk_log_maintenance.sh /var/log/asterisk 2>/dev/null || true

# Reload Asterisk when Web UI / sync touches .reload_requested
(
  while true; do
    if [[ -f /etc/asterisk/.reload_requested ]]; then
      echo "cc_config_sync: applying reload" >&2
      asterisk -rx "dialplan reload" 2>/dev/null || true
      asterisk -rx "queue reload all" 2>/dev/null || true
      asterisk -rx "module reload res_pjsip.so" 2>/dev/null || true
      asterisk -rx "http reload" 2>/dev/null || true
      rm -f /etc/asterisk/.reload_requested
    fi
    sleep 2
  done
) &

AST_BIN="/usr/sbin/asterisk"
[[ -x "${AST_BIN}" ]] || AST_BIN="/usr/sbin/asterisk-bin"

# Prometheus metrics on :9815 (host network — reachable from Prometheus via host.docker.internal)
if [[ -x /opt/cc/scripts/start_asterisk_exporter.sh ]]; then
  (
    export ASTERISK_BIN="${AST_BIN}"
    sleep 8
    while true; do
      /opt/cc/scripts/start_asterisk_exporter.sh || echo "asterisk_exporter exited, restart in 10s" >&2
      sleep 10
    done
  ) &
fi

ulimit -n 65536 2>/dev/null || true

# CC_MEDIA_DEBUG=1: полный SIP (pjsip logger) + verbose dialplan
# CC_RTP_DEBUG=1: каждый RTP-пакет (очень шумно — только на время отладки GSM/WebRTC)
if [[ "${CC_MEDIA_DEBUG:-1}" != "0" ]]; then
  (
    for _ in $(seq 1 60); do
      if "${AST_BIN}" -rx "core show version" 2>/dev/null | grep -qi asterisk; then
        break
      fi
      sleep 2
    done
    "${AST_BIN}" -rx "core set verbose 5" 2>/dev/null || true
    "${AST_BIN}" -rx "core set debug 3" 2>/dev/null || true
    "${AST_BIN}" -rx "pjsip set logger on" 2>/dev/null || true
    if [[ "${CC_RTP_DEBUG:-0}" == "1" ]]; then
      "${AST_BIN}" -rx "rtp set debug on" 2>/dev/null || true
      echo "docker-entrypoint: RTP packet debug ON (CC_RTP_DEBUG=1)" >&2
    else
      "${AST_BIN}" -rx "rtp set debug off" 2>/dev/null || true
    fi
    echo "docker-entrypoint: CC logging enabled (CC_MEDIA_DEBUG=${CC_MEDIA_DEBUG:-1} CC_RTP_DEBUG=${CC_RTP_DEBUG:-0})" >&2
    "${AST_BIN}" -rx "module reload cdr_pgsql.so" 2>/dev/null || true
    "${AST_BIN}" -rx "module reload cel_pgsql.so" 2>/dev/null || true
    "${AST_BIN}" -rx "cdr status" 2>/dev/null | head -5 >&2 || true
    "${AST_BIN}" -rx "cel show status" 2>/dev/null | head -12 >&2 || true
  ) &
fi

exec "${AST_BIN}" -f -vvv

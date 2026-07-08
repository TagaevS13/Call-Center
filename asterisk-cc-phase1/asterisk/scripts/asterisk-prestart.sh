#!/bin/bash
# Native prestart: TLS, ICE, env substitution before asterisk.service starts.
set -euo pipefail

if [[ -f /etc/cc/cc.env ]]; then
  set -a
  # shellcheck source=/dev/null
  source /etc/cc/cc.env
  set +a
fi

CONF_DIR="/etc/asterisk"
KEY_DIR="${CONF_DIR}/keys"
PUBLIC_IP="${PUBLIC_DOMAIN:-172.16.6.183}"
GSM_MEDIA_IP="${GSM_MEDIA_ADDRESS:-10.212.154.35}"
GSM_SIGNAL_IP="${GSM_SIGNAL_ADDRESS:-172.16.4.19}"
AGENT_WEBRTC_MODE="${AGENT_WEBRTC_MODE:-manual}"

PG_PORT="${PG_PORT:-5433}"

mkdir -p "${KEY_DIR}"
if [[ ! -s "${KEY_DIR}/asterisk.pem" ]] || [[ ! -s "${KEY_DIR}/asterisk.key" ]]; then
  echo "asterisk-prestart: generating TLS cert for ${PUBLIC_IP}" >&2
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

ICE_EXTRA="${CONF_DIR}/rtp_ice_extra.conf"
{
  echo "; auto-generated $(date -Is)"
  echo "[ice_host_candidates]"
  echo "172.16.4.19 => ${PUBLIC_IP}"
  echo "${PUBLIC_IP} => ${PUBLIC_IP}"
  echo "; GSM subnets: signal ${SIP_PROVIDER_SIGNAL_NET:-10.1.5.8/29} media ${SIP_PROVIDER_MEDIA_NET:-10.1.5.64/27}"
  for ip in $(hostname -I 2>/dev/null); do
    [[ -z "${ip}" || "${ip}" == "${PUBLIC_IP}" ]] && continue
    [[ "${ip}" == "${GSM_MEDIA_IP}" || "${ip}" == "${GSM_SIGNAL_IP}" ]] && continue
    echo "${ip} => ${PUBLIC_IP}"
  done
} > "${ICE_EXTRA}.tmp"
mv "${ICE_EXTRA}.tmp" "${ICE_EXTRA}"

for gen in pjsip_agents.conf queues_generated.conf vdn_generated.conf; do
  [[ -s "${CONF_DIR}/${gen}" ]] || echo "; placeholder — заполняется cc_config_sync.py из БД" > "${CONF_DIR}/${gen}"
done

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
media_use_received_transport=yes
rtcp_mux=yes
bundle=no
webrtc=no
EOF
fi
mv "${WEBRTC_INC}.tmp" "${WEBRTC_INC}"
echo "asterisk-prestart: AGENT_WEBRTC_MODE=${AGENT_WEBRTC_MODE}" >&2

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
      -e "s|\${PG_PORT}|${PG_PORT}|g" \
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

chown -R asterisk:asterisk /var/log/asterisk /var/spool/asterisk 2>/dev/null || true
echo "asterisk-prestart: done" >&2

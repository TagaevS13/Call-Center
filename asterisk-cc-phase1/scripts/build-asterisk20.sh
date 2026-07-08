#!/usr/bin/env bash
# Build and install Asterisk 20 LTS from source (when apt gives 18.x).
set -euo pipefail

AST_VERSION="${AST_VERSION:-20.20.0}"
TARBALL="asterisk-${AST_VERSION}.tar.gz"
URL="https://downloads.asterisk.org/pub/telephony/asterisk/${TARBALL}"
SRC="/usr/src/asterisk-${AST_VERSION}"
JOBS="${JOBS:-$(nproc)}"

log() { echo "[build-asterisk20] $*" >&2; }
die() { log "FATAL: $*"; exit 1; }

if [[ "${FORCE_REBUILD:-0}" != "1" ]] && /usr/sbin/asterisk -V 2>/dev/null | grep -qE 'Asterisk 2[0-9]\.'; then
  if ! dpkg -l asterisk 2>/dev/null | grep -q '^ii'; then
    if asterisk -rx 'module show like res_pjsip' 2>/dev/null | grep -q res_pjsip; then
      log "Asterisk 20+ with PJSIP already OK: $(/usr/sbin/asterisk -V 2>/dev/null | head -1)"
      exit 0
    fi
    log "Asterisk 20 present but PJSIP missing — rebuilding modules"
  fi
fi

log "Installing build dependencies..."
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
apt-get update -qq
apt-get install -y build-essential wget curl \
  libssl-dev libncurses-dev libnewt-dev libxml2-dev libsqlite3-dev \
  uuid-dev libjansson-dev libcurl4-openssl-dev libpq-dev \
  libedit-dev libspeex-dev libspeexdsp-dev libopus-dev \
  libgsm1-dev libogg-dev libvorbis-dev libical-dev \
  libspandsp-dev liblua5.2-dev liburiparser-dev \
  xmlstarlet pkg-config

if [[ ! -d "${SRC}" ]]; then
  log "Downloading ${URL}..."
  cd /usr/src
  rm -f "${TARBALL}"
  wget -q --timeout=120 --tries=3 "${URL}" -O "${TARBALL}"
  [[ -s "${TARBALL}" ]] || die "Download failed or empty: ${TARBALL}"
  tar xzf "${TARBALL}"
fi
[[ -d "${SRC}" ]] || die "Source dir missing: ${SRC}"

cd "${SRC}"
./configure --with-pjproject-bundled --with-jansson-bundled
make menuselect.makeopts
menuselect/menuselect --enable res_pjsip_transport_websocket menuselect.makeopts
menuselect/menuselect --enable res_http_websocket menuselect.makeopts
menuselect/menuselect --enable res_ari menuselect.makeopts
menuselect/menuselect --enable cdr_pgsql menuselect.makeopts
menuselect/menuselect --enable cel_pgsql menuselect.makeopts
menuselect/menuselect --enable app_queue menuselect.makeopts
menuselect/menuselect --enable app_confbridge menuselect.makeopts
menuselect/menuselect --enable app_mixmonitor menuselect.makeopts
menuselect/menuselect --disable chan_sip menuselect.makeopts
menuselect/menuselect --disable app_voicemail menuselect.makeopts

log "Building (${JOBS} jobs)..."
make -j"${JOBS}"
make install
ldconfig

# Ensure CLI binary is on PATH (some distros leave a stale symlink)
if [[ ! -x /usr/sbin/asterisk ]] && [[ -x "${SRC}/main/asterisk" ]]; then
  install -m 755 "${SRC}/main/asterisk" /usr/sbin/asterisk
elif [[ -x /usr/sbin/asterisk-bin ]]; then
  install -m 755 /usr/sbin/asterisk-bin /usr/sbin/asterisk
fi
[[ -x /usr/sbin/asterisk ]] || die "asterisk binary missing after make install"

id asterisk &>/dev/null || useradd -r -d /var/lib/asterisk -s /usr/sbin/nologin asterisk
mkdir -p /var/run/asterisk /var/log/asterisk /var/spool/asterisk
chown -R asterisk:asterisk /var/run/asterisk /var/log/asterisk /var/spool/asterisk

log "Done: $(/usr/sbin/asterisk -V)"

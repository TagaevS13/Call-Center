#!/usr/bin/env bash
# Fix vsftpd: user_sub_token, use_localtime, sorbon ftp dirs, recordings bind.
# On server: sudo bash fix-vsftpd-on-server.sh
set -euo pipefail

FTP_USER="${FTP_USER:-sorbon}"
PASV_ADDRESS="${PASV_ADDRESS:-172.16.6.183}"
REC="${RECORDINGS_DIR:-/opt/call-center/asterisk-cc-phase1/recordings}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run: sudo PASV_ADDRESS=172.16.6.183 bash $0" >&2
  exit 1
fi

apt-get install -y -qq vsftpd 2>/dev/null || true

cat >/etc/vsftpd.conf <<'EOF'
listen=YES
listen_ipv6=NO
anonymous_enable=NO
local_enable=YES
write_enable=YES
local_umask=022
dirmessage_enable=YES
xferlog_enable=YES
xferlog_file=/var/log/vsftpd.log
connect_from_port_20=YES
userlist_enable=YES
userlist_file=/etc/vsftpd.userlist
userlist_deny=NO
chroot_local_user=YES
allow_writeable_chroot=YES
user_sub_token=$USER
local_root=/home/$USER/ftp
use_localtime=NO
pasv_enable=YES
pasv_min_port=40000
pasv_max_port=40100
pasv_addr_resolve=NO
secure_chroot_dir=/var/run/vsftpd/empty
pam_service_name=vsftpd
ssl_enable=NO
EOF
echo "pasv_address=${PASV_ADDRESS}" >>/etc/vsftpd.conf

echo "$FTP_USER" >/etc/vsftpd.userlist

FTP_HOME="/home/${FTP_USER}/ftp"
mkdir -p "${FTP_HOME}/upload"
chown root:root "${FTP_HOME}"
chmod 755 "${FTP_HOME}"
chown "${FTP_USER}:${FTP_USER}" "${FTP_HOME}/upload"

if [[ -d "$REC" ]]; then
  mkdir -p "${FTP_HOME}/recordings"
  if ! mountpoint -q "${FTP_HOME}/recordings"; then
    mount --bind "$REC" "${FTP_HOME}/recordings"
    grep -qF "${FTP_HOME}/recordings" /etc/fstab || \
      echo "$REC ${FTP_HOME}/recordings none bind 0 0" >> /etc/fstab
  fi
  echo "recordings -> $REC"
fi

if [[ -d /opt/call-center ]]; then
  mkdir -p "${FTP_HOME}/call-center"
  mountpoint -q "${FTP_HOME}/call-center" || \
    mount --bind /opt/call-center "${FTP_HOME}/call-center" 2>/dev/null || true
fi

systemctl enable vsftpd
systemctl restart vsftpd

echo ""
echo "vsftpd: $(systemctl is-active vsftpd)"
ss -tlnp | grep ':21' || true
ls -la "${FTP_HOME}/"
echo ""
echo "FileZilla: FTP 172.16.6.183:21 user ${FTP_USER} passive ON"

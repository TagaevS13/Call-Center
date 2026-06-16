#!/usr/bin/env bash
# Self-contained FTP+SFTP setup — no other repo files required.
# On server: curl -sO ... OR scp this file, then:
#   sudo PASV_ADDRESS=172.16.6.183 bash setup-ftp-sftp-standalone.sh
set -euo pipefail

FTP_USER="${FTP_USER:-sorbon}"
PASV_ADDRESS="${PASV_ADDRESS:-172.16.6.183}"
INTERNAL_NETS="${INTERNAL_NETS:-10.0.0.0/8 172.16.0.0/12}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run: sudo PASV_ADDRESS=172.16.6.183 bash $0" >&2
  exit 1
fi

echo "=== Packages ==="
apt-get update -qq
apt-get install -y -qq openssh-server vsftpd

echo "=== SFTP ==="
if ! grep -q '^Subsystem[[:space:]]*sftp' /etc/ssh/sshd_config; then
  echo "Subsystem sftp /usr/lib/openssh/sftp-server" >> /etc/ssh/sshd_config
fi
systemctl enable --now ssh
systemctl reload ssh

echo "=== FTP home for ${FTP_USER} ==="
id "$FTP_USER" >/dev/null
FTP_HOME="/home/${FTP_USER}/ftp"
mkdir -p "${FTP_HOME}/upload"
chown root:root "${FTP_HOME}"
chmod 755 "${FTP_HOME}"
chown "${FTP_USER}:${FTP_USER}" "${FTP_HOME}/upload"
if [[ -d /opt/call-center ]]; then
  install -d -o "${FTP_USER}" -g "${FTP_USER}" "${FTP_HOME}/call-center"
  if ! mountpoint -q "${FTP_HOME}/call-center"; then
    mount --bind /opt/call-center "${FTP_HOME}/call-center"
    grep -qF "${FTP_HOME}/call-center" /etc/fstab || \
      echo "/opt/call-center ${FTP_HOME}/call-center none bind 0 0" >> /etc/fstab
  fi
fi

echo "=== vsftpd.conf ==="
cat >/etc/vsftpd.conf <<EOF
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
user_sub_token=\$USER
local_root=/home/\$USER/ftp
use_localtime=NO
pasv_enable=YES
pasv_min_port=40000
pasv_max_port=40100
pasv_address=${PASV_ADDRESS}
pasv_addr_resolve=NO
secure_chroot_dir=/var/run/vsftpd/empty
pam_service_name=vsftpd
ssl_enable=NO
EOF

echo "$FTP_USER" >/etc/vsftpd.userlist

systemctl enable vsftpd
systemctl restart vsftpd

if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q 'Status: active'; then
  for net in $INTERNAL_NETS; do
    ufw allow from "$net" to any port 21 proto tcp comment 'FTP' || true
    ufw allow from "$net" to any port 40000:40100/tcp comment 'FTP passive' || true
  done
  ufw reload || true
fi

echo ""
echo "=== Check ==="
ss -tlnp | grep -E ':21|:22' || true
systemctl is-active vsftpd
echo ""
echo "FileZilla FTP:  172.16.6.183 port 21 user ${FTP_USER} (passive ON)"
echo "FileZilla SFTP: 172.16.6.183 port 22 user ${FTP_USER}"

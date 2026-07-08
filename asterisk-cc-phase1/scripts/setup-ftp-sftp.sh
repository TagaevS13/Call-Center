#!/usr/bin/env bash
# Install FTP (vsftpd) + verify SFTP (OpenSSH) on Ubuntu host "project".
# Run on server: sudo bash scripts/setup-ftp-sftp.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FTP_USER="${FTP_USER:-sorbon}"
PASV_ADDRESS="${PASV_ADDRESS:-172.16.6.183}"
INTERNAL_NETS="${INTERNAL_NETS:-10.0.0.0/8 172.16.0.0/12}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash $0" >&2
  exit 1
fi

echo "=== SFTP (OpenSSH) ==="
apt-get update -qq
apt-get install -y -qq openssh-server vsftpd

if ! grep -q '^Subsystem[[:space:]]*sftp' /etc/ssh/sshd_config; then
  echo "Subsystem sftp /usr/lib/openssh/sftp-server" >> /etc/ssh/sshd_config
fi
systemctl enable --now ssh
systemctl reload ssh
echo "SFTP: use FileZilla → Protocol SFTP, port 22, user ${FTP_USER}"

echo "=== FTP user ${FTP_USER} ==="
if ! id "$FTP_USER" &>/dev/null; then
  echo "User ${FTP_USER} does not exist." >&2
  exit 1
fi

FTP_HOME="/home/${FTP_USER}/ftp"
mkdir -p "${FTP_HOME}/upload"
chown root:root "/home/${FTP_USER}/ftp"
chmod 755 "/home/${FTP_USER}/ftp"
chown "${FTP_USER}:${FTP_USER}" "${FTP_HOME}/upload"
chmod 755 "${FTP_HOME}/upload"
if [[ -d /opt/call-center ]]; then
  install -d -o "${FTP_USER}" -g "${FTP_USER}" "${FTP_HOME}/call-center"
  if ! mountpoint -q "${FTP_HOME}/call-center"; then
    mount --bind /opt/call-center "${FTP_HOME}/call-center"
    FSTAB_LINE="/opt/call-center ${FTP_HOME}/call-center none bind 0 0"
    grep -qF "${FTP_HOME}/call-center" /etc/fstab || echo "$FSTAB_LINE" >> /etc/fstab
  fi
fi

echo "=== vsftpd ==="
install -m 0644 "${REPO_ROOT}/ops/vsftpd/vsftpd.conf" /etc/vsftpd.conf
install -m 0644 "${REPO_ROOT}/ops/vsftpd/userlist" /etc/vsftpd.userlist
grep -q "^${FTP_USER}\$" /etc/vsftpd.userlist || echo "${FTP_USER}" >> /etc/vsftpd.userlist

# pasv_address appended by ops/vsftpd/vsftpd.conf or below
if ! grep -q '^pasv_address=' /etc/vsftpd.conf; then
  echo "pasv_address=${PASV_ADDRESS}" >> /etc/vsftpd.conf
else
  sed -i "s/^pasv_address=.*/pasv_address=${PASV_ADDRESS}/" /etc/vsftpd.conf
fi
grep -q '^user_sub_token=' /etc/vsftpd.conf || echo 'user_sub_token=$USER' >> /etc/vsftpd.conf
grep -q '^use_localtime=' /etc/vsftpd.conf || echo 'use_localtime=NO' >> /etc/vsftpd.conf

systemctl enable vsftpd
systemctl restart vsftpd

echo "=== Firewall (ufw) ==="
if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then
  for net in $INTERNAL_NETS; do
    ufw allow from "$net" to any port 21 proto tcp comment 'FTP'
    ufw allow from "$net" to any port 40000:40100 proto tcp comment 'FTP passive'
  done
  ufw reload
else
  echo "ufw inactive — skip (or open 21/tcp and 40000:40100/tcp manually)"
fi

echo "=== Listen check ==="
ss -tlnp | grep -E ':21|:22' || true
systemctl --no-pager status vsftpd | head -5

cat <<EOF

Done.

FileZilla — SFTP (recommended):
  Protocol: SFTP - SSH File Transfer Protocol
  Host:     ${PASV_ADDRESS}
  Port:     22
  User:     ${FTP_USER}

FileZilla — FTP:
  Protocol: FTP - File Transfer Protocol
  Host:     ${PASV_ADDRESS}
  Port:     21
  User:     ${FTP_USER}
  Transfer → FTP → Passive mode: ON

FTP files: ${FTP_HOME}/upload
Symlink:   ${FTP_HOME}/call-center → /opt/call-center (if exists)

EOF

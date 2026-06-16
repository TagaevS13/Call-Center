Backup before GSM media/signaling alignment to 172.16.4.19
Created: 2026-06-10

Restore example (on server):
  cp backups/pre-4.19-2026-06-10/asterisk/etc/pjsip_provider.conf asterisk/etc/
  docker compose restart asterisk-a

WebRTC agents remain on PUBLIC_DOMAIN 172.16.6.183 (pjsip agent-tpl).

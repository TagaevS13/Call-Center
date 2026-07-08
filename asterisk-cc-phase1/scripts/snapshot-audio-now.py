#!/usr/bin/env python3
"""Quick snapshot without waiting (config + recent logs)."""
import paramiko

HOST = "172.16.6.183"
USER = "sorbon"
PASS = "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"

cmds = [
    ("env", f"grep -E 'PUBLIC_DOMAIN|GSM_MEDIA|AGENT_WEBRTC|ICE_TRANSPORT' {REMOTE}/.env"),
    ("pjsip_provider", f"grep -E 'media_address|bind_rtp|match=' /etc/asterisk/pjsip_provider.conf"),
    ("endpoint", f"asterisk -rx 'pjsip show endpoint 1001' | grep -E 'media_address|webrtc|bundle|ice_support|Contact'"),
    ("queue", f"asterisk -rx 'queue show russkaya'"),
    ("rtp_got", f"sh -c 'tail -c 3000000 /var/log/asterisk/full | grep -a \"Got  RTP packet from\" | tail -20'"),
    ("rtp_gsm", f"sh -c 'tail -c 3000000 /var/log/asterisk/full | grep -a \"Got  RTP packet from\" | grep 10.1.5 | tail -10'"),
    ("rtp_sent_agent", f"sh -c 'tail -c 3000000 /var/log/asterisk/full | grep -a \"Sent RTP packet to\" | grep 192.168 | tail -10'"),
    ("trace", f"sh -c 'grep CC-TRACE /var/log/asterisk/full | tail -8'"),
]

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=30)
lines = []
for name, cmd in cmds:
    _, o, e = c.exec_command(cmd, timeout=90)
    data = o.read().decode("utf-8", errors="replace").strip()
    lines.append(f"=== {name} ===\n{data or '(empty)'}\n")
c.close()
text = "\n".join(lines)
path = r"C:\Users\ADMIN\CC\asterisk-cc-phase1\scripts\_snapshot_now.txt"
open(path, "w", encoding="utf-8").write(text)
print(text)

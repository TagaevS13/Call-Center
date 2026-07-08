#!/usr/bin/env python3
"""Live audio diagnostics on 172.16.6.183."""
import paramiko

HOST = "172.16.6.183"
USER = "sorbon"
PASS = "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"

cmds = [
    ("env", f"grep -E 'AGENT_WEBRTC|CC_RTP|PUBLIC_DOMAIN|GSM_MEDIA' {REMOTE}/.env 2>/dev/null || true"),
    ("webrtc_inc", f"cat /etc/asterisk/pjsip_agent_webrtc.conf 2>/dev/null || true"),
    ("endpoint_1001", f"asterisk -rx 'pjsip show endpoint 1001'"),
    ("contacts", f"asterisk -rx 'pjsip show contacts'"),
    ("channelstats", f"asterisk -rx 'pjsip show channelstats'"),
    ("rtp_sent_agent", """sh -c 'grep "Sent RTP" /var/log/asterisk/full | grep 192.168 | tail -20'"""),
    ("rtp_got_agent", """sh -c 'grep "Got RTP" /var/log/asterisk/full | grep 192.168 | tail -20'"""),
    ("rtp_got_gsm", """sh -c 'grep "Got RTP" /var/log/asterisk/full | grep "10\\.1\\.5" | tail -20'"""),
    ("cc_trace", """sh -c 'grep CC-TRACE /var/log/asterisk/full | tail -15'"""),
    ("turn", "ss -ulnp | grep 3478 || netstat -ulnp 2>/dev/null | grep 3478 || true"),
]

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=30)

out_path = r"C:\Users\ADMIN\CC\asterisk-cc-phase1\scripts\_diag_audio_live.txt"
lines = []
for name, cmd in cmds:
    _, o, e = c.exec_command(cmd, timeout=90)
    data = o.read().decode("utf-8", errors="replace").strip()
    err = e.read().decode("utf-8", errors="replace").strip()
    block = f"\n=== {name} ===\n{data or '(empty)'}"
    if err:
        block += f"\n(stderr) {err}"
    lines.append(block)

c.close()
text = "\n".join(lines)
with open(out_path, "w", encoding="utf-8") as f:
    f.write(text)
print(text[:12000])

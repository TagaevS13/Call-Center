#!/usr/bin/env python3
"""Capture Asterisk audio legs during live call (poll channelstats + RTP logs)."""
import paramiko
import time

HOST = "172.16.6.183"
USER = "sorbon"
PASS = "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"
OUT = r"C:\Users\ADMIN\CC\asterisk-cc-phase1\scripts\_live_call_capture.txt"

POLL_SCRIPT = r"""#!/bin/bash
set -e
cd /opt/call-center/asterisk-cc-phase1
AST="asterisk -rx"
LOG="sh -c"

echo "=== CONFIG SNAPSHOT $(date -Is) ==="
grep -E '^(PUBLIC_DOMAIN|GSM_MEDIA|AGENT_WEBRTC|ICE_TRANSPORT)=' .env 2>/dev/null || true
$LOG 'grep -E "media_address|bind_rtp|external_media" /etc/asterisk/pjsip_provider.conf /etc/asterisk/pjsip.conf /etc/asterisk/rtp.conf 2>/dev/null | head -30'

echo ""
echo "=== POLL channelstats (90s, every 3s) — MAKE A TEST CALL NOW ==="
for i in $(seq 1 30); do
  echo "--- tick $i $(date -Is) ---"
  $AST 'pjsip show channelstats' 2>/dev/null | grep -E '^(Channel:|Endpoint:|Output|Input| 1001|provider|PJSIP)' || echo "(no active channels)"
  sleep 3
done

echo ""
echo "=== RTP tail (last 2MB) ==="
$LOG 'tail -c 2000000 /var/log/asterisk/full | grep -a "Got  RTP packet from" | tail -25'
echo "--- sent to agent ---"
$LOG 'tail -c 2000000 /var/log/asterisk/full | grep -a "Sent RTP packet to" | grep -E "192\.168|492[0-9]{2}" | tail -15'
echo "--- sent to gsm ---"
$LOG 'tail -c 2000000 /var/log/asterisk/full | grep -a "Sent RTP packet to" | grep "10\.1\.5" | tail -10'
echo "--- got gsm ---"
$LOG 'tail -c 2000000 /var/log/asterisk/full | grep -a "Got  RTP packet from" | grep "10\.1\.5" | tail -10'

echo ""
echo "=== CC-TRACE last 12 ==="
$LOG 'grep CC-TRACE /var/log/asterisk/full | tail -12'

echo ""
echo "=== coturn last 20 lines ==="
journalctl -u cc-coturn --no-pager -n 20 2>/dev/null || true
"""

def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASS, timeout=30)

    # upload and run poll script
    sftp = c.open_sftp()
    remote_sh = f"{REMOTE}/scripts/_poll_call.sh"
    with sftp.file(remote_sh, "w") as f:
        f.write(POLL_SCRIPT)
    sftp.chmod(remote_sh, 0o755)
    sftp.close()

    print("Polling 90s on server — place test call to 1263 now...", flush=True)
    _, stdout, stderr = c.exec_command(f"bash {remote_sh}", timeout=120)
    data = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    c.close()

    text = data + ("\nSTDERR:\n" + err if err.strip() else "")
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)
    print(text[:14000])

if __name__ == "__main__":
    main()

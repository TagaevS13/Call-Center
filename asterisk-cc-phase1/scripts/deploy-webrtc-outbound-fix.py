#!/usr/bin/env python3
"""Deploy WebRTC outbound fix: media_use_received_transport + standard mode."""
import os
import sys
import paramiko
from scp import SCPClient

HOST = "172.16.6.183"
USER = "sorbon"
PASS = os.environ.get("CC_DEPLOY_PASS", "qwerty123")
REMOTE = "/opt/call-center/asterisk-cc-phase1"
LOCAL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

FILES = [
    "asterisk/scripts/asterisk-prestart.sh",
    "webui/agent/agent.js",
]


def upsert_env(client, key: str, value: str) -> None:
    cmd = (
        f"cd {REMOTE} && "
        f"(grep -q '^{key}=' .env 2>/dev/null && sed -i 's/^{key}=.*/{key}={value}/' .env "
        f"|| echo '{key}={value}' >> .env)"
    )
    _, o, _ = client.exec_command(cmd, timeout=60)
    o.channel.recv_exit_status()


def main() -> int:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASS, timeout=30)
    with SCPClient(c.get_transport()) as scp:
        for rel in FILES:
            scp.put(os.path.join(LOCAL, rel), f"{REMOTE}/{rel}")

    upsert_env(c, "AGENT_WEBRTC_MODE", "standard")
    upsert_env(c, "ICE_TRANSPORT_POLICY", "all")
    print("Set AGENT_WEBRTC_MODE=standard ICE_TRANSPORT_POLICY=all")

    cmds = [
        f"cd {REMOTE} && systemctl restart cc-asterisk-prestart cc-asterisk cc-webui",
        "sleep 12",
        f"cat /etc/asterisk/pjsip_agent_webrtc.conf",
        f"asterisk -rx 'pjsip show endpoint 1001' | grep -E 'webrtc|bundle|media_use_received|Contact'",
    ]
    for cmd in cmds:
        print(f"\n>>> {cmd}")
        _, o, e = c.exec_command(cmd, timeout=300)
        out = o.read().decode("utf-8", errors="replace")
        err = e.read().decode("utf-8", errors="replace")
        if out:
            print(out[:3000])
        if err.strip():
            print("stderr:", err[:1000])
    c.close()
    print("\nDone. Ctrl+Shift+R on agent page, test call 1263.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

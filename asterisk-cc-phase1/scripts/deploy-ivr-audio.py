#!/usr/bin/env python3
import os
import sys
import paramiko
from scp import SCPClient

HOST = "172.16.6.183"
USER = "sorbon"
PASSWORD = os.environ.get("CC_DEPLOY_PASS", "qwerty123")
REMOTE = "/opt/call-center/asterisk-cc-phase1"
LOCAL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

FILES = [
    "asterisk/etc/extensions.conf",
    "asterisk/etc/queues.conf",
    "asterisk/sounds/custom/101.wav",
    "asterisk/sounds/custom/101.al",
    "webui/index.html",
    "webui/portal.js",
    "webui/shared/auth.js",
    "webui/agent/sounds/note97.wav",
    "webui/agent/agent.js",
    "webui/cc_config_sync.py",
    "asterisk/scripts/cc_config_sync.py",
]


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connect {USER}@{HOST}", flush=True)
    client.connect(HOST, username=USER, password=PASSWORD, timeout=30)

    with SCPClient(client.get_transport()) as scp:
        for rel in FILES:
            local = os.path.join(LOCAL, rel)
            remote_dir = os.path.dirname(f"{REMOTE}/{rel}").replace("\\", "/")
            stdin, stdout, stderr = client.exec_command(f"mkdir -p {remote_dir}", timeout=60)
            stdout.channel.recv_exit_status()
            print(f"Upload {rel}", flush=True)
            scp.put(local, f"{REMOTE}/{rel}")

    cmds = [
        f"cd {REMOTE} && systemctl restart cc-asterisk-prestart cc-asterisk cc-webui",
        "sleep 8",
        f"cd {REMOTE} && cd /opt/call-center/asterisk-cc-phase1/webui && python3 cc_config_sync.py --etc /asterisk-etc --no-reload",
        f"cd {REMOTE} && asterisk -rx 'dialplan reload'",
        f"cd {REMOTE} && asterisk -rx 'queue reload all'",
        f"cd {REMOTE} && ls -la /var/lib/asterisk/sounds/custom/",
    ]
    for cmd in cmds:
        print(f"\n>>> {cmd}", flush=True)
        stdin, stdout, stderr = client.exec_command(cmd, timeout=300)
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        code = stdout.channel.recv_exit_status()
        if out:
            print(out[:4000], flush=True)
        if err.strip():
            print("stderr:", err[:2000], flush=True)
        print(f"exit {code}", flush=True)
        if code != 0:
            client.close()
            return code

    client.close()
    print("\nIVR audio deploy finished", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Deploy TURN relay fix + set ICE_TRANSPORT_POLICY=relay on server."""
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
    "webui/agent/agent.js",
    "webui/cc_api.py",
]


def upsert_env(client, key: str, value: str) -> None:
    cmd = (
        f"cd {REMOTE} && "
        f"(grep -q '^{key}=' .env 2>/dev/null && sed -i 's/^{key}=.*/{key}={value}/' .env "
        f"|| echo '{key}={value}' >> .env)"
    )
    _, o, e = client.exec_command(cmd, timeout=60)
    o.channel.recv_exit_status()


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connect {USER}@{HOST}", flush=True)
    client.connect(HOST, username=USER, password=PASSWORD, timeout=30)

    with SCPClient(client.get_transport()) as scp:
        for rel in FILES:
            local = os.path.join(LOCAL, rel)
            remote_dir = os.path.dirname(f"{REMOTE}/{rel}").replace("\\", "/")
            _, stdout, _ = client.exec_command(f"mkdir -p {remote_dir}", timeout=60)
            stdout.channel.recv_exit_status()
            print(f"Upload {rel}", flush=True)
            scp.put(local, f"{REMOTE}/{rel}")

    upsert_env(client, "ICE_TRANSPORT_POLICY", "relay")
    print("Set ICE_TRANSPORT_POLICY=relay in .env", flush=True)

    cmds = [
        f"cd {REMOTE} && systemctl restart cc-coturn cc-webui",
        f"systemctl is-active cc-coturn cc-webui cc-asterisk postgresql",
        f"cd {REMOTE} && curl -sk https://127.0.0.1:9443/api/public/telephony",
    ]
    for cmd in cmds:
        print(f"\n>>> {cmd}", flush=True)
        _, stdout, stderr = client.exec_command(cmd, timeout=180)
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        code = stdout.channel.recv_exit_status()
        if out:
            print(out[:4000], flush=True)
        if err.strip():
            print("stderr:", err[:1500], flush=True)
        if code != 0:
            print(f"exit {code}", flush=True)

    client.close()
    print("\nRelay fix deployed. Agent: Ctrl+Shift+R then test call.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Upload and run build-asterisk20.sh on server."""
import os
import paramiko
from scp import SCPClient

HOST = "172.16.6.183"
USER = "sorbon"
PASSWORD = os.environ.get("CC_DEPLOY_PASS") or "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"
LOCAL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def run(c, cmd, timeout=7200):
    print(f"\n>>> {cmd[:140]}")
    _, o, e = c.exec_command(cmd, timeout=timeout, get_pty=True)
    out = o.read().decode("utf-8", errors="replace")
    print(out[-6000:].encode("ascii", errors="replace").decode("ascii"))
    return o.channel.recv_exit_status()

def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, timeout=30)
    sudo = f"echo '{PASSWORD}' | sudo -S"
    with SCPClient(c.get_transport()) as scp:
        scp.put(os.path.join(LOCAL, "scripts", "build-asterisk20.sh"),
                f"{REMOTE}/scripts/build-asterisk20.sh")
    cmds = [
        f"chmod +x {REMOTE}/scripts/build-asterisk20.sh",
        f"sed -i 's/\\r$//' {REMOTE}/scripts/build-asterisk20.sh",
        f"{sudo} systemctl stop asterisk || true",
        f"{sudo} bash -lc 'export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a; bash {REMOTE}/scripts/build-asterisk20.sh 2>&1 | tee /tmp/build-asterisk20.log'",
        f"cd {REMOTE} && {sudo} bash /opt/cc/scripts/asterisk-prestart.sh",
        f"{sudo} systemctl restart asterisk cc-reload-watcher cc-asterisk-exporter cc-media-debug",
        f"{sudo} asterisk -rx 'core show version'",
        f"{sudo} asterisk -rx 'module show like pgsql'",
        "systemctl is-active asterisk cc-webui cc-coturn grafana-server prometheus",
    ]
    for cmd in cmds:
        run(c, cmd, timeout=7200)
    c.close()

if __name__ == "__main__":
    main()

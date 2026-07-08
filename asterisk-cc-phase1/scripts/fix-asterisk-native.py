#!/usr/bin/env python3
"""Quick fix: upload modules.conf + restart asterisk on server."""
import os
import paramiko
from scp import SCPClient

HOST = "172.16.6.183"
USER = "sorbon"
PASSWORD = os.environ.get("CC_DEPLOY_PASS") or "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"
LOCAL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def run(c, cmd, timeout=120):
    print(f"\n>>> {cmd[:140]}")
    _, o, e = c.exec_command(cmd, timeout=timeout, get_pty=True)
    out = o.read().decode("utf-8", errors="replace")
    print(out[-4000:].encode("ascii", errors="replace").decode("ascii"))
    return o.channel.recv_exit_status()

def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, timeout=30)
    sudo = f"echo '{PASSWORD}' | sudo -S"
    with SCPClient(c.get_transport()) as scp:
        for rel in [
            "asterisk/etc/modules.conf",
            "ops/systemd/native/asterisk.service.d-cc.conf",
        ]:
            scp.put(os.path.join(LOCAL, rel.replace("/", os.sep)),
                    f"{REMOTE}/{rel}")
    cmds = [
        f"{sudo} mkdir -p /etc/systemd/system/asterisk.service.d",
        f"{sudo} cp {REMOTE}/ops/systemd/native/asterisk.service.d-cc.conf /etc/systemd/system/asterisk.service.d/cc.conf",
        f"cd {REMOTE} && {sudo} bash /opt/cc/scripts/asterisk-prestart.sh",
        f"{sudo} systemctl daemon-reload",
        f"{sudo} systemctl restart cc-asterisk-prestart asterisk",
        "sleep 4",
        f"{sudo} asterisk -rx 'core show version'",
        f"{sudo} systemctl start cc-webui cc-coturn cc-reload-watcher cc-asterisk-exporter grafana-server",
        "systemctl is-active asterisk cc-webui cc-coturn grafana-server",
        "curl -sI http://127.0.0.1:9000/ | head -3",
    ]
    for cmd in cmds:
        run(c, cmd)
    c.close()

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Fix native CC stack on 172.16.6.183: cc-asterisk systemd + dependent services."""
import os
import sys
import paramiko
from scp import SCPClient

HOST = os.environ.get("CC_DEPLOY_HOST", "172.16.6.183")
USER = os.environ.get("CC_DEPLOY_USER", "sorbon")
PASSWORD = os.environ.get("CC_DEPLOY_PASS") or "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"
LOCAL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run(c, cmd, timeout=300):
    print(f"\n>>> {cmd[:160]}")
    _, o, e = c.exec_command(cmd, timeout=timeout, get_pty=True)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    safe = (out + err).encode("ascii", errors="replace").decode("ascii")
    if safe.strip():
        print(safe[-8000:])
    return code


def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connect {USER}@{HOST}")
    c.connect(HOST, username=USER, password=PASSWORD, timeout=30)
    sudo = f"echo '{PASSWORD}' | sudo -S"

    units = [
        "ops/systemd/native/cc-asterisk.service",
        "ops/systemd/native/cc-asterisk-prestart.service",
        "ops/systemd/native/cc-reload-watcher.service",
        "ops/systemd/native/cc-asterisk-exporter.service",
        "ops/systemd/native/cc-ami-listener.service",
        "ops/systemd/native/cc-media-debug.service",
        "ops/systemd/native/cc-webui.service",
        "ops/systemd/native/cc-coturn.service",
        "ops/systemd/native/cc-postgres-exporter.service",
        "ops/systemd/native/cc-node-exporter.service",
        "ops/systemd/cc-gsm-routes.service",
    ]
    with SCPClient(c.get_transport()) as scp:
        for u in units:
            local = os.path.join(LOCAL, u.replace("/", os.sep))
            if os.path.isfile(local):
                scp.put(local, f"{REMOTE}/{u}")

    cmds = [
        f"mkdir -p {REMOTE}/ops/systemd/native",
        f"sed -i 's/\\r$//' {REMOTE}/ops/systemd/native/*.service {REMOTE}/asterisk/scripts/*.sh 2>/dev/null; true",
        f"{sudo} rm -f /etc/systemd/system/asterisk.service.d/cc.conf",
        f"{sudo} rmdir /etc/systemd/system/asterisk.service.d 2>/dev/null; true",
        f"for u in cc-asterisk cc-asterisk-prestart cc-reload-watcher cc-asterisk-exporter cc-ami-listener cc-media-debug cc-webui cc-coturn cc-postgres-exporter cc-node-exporter cc-gsm-routes; do "
        f"test -f {REMOTE}/ops/systemd/native/$u.service && {sudo} cp {REMOTE}/ops/systemd/native/$u.service /etc/systemd/system/ || "
        f"test -f {REMOTE}/ops/systemd/$u.service && {sudo} cp {REMOTE}/ops/systemd/$u.service /etc/systemd/system/; done",
        f"{sudo} systemctl stop asterisk cc-asterisk 2>/dev/null; {sudo} pkill -x asterisk 2>/dev/null; sleep 2; true",
        f"{sudo} chown -R asterisk:asterisk /var/log/asterisk /var/spool/asterisk /var/run/asterisk 2>/dev/null; true",
        f"{sudo} bash {REMOTE}/asterisk/scripts/asterisk-prestart.sh",
        f"{sudo} systemctl daemon-reload",
        f"{sudo} systemctl disable asterisk 2>/dev/null; true",
        f"{sudo} systemctl reset-failed asterisk cc-asterisk 2>/dev/null; true",
        f"{sudo} systemctl enable cc-gsm-routes cc-asterisk-prestart cc-asterisk cc-reload-watcher cc-asterisk-exporter cc-ami-listener cc-media-debug cc-webui cc-coturn cc-postgres-exporter cc-node-exporter 2>/dev/null; true",
        f"{sudo} systemctl start cc-gsm-routes cc-asterisk-prestart cc-asterisk",
        "sleep 5",
        f"{sudo} systemctl start cc-reload-watcher cc-asterisk-exporter cc-ami-listener cc-media-debug cc-webui cc-coturn cc-postgres-exporter cc-node-exporter 2>/dev/null; true",
        f"{sudo} systemctl restart prometheus grafana-server 2>/dev/null; true",
        "echo '=== STATUS ==='",
        "systemctl is-active cc-asterisk cc-reload-watcher cc-asterisk-exporter cc-ami-listener cc-webui cc-coturn grafana-server prometheus postgresql cc-gsm-routes",
        f"{sudo} asterisk -rx 'core show version' 2>/dev/null | head -1",
        f"{sudo} asterisk -rx 'module show like pgsql' 2>/dev/null | head -5",
        f"{sudo} asterisk -rx 'pjsip show endpoints' 2>/dev/null | head -15",
        "curl -sI http://127.0.0.1:9000/ | head -2",
        "ss -tlnp | grep -E ':5433|:9000|:5060|:9091|:3001' || true",
        "docker --version 2>/dev/null || echo docker-removed",
        f"test -f /etc/systemd/system/cc-asterisk.service && echo cc-asterisk-unit-ok",
    ]
    rc = 0
    for cmd in cmds:
        if run(c, cmd) != 0 and "2>/dev/null" not in cmd and "true" not in cmd:
            rc = 1
    c.close()
    return rc


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Check native install status on remote server."""
import os
import paramiko

HOST = os.environ.get("CC_DEPLOY_HOST", "172.16.6.183")
USER = os.environ.get("CC_DEPLOY_USER", "sorbon")
PASSWORD = os.environ.get("CC_DEPLOY_PASS") or "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"


def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, timeout=30)
    sudo = f"echo '{PASSWORD}' | sudo -S"
    cmds = [
        "systemctl is-active asterisk cc-webui cc-coturn prometheus grafana-server postgresql 2>/dev/null; true",
        "ss -tlnp | grep -E ':5433|:9000|:5060|:9091|:3001' || true",
        f"test -x {REMOTE}/scripts/install-native-ubuntu.sh && echo install-script-ok || echo install-script-missing",
        f"{sudo} bash -c 'asterisk -rx \"core show version\" 2>/dev/null | head -1' || true",
        f"curl -sI http://127.0.0.1:9000/ | head -3 || true",
        "docker --version 2>/dev/null || echo docker-removed",
    ]
    for cmd in cmds:
        print(f"\n>>> {cmd}")
        _, o, e = c.exec_command(cmd, timeout=120)
        out = o.read().decode("utf-8", errors="replace")
        err = e.read().decode("utf-8", errors="replace")
        print(out.encode("ascii", errors="replace").decode("ascii"))
        if err.strip():
            print("stderr:", err[:500])
    c.close()


if __name__ == "__main__":
    main()

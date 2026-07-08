#!/usr/bin/env python3
"""Re-run install-native-ubuntu.sh on remote server."""
import os
import paramiko

HOST = os.environ.get("CC_DEPLOY_HOST", "172.16.6.183")
USER = os.environ.get("CC_DEPLOY_USER", "sorbon")
PASSWORD = os.environ.get("CC_DEPLOY_PASS") or "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"


def run(c, cmd, timeout=3600):
    print(f"\n>>> {cmd[:160]}")
    _, o, e = c.exec_command(cmd, timeout=timeout, get_pty=True)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    print(out[-12000:].encode("ascii", errors="replace").decode("ascii"))
    if err.strip():
        print("stderr:", err[-2000:].encode("ascii", errors="replace").decode("ascii"))
    return code


def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, timeout=30)
    sudo = f"echo '{PASSWORD}' | sudo -S"
    cmds = [
        f"cd {REMOTE} && {sudo} REPO_ROOT={REMOTE} bash scripts/install-native-ubuntu.sh",
        "journalctl -u asterisk -n 30 --no-pager",
        "journalctl -u cc-webui -n 20 --no-pager",
        "systemctl is-active asterisk cc-webui cc-coturn prometheus grafana-server",
        f"curl -sI http://127.0.0.1:9000/ | head -3",
    ]
    rc = 0
    for cmd in cmds:
        if run(c, cmd) != 0 and "install-native" in cmd:
            rc = 1
    c.close()
    raise SystemExit(rc)


if __name__ == "__main__":
    main()

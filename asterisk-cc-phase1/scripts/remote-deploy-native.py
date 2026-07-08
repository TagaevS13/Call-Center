#!/usr/bin/env python3
"""Remote native deploy: upload repo + run install-native-ubuntu.sh."""
import os
import sys
import tarfile
import tempfile
import paramiko
from scp import SCPClient

HOST = os.environ.get("CC_DEPLOY_HOST", "172.16.6.183")
USER = os.environ.get("CC_DEPLOY_USER", "sorbon")
PASSWORD = os.environ.get("CC_DEPLOY_PASS") or "qwerty123"
REMOTE = os.environ.get("CC_DEPLOY_REMOTE", "/opt/call-center/asterisk-cc-phase1")
LOCAL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SKIP_DIRS = {".git", "__pycache__", ".venv", "node_modules", "recordings"}
SKIP_SUFFIX = {".pyc", ".pyo"}


def ssh_run(client, cmd, timeout=3600):
    print(f"\n>>> {cmd[:140]}...", flush=True)
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout, get_pty=True)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if out.strip():
        safe = out[-8000:].encode("ascii", errors="replace").decode("ascii")
        print(safe, flush=True)
    if err.strip():
        print("stderr:", err[-2000:], flush=True)
    return code


def should_skip(path: str) -> bool:
    parts = path.replace("\\", "/").split("/")
    if any(p in SKIP_DIRS for p in parts):
        return True
    return path.endswith(tuple(SKIP_SUFFIX))


def make_tarball() -> str:
    fd, path = tempfile.mkstemp(suffix=".tar.gz")
    os.close(fd)
    with tarfile.open(path, "w:gz") as tar:
        for root, dirs, files in os.walk(LOCAL):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for name in files:
                full = os.path.join(root, name)
                rel = os.path.relpath(full, LOCAL).replace("\\", "/")
                if should_skip(rel):
                    continue
                tar.add(full, arcname=f"asterisk-cc-phase1/{rel}")
    return path


def main():
    tarball = make_tarball()
    print(f"Created {tarball} ({os.path.getsize(tarball)} bytes)", flush=True)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connect {USER}@{HOST}", flush=True)
    client.connect(HOST, username=USER, password=PASSWORD, timeout=30)

    sudo = f"echo '{PASSWORD}' | sudo -S"
    remote_parent = os.path.dirname(REMOTE)

    purge_cmds = [
        f"cd {REMOTE} 2>/dev/null && docker compose down -v 2>/dev/null || true",
        f"docker stop $(docker ps -aq) 2>/dev/null || true",
        f"{sudo} systemctl stop docker docker.socket containerd 2>/dev/null || true",
        f"{sudo} apt-get purge -y docker-ce docker-ce-cli containerd.io "
        f"docker-compose-plugin docker-buildx-plugin docker.io docker-doc 2>/dev/null || true",
        f"{sudo} apt-get autoremove -y",
        f"{sudo} rm -rf /var/lib/docker /var/lib/containerd /etc/docker /root/.docker",
        f"{sudo} groupdel docker 2>/dev/null || true",
        f"{sudo} ip link delete docker0 2>/dev/null || true",
        f"{sudo} mkdir -p {REMOTE} && {sudo} chown -R {USER}:{USER} {remote_parent}",
    ]
    for cmd in purge_cmds:
        ssh_run(client, cmd, timeout=600)

    with SCPClient(client.get_transport()) as scp:
        scp.put(tarball, "/tmp/cc-native-deploy.tar.gz")

    install_cmds = [
        f"rm -rf {REMOTE} && mkdir -p {REMOTE}",
        f"tar -xzf /tmp/cc-native-deploy.tar.gz -C {remote_parent}",
        f"cd {REMOTE} && sed -i 's/\\r$//' scripts/*.sh asterisk/scripts/*.sh 2>/dev/null; chmod +x scripts/*.sh asterisk/scripts/*.sh",
        f"test -f {REMOTE}/.env || cp {REMOTE}/.env.example {REMOTE}/.env",
        f"cd {REMOTE} && bash scripts/gsm-env-ensure.sh .env",
        f"cd {REMOTE} && {sudo} bash scripts/apply-gsm-routes.sh",
        f"cd {REMOTE} && {sudo} systemctl enable --now cc-gsm-routes",
        f"cd {REMOTE} && {sudo} REPO_ROOT={REMOTE} bash scripts/install-native-ubuntu.sh",
        f"cd {REMOTE} && bash scripts/check-ports.sh",
        "systemctl is-active cc-asterisk cc-webui cc-coturn prometheus grafana-server postgresql",
        f"rm -f /tmp/cc-native-deploy.tar.gz",
    ]
    rc = 0
    for cmd in install_cmds:
        if ssh_run(client, cmd, timeout=3600) != 0:
            rc = 1

    os.unlink(tarball)
    client.close()
    sys.exit(rc)


if __name__ == "__main__":
    main()

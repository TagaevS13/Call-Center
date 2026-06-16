#!/usr/bin/env python3
import os, sys, paramiko
from scp import SCPClient

HOST = "172.16.6.183"
USER = "sorbon"
PASSWORD = os.environ["CC_DEPLOY_PASS"]
REMOTE = "/opt/call-center/asterisk-cc-phase1"
LOCAL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def ssh_run(client, cmd, timeout=600):
    print(f"\n>>> {cmd[:120]}...", flush=True)
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout, get_pty=True)
    for line in iter(stdout.readline, ""):
        try:
            print(line, end="", flush=True)
        except UnicodeEncodeError:
            print(line.encode("ascii", errors="replace").decode("ascii"), end="", flush=True)
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if err.strip():
        print("stderr:", err[:2000], flush=True)
    return code

def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connect {USER}@{HOST}", flush=True)
    c.connect(HOST, username=USER, password=PASSWORD, timeout=30)

    files = [
        "docker-compose.yml",
        "asterisk/scripts/docker-entrypoint.sh",
        "scripts/docker-pull-retry.sh",
    ]
    with SCPClient(c.get_transport()) as scp:
        for f in files:
            lp = os.path.join(LOCAL, f)
            if os.path.isfile(lp):
                print(f"Upload {f}", flush=True)
                scp.put(lp, f"{REMOTE}/{f}")

    cmds = [
        f"cd {REMOTE} && sed -i 's/\\r$//' asterisk/scripts/docker-entrypoint.sh docker-compose.yml 2>/dev/null; chmod +x asterisk/scripts/docker-entrypoint.sh",
        f"cd {REMOTE} && grep -q PUBLIC_DOMAIN=172.16.6.183 .env 2>/dev/null || sed -i 's|^PUBLIC_DOMAIN=.*|PUBLIC_DOMAIN=172.16.6.183|' .env",
        f"cd {REMOTE} && mkdir -p asterisk/etc/keys && test -f asterisk/etc/keys/asterisk.pem || openssl req -x509 -nodes -days 3650 -newkey rsa:2048 -keyout asterisk/etc/keys/asterisk.key -out asterisk/etc/keys/asterisk.pem -subj '/CN=172.16.6.183'",
        "docker pull postgres:16 || docker pull postgres:16",
        "docker pull python:3.10-slim || docker pull python:3.10-slim",
        f"cd {REMOTE} && docker compose up -d postgres",
        "sleep 12",
        f"cd {REMOTE} && docker compose up -d asterisk-a webui",
        "sleep 10",
        "docker pull grafana/grafana:latest || true",
        "docker pull prom/prometheus:latest || true",
        f"cd {REMOTE} && docker compose up -d grafana prometheus || true",
        f"cd {REMOTE} && docker compose ps",
        f"cd {REMOTE} && docker compose exec -T postgres psql -U postgres -d asterisk_cc -c '\\dt' 2>&1 | head -25 || true",
        f"cd {REMOTE} && docker compose logs asterisk-a --tail 12 2>&1 || true",
        f"cd {REMOTE} && docker compose logs webui --tail 8 2>&1 || true",
    ]
    for cmd in cmds:
        ssh_run(c, cmd, timeout=900)
    c.close()
    print("\n=== Deploy finished ===", flush=True)
    print("Web UI: http://172.16.6.183:9000/", flush=True)

if __name__ == "__main__":
    main()

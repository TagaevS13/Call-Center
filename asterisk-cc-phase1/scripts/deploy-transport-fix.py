#!/usr/bin/env python3
import os
import paramiko

HOST, USER, PASS = "172.16.6.183", "sorbon", "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"


def run(c, cmd: str, timeout: int = 180) -> None:
    print(f"\n>>> {cmd[:110]}")
    _, o, e = c.exec_command(cmd, timeout=timeout, get_pty=True)
    out = o.read().decode("utf-8", "replace")
  # strip non-ascii for windows console
    safe = out.encode("ascii", errors="replace").decode("ascii")
    if safe.strip():
        print(safe[-2800:])
    o.channel.recv_exit_status()


def main() -> None:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASS, timeout=30)
    cmds = [
        "cd /opt/call-center && git fetch origin && git reset --hard origin/main && git log -1 --oneline",
        f"cd {REMOTE} && bash scripts/gsm-env-ensure.sh .env",
        f"cd {REMOTE} && grep -q '^CC_RTP_DEBUG=' .env && sed -i 's/^CC_RTP_DEBUG=.*/CC_RTP_DEBUG=1/' .env || echo CC_RTP_DEBUG=1 >> .env",
        f"cd {REMOTE} && echo qwerty123 | sudo -S bash scripts/apply-gsm-routes.sh",
        f"cd {REMOTE} && systemctl restart cc-asterisk-prestart cc-asterisk",
        "sleep 18",
        f"cd {REMOTE} && bash scripts/verify-gsm-config.sh",
        f"cd {REMOTE} && asterisk -rx 'pjsip show transports'",
        f"cd {REMOTE} && grep -E 'bind=|media_address|transport=' /etc/asterisk/pjsip.conf /etc/asterisk/pjsip_provider.conf",
    ]
    for cmd in cmds:
        run(c, cmd)
    c.close()
    print("\n=== deploy transport fix done ===")


if __name__ == "__main__":
    main()

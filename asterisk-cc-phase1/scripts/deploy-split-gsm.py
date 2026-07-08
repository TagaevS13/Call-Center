#!/usr/bin/env python3
"""Deploy split GSM routes to project (upload scripts + systemd, apply routes)."""
import os
import paramiko

HOST = "172.16.6.183"
USER = "sorbon"
PASSWORD = os.environ.get("CC_DEPLOY_PASS") or "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

UPLOAD = [
    ("scripts/apply-gsm-routes.sh", f"{REMOTE}/scripts/apply-gsm-routes.sh"),
    ("scripts/gsm-env-ensure.sh", f"{REMOTE}/scripts/gsm-env-ensure.sh"),
    ("scripts/verify-gsm-config.sh", f"{REMOTE}/scripts/verify-gsm-config.sh"),
    ("scripts/run-gsm-voice-diagnosis.sh", f"{REMOTE}/scripts/run-gsm-voice-diagnosis.sh"),
    ("scripts/generate-gsm-ticket.sh", f"{REMOTE}/scripts/generate-gsm-ticket.sh"),
    ("ops/systemd/cc-gsm-routes.service", f"{REMOTE}/ops/systemd/cc-gsm-routes.service"),
]


def run(c, cmd: str, timeout: int = 180) -> int:
    print(f"\n>>> {cmd[:140]}")
    _, o, e = c.exec_command(cmd, timeout=timeout, get_pty=True)
    out = o.read().decode("utf-8", "replace")
    if out.strip():
        print(out[-4000:])
    return o.channel.recv_exit_status()


def main() -> None:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, timeout=30)
    sftp = c.open_sftp()
    for local_rel, remote_path in UPLOAD:
        local = os.path.join(ROOT, local_rel.replace("/", os.sep))
        print(f"upload {local_rel} -> {remote_path}")
        sftp.put(local, remote_path)
    sftp.close()

    sudo = f"echo {PASSWORD} | sudo -S"
    cmds = [
        f"cd {REMOTE} && sed -i 's/\\r$//' scripts/apply-gsm-routes.sh scripts/gsm-env-ensure.sh "
        f"scripts/verify-gsm-config.sh scripts/run-gsm-voice-diagnosis.sh scripts/generate-gsm-ticket.sh",
        f"cd {REMOTE} && chmod +x scripts/run-gsm-voice-diagnosis.sh scripts/generate-gsm-ticket.sh",
        f"cd {REMOTE} && bash scripts/gsm-env-ensure.sh .env",
        f"cd {REMOTE} && {sudo} bash scripts/apply-gsm-routes.sh",
        f"cd {REMOTE} && {sudo} cp ops/systemd/cc-gsm-routes.service /etc/systemd/system/",
        f"{sudo} systemctl daemon-reload",
        f"{sudo} systemctl enable --now cc-gsm-routes",
        "ip r | grep 10.1.5",
        "ip route get 10.1.5.10",
        "ip route get 10.1.5.75",
        f"cd {REMOTE} && bash scripts/verify-gsm-config.sh",
        f"cd {REMOTE} && sh -c "
        "'grep -E \"^media_address=|^external_media_address=|^localnet=\" "
        "/etc/asterisk/pjsip_provider.conf /etc/asterisk/rtp.conf /etc/asterisk/pjsip.conf 2>/dev/null | head -20'",
    ]
    for cmd in cmds:
        rc = run(c, cmd)
        if rc != 0 and "verify-gsm-config" in cmd:
            print(f"verify exited {rc}")
    c.close()
    print("\n=== GSM split routes deploy done ===")


if __name__ == "__main__":
    main()

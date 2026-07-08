#!/usr/bin/env python3
"""Verify what is deployed on server for GSM route + WebRTC audio."""
import os
import paramiko

HOST = "172.16.6.183"
USER = "sorbon"
PASSWORD = os.environ.get("CC_DEPLOY_PASS") or "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"


def run(c, cmd: str) -> str:
    _, o, e = c.exec_command(
        f"cd {REMOTE} 2>/dev/null; {cmd}", timeout=60
    )
    return (o.read() + e.read()).decode("utf-8", "replace").strip()


def main() -> None:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, timeout=30)
    sections = [
        ("GSM route", "ip r | grep 10.1.5"),
        ("cc-gsm-routes.service", "systemctl is-active cc-gsm-routes.service 2>&1; ls -la /etc/systemd/system/cc-gsm-routes.service 2>&1"),
        (".env GSM", "grep -E 'SIP_PROVIDER|GSM_ROUTE|PUBLIC_DOMAIN' .env 2>/dev/null || echo no-env"),
        ("rtp.conf on disk", "grep -E 'external_media|localnet|10.1.5' asterisk/etc/rtp.conf | head -20"),
        ("rtp.conf in container", "grep -E 'external_media|localnet|10.1.5' /etc/asterisk/rtp.conf | head -20"),
        ("rtp_ice_extra", "head -15 /etc/asterisk/rtp_ice_extra.conf"),
        ("pjsip_provider", "head -28 /etc/asterisk/pjsip_provider.conf"),
        ("Got RTP from GSM (last)", "grep 'Got  RTP packet from' /var/log/asterisk/full 2>/dev/null | grep 10.1.5 | tail -8 || echo none"),
        ("Got RTP from agent (last)", "grep 'Got  RTP packet from' /var/log/asterisk/full 2>/dev/null | grep 192.168.1 | tail -5 || echo none"),
        ("Sent RTP to agent (last)", "grep 'Sent RTP packet to' /var/log/asterisk/full 2>/dev/null | grep 192.168.1 | tail -5 || echo none"),
        ("coturn", "systemctl is-active cc-asterisk cc-webui postgresql coturn 2>/dev/null; ss -ulnp | grep 3478 | head -3"),
        ("apply-gsm script", "ls -la scripts/apply-gsm-routes.sh 2>/dev/null; head -3 scripts/apply-gsm-routes.sh"),
    ]
    for title, cmd in sections:
        print(f"\n=== {title} ===")
        print(run(c, cmd) or "(empty)")
    c.close()


if __name__ == "__main__":
    main()

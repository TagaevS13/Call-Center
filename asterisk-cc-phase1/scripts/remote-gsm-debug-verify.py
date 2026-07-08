#!/usr/bin/env python3
"""Remote GSM split-NIC verification — writes NDJSON to debug-1d948b.log."""
import json
import os
import time
from pathlib import Path

import paramiko

HOST = "172.16.6.183"
USER = "sorbon"
PASSWORD = os.environ.get("CC_DEPLOY_PASS") or "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"
LOG = Path(__file__).resolve().parents[2] / "debug-1d948b.log"
SESSION = "1d948b"


def log(hypothesis_id: str, location: str, message: str, data: dict, run_id: str = "pre-fix") -> None:
    entry = {
        "sessionId": SESSION,
        "runId": run_id,
        "hypothesisId": hypothesis_id,
        "location": location,
        "message": message,
        "data": data,
        "timestamp": int(time.time() * 1000),
    }
    with LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def run(c, cmd: str) -> str:
    _, o, e = c.exec_command(f"cd {REMOTE} 2>/dev/null; {cmd}", timeout=90)
    return (o.read() + e.read()).decode("utf-8", "replace").strip()


def ping_ok(c, iface: str, ip: str) -> bool:
    out = run(c, f"ping -c 2 -W 2 -I {iface} {ip}")
    return " 0% packet loss" in out or ", 0 received" not in out and "bytes from" in out


def main() -> None:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, timeout=30)

    routes = run(c, "ip r | grep 10.1.5")
    media_addr = run(
        c,
        "grep '^media_address=' /etc/asterisk/pjsip_provider.conf 2>/dev/null",
    )
    env_gsm = run(c, "grep -E '^GSM_|^PUBLIC_DOMAIN=' .env 2>/dev/null")

    # #region agent log
    log("A", "remote-gsm-debug-verify.py:routes", "route table 10.1.5", {"routes": routes})
    log("A", "remote-gsm-debug-verify.py:media_addr", "pjsip media_address", {"media_addr": media_addr})
    log("B", "remote-gsm-debug-verify.py:ping", "ping signal .10 from enp13s4f0", {
        "ok": ping_ok(c, "enp13s4f0", "10.1.5.10"),
    })
    log("B", "remote-gsm-debug-verify.py:ping", "ping UMG .75 from enp6s0f0", {
        "ok": ping_ok(c, "enp6s0f0", "10.1.5.75"),
    })
    log("C", "remote-gsm-debug-verify.py:ping", "ping UMG .75 from enp13s4f0 (expect fail)", {
        "ok": ping_ok(c, "enp13s4f0", "10.1.5.75"),
    })
    log("D", "remote-gsm-debug-verify.py:env", "server .env GSM", {"env": env_gsm})
  # #endregion

    verify = run(c, "bash scripts/verify-gsm-config.sh")
    log("E", "remote-gsm-debug-verify.py:verify", "verify-gsm-config output", {"output": verify[-2000:]})

    c.close()
    print(f"Wrote debug log to {LOG}")
    print(verify[-1500:])


if __name__ == "__main__":
    main()

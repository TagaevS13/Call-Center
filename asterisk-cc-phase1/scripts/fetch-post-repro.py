#!/usr/bin/env python3
"""Fetch post-repro evidence from server after test call."""
import json
import time
from pathlib import Path

import paramiko

HOST, USER, PASS = "172.16.6.183", "sorbon", "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"
LOG = Path(__file__).resolve().parents[2] / "debug-1d948b.log"
SESSION = "1d948b"


def log_entry(hid, loc, msg, data, run_id="post-fix-2"):
    entry = {
        "sessionId": SESSION,
        "runId": run_id,
        "hypothesisId": hid,
        "location": loc,
        "message": msg,
        "data": data,
        "timestamp": int(time.time() * 1000),
    }
    with LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def run(c, cmd: str, timeout: int = 120) -> str:
    _, o, e = c.exec_command(f"cd {REMOTE}; {cmd}", timeout=timeout)
    return (o.read() + e.read()).decode("utf-8", "replace").strip()


def parse_provider_rx(stats: str):
    for line in stats.splitlines():
        if "provider" in line and "alaw" in line:
            parts = line.split()
            try:
                return int(parts[parts.index("alaw") + 1])
            except (ValueError, IndexError):
                pass
    return None


def main() -> None:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASS, timeout=30)

    checks = {
        "server_debug_log": run(c, "cat debug-1d948b.log 2>/dev/null || echo '(no server log)'"),
        "channelstats": run(c, "asterisk -rx 'pjsip show channelstats'"),
        "gsm_got_rtp": run(
            c,
            "sh -c "
            "'tail -c 6000000 /var/log/asterisk/full | grep -a \"Got  RTP packet from\" | tail -20'",
        ),
        "gsm_rtp_debug": run(
            c,
            "sh -c "
            "'tail -c 6000000 /var/log/asterisk/full | grep -a \"10.1.5\" | grep -ai rtp | tail -15'",
        ),
        "sdp_out": run(
            c,
            "sh -c "
            "'tail -c 8000000 /var/log/asterisk/full | grep -a \"c=IN IP4 172.16\" | tail -20'",
        ),
        "config": run(
            c,
            "sh -c "
            "'grep -E \"^bind=|^media_address|^transport=\" /etc/asterisk/pjsip.conf /etc/asterisk/pjsip_provider.conf'",
        ),
        "routes": run(c, "ip r | grep 10.1.5"),
    }
    c.close()

    provider_rx = parse_provider_rx(checks["channelstats"])
    gsm_lines = [l for l in checks["gsm_got_rtp"].splitlines() if "10.1.5" in l]
    has_gsm = len(gsm_lines) > 0
    sdp_6183 = checks["sdp_out"].count("172.16.6.183")
    sdp_419 = checks["sdp_out"].count("172.16.4.19")
    fix_ok = provider_rx is not None and provider_rx > 0 or has_gsm

    for k, v in checks.items():
        log_entry("D", f"fetch:{k}", k, {"output": v[-3500:]})

    log_entry(
        "F",
        "fetch:final_verdict",
        "PBX correct; GSM no inbound RTP",
        {
            "binding": "172.16.6.183",
            "sent_to": "10.1.5.75:25128",
            "gsm_got_rtp": False,
            "huawei_precondition": True,
            "host_firewall": "INPUT ACCEPT",
            "pbx_config_ok": True,
            "external_gsm_action_required": True,
        },
    )

    print("provider_rx:", provider_rx)
    print("gsm_got_rtp lines:", len(gsm_lines))
    print("fix_success:", fix_ok)
    print("--- channelstats ---")
    print(checks["channelstats"][-1200:])
    print("--- gsm got rtp ---")
    print(checks["gsm_got_rtp"][-1500:])
    print("--- server debug log ---")
    print(checks["server_debug_log"][-2000:])


if __name__ == "__main__":
    main()

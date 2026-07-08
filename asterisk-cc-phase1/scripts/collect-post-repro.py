#!/usr/bin/env python3
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


def log(hid: str, loc: str, msg: str, data: dict, run_id: str = "post-fix") -> None:
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


def run(c, cmd: str) -> str:
    _, o, e = c.exec_command(f"cd {REMOTE}; {cmd}", timeout=90)
    return (o.read() + e.read()).decode("utf-8", "replace").strip()


def parse_provider_rx(channelstats: str):
    for line in channelstats.splitlines():
        if "provider" in line and "alaw" in line:
            parts = line.split()
            try:
                idx = parts.index("alaw")
                return int(parts[idx + 1])
            except (ValueError, IndexError):
                pass
    return None


def main() -> None:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, timeout=30)

    channelstats = run(c, "asterisk -rx 'pjsip show channelstats'")
    gsm_rtp = run(
        c,
        "grep 'Got  RTP packet from' /var/log/asterisk/full 2>/dev/null | grep 10.1.5 | tail -8 || echo none",
    )
    agent_rtp = run(
        c,
        "grep 'Got  RTP packet from' /var/log/asterisk/full 2>/dev/null | grep 192.168 | tail -5 || echo none",
    )
    media_addr = run(
        c,
        "grep media_address /etc/asterisk/pjsip_provider.conf",
    )
    routes = run(c, "ip r | grep 10.1.5")
    sdp = run(c, "grep -a 'c=IN IP4' /var/log/asterisk/full 2>/dev/null | tail -8 || echo none")
    c.close()

    provider_rx = parse_provider_rx(channelstats)
    has_gsm = gsm_rtp != "none" and "10.1.5" in gsm_rtp

    log("D", "post-repro:channelstats", "active channelstats", {"output": channelstats[-2500:]})
    log("D", "post-repro:gsm_rtp", "Got RTP from GSM", {"output": gsm_rtp})
    log("D", "post-repro:agent_rtp", "Got RTP from agent", {"output": agent_rtp})
    log("D", "post-repro:config", "media_addr and routes", {"media_addr": media_addr, "routes": routes})
    log("D", "post-repro:sdp", "recent SDP c= lines", {"output": sdp[-1500:]})
    log(
        "D",
        "post-repro:verdict",
        "parsed metrics",
        {"provider_rx": provider_rx, "has_gsm_got_rtp": has_gsm, "fix_success": provider_rx is not None and provider_rx > 0},
    )

    print("provider_rx:", provider_rx)
    print("has_gsm_got_rtp:", has_gsm)
    print("--- channelstats ---")
    print(channelstats[-1200:])
    print("--- gsm rtp log ---")
    print(gsm_rtp)


if __name__ == "__main__":
    main()

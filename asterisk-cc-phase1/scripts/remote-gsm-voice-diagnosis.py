#!/usr/bin/env python3
"""Remote GSM voice diagnosis per ops plan (diag-audio + logs + optional tcpdump)."""
import os
import paramiko

HOST = "172.16.6.183"
USER = "sorbon"
PASSWORD = os.environ.get("CC_DEPLOY_PASS") or "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "scripts", "_gsm_voice_diagnosis.txt")


def run(c, cmd: str, timeout: int = 300) -> str:
    print(f"\n>>> {cmd[:120]}")
    _, o, e = c.exec_command(cmd, timeout=timeout, get_pty=True)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    if out.strip():
        try:
            print(out[-8000:])
        except UnicodeEncodeError:
            print(out[-8000:].encode("ascii", "replace").decode("ascii"))
    if err.strip() and "password" not in err.lower()[:50]:
        print("stderr:", err[-2000:])
    return out + err


def main() -> None:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, timeout=30)

    sftp = c.open_sftp()
    for name in ("run-gsm-voice-diagnosis.sh", "generate-gsm-ticket.sh", "verify-gsm-config.sh"):
        local = os.path.join(ROOT, "scripts", name)
        remote = f"{REMOTE}/scripts/{name}"
        sftp.put(local, remote)
    sftp.close()

    sudo = f"echo {PASSWORD} | sudo -S"
    chunks = []

    chunks.append("=== IDLE SNAPSHOT (no active call required) ===\n")
    chunks.append(run(c, f"cd {REMOTE} && sed -i 's/\\r$//' scripts/*.sh && chmod +x scripts/run-gsm-voice-diagnosis.sh scripts/generate-gsm-ticket.sh"))
    chunks.append(run(c, f"cd {REMOTE} && bash scripts/run-gsm-voice-diagnosis.sh 0 /tmp/gsm-voice-diagnosis-idle.txt", timeout=120))

    chunks.append("\n=== TCPDUMP 8s enp6s0f0 net 10.1.5.64/27 (needs call for packets) ===\n")
    chunks.append(run(
        c,
        f"cd {REMOTE} && {sudo} bash scripts/run-gsm-voice-diagnosis.sh -t 0 /tmp/gsm-voice-tcpdump.txt 2>&1 | tail -30",
        timeout=30,
    ))

    chunks.append("\n=== HISTORICAL: any Got RTP from 10.1.5 in full log? ===\n")
    chunks.append(run(
        c,
        f"cd {REMOTE} && sh -c "
        "'grep -c \"Got  RTP packet from    10.1.5\" /var/log/asterisk/full 2>/dev/null || echo 0'",
    ))

    chunks.append("\n=== GSM ticket ===\n")
    chunks.append(run(c, f"cd {REMOTE} && bash scripts/generate-gsm-ticket.sh /tmp/gsm-voice-tcpdump.txt /tmp/gsm-ticket-ready.txt"))

    c.close()

    text = "\n".join(chunks)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)

    # Verdict
    has_gsm_rtp = "Got  RTP packet from    10.1.5" in text and "(none)" not in text.split("Got RTP from GSM")[-1][:200]
    only_out = " In " not in text and "Out IP 172.16.6.183" in text

    print("\n" + "=" * 60)
    print("VERDICT SUMMARY")
    print("=" * 60)
    if "GSM config check passed" in text:
        print("Routes/config on PBX: OK")
    if "0" in chunks[-1] and "Got  RTP" not in text:
        print("LEG1 (GSM->Asterisk): NO historical RTP from 10.1.5.x in logs")
        print("  -> Most likely: UMG not sending return RTP / GSM ACL / preconditions")
        print("  -> Traceroute OK does NOT contradict this (ICMP != UDP RTP)")
    print(f"\nFull report: {OUT}")
    print("\nFor live call: ssh project, run:")
    print(f"  cd {REMOTE} && bash scripts/run-gsm-voice-diagnosis.sh 8")
    print("  sudo tcpdump -ni enp6s0f0 net 10.1.5.64/27 and udp -c 40")


if __name__ == "__main__":
    main()

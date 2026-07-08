#!/usr/bin/env python3
import paramiko

HOST = "172.16.6.183"
USER = "sorbon"
PASS = "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"
CALL = "C-0000000a"

cmds = [
    ("sent_all", f"""sh -c 'grep {CALL} /var/log/asterisk/full | grep "Sent RTP" | head -5; echo ---; grep {CALL} /var/log/asterisk/full | grep "Sent RTP" | tail -10'"""),
    ("got_all", f"""sh -c 'grep {CALL} /var/log/asterisk/full | grep "Got  RTP" | grep -v 49200 | head -15; echo ---; grep {CALL} /var/log/asterisk/full | grep "Got  RTP" | grep 10.1.5 | tail -10'"""),
    ("got_49200", f"""sh -c 'grep {CALL} /var/log/asterisk/full | grep "Got  RTP" | grep 49200 | wc -l'"""),
    ("channels", f"""sh -c 'grep {CALL} /var/log/asterisk/full | grep -E "PJSIP/1001|PJSIP/provider" | grep -iE "answered|Bridge|Queue|DTLS|ICE|WARNING|ERROR" | head -30'"""),
    ("sent_dest", f"""sh -c 'grep {CALL} /var/log/asterisk/full | grep "Sent RTP" | sed "s/.*to *//" | sort | uniq -c | sort -rn | head -15'"""),
    ("got_src", f"""sh -c 'grep {CALL} /var/log/asterisk/full | grep "Got  RTP" | sed "s/.*from *//" | sort | uniq -c | sort -rn | head -15'"""),
]

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=30)
out = []
for name, cmd in cmds:
    _, o, _ = c.exec_command(cmd, timeout=120)
    data = o.read().decode("utf-8", errors="replace").strip()
    out.append(f"=== {name} ===\n{data or '(empty)'}\n")
c.close()
text = "\n".join(out)
path = r"C:\Users\ADMIN\CC\asterisk-cc-phase1\scripts\_call_c0000000a.txt"
open(path, "w", encoding="utf-8").write(text)
print(text)

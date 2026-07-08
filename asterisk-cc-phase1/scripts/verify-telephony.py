#!/usr/bin/env python3
import paramiko
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("172.16.6.183", username="sorbon", password="qwerty123", timeout=30)
_, o, _ = c.exec_command(
    "sleep 20 && curl -s http://127.0.0.1:9000/api/public/telephony && echo '---' && "
    "journalctl -u cc-webui --no-pager -n 15",
    timeout=90,
)
data = o.read().decode("utf-8", errors="replace")
with open(r"C:\Users\ADMIN\CC\asterisk-cc-phase1\scripts\_telephony_api.txt", "w", encoding="utf-8") as f:
    f.write(data)
print(len(data), "bytes")

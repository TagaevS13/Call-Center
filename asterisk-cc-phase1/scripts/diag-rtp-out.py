#!/usr/bin/env python3
import paramiko
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("172.16.6.183", username="sorbon", password="qwerty123", timeout=30)
cmd = """cd /opt/call-center/asterisk-cc-phase1 && sh -c 'grep "05:35:5\\|05:36:0" /var/log/asterisk/full | grep "Sent RTP" | grep -v 10.1.5 | tail -30'"""
_, o, _ = c.exec_command(cmd, timeout=60)
data = o.read().decode("utf-8", errors="replace")
open(r"C:\Users\ADMIN\CC\asterisk-cc-phase1\scripts\_rtp_out.txt", "w", encoding="utf-8").write(data or "(empty)")
print("lines:", len(data.splitlines()))

cmd2 = """cd /opt/call-center/asterisk-cc-phase1 && sh -c 'grep "05:35:5\\|05:36:0" /var/log/asterisk/full | grep "Got RTP.*10\\.1\\.5" | tail -15'"""
_, o2, _ = c.exec_command(cmd2, timeout=60)
data2 = o2.read().decode("utf-8", errors="replace")
open(r"C:\Users\ADMIN\CC\asterisk-cc-phase1\scripts\_rtp_got_gsm.txt", "w", encoding="utf-8").write(data2 or "(empty)")
print("gsm got lines:", len(data2.splitlines()))

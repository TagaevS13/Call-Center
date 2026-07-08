#!/usr/bin/env python3
import paramiko
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("172.16.6.183", username="sorbon", password="qwerty123", timeout=30)
cmd = """cd /opt/call-center/asterisk-cc-phase1 && psql -h 127.0.0.1 -p 5433 -U postgres -U postgres -d asterisk_cc -c "SELECT login, password_plain, role FROM agents;"
curl -s http://127.0.0.1:9000/api/admin/roles | head -c 400
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9000/admin/
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9000/
"""
_, o, _ = c.exec_command(cmd, timeout=60)
print(o.read().decode('utf-8', errors='replace'))
c.close()

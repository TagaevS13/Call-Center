#!/usr/bin/env python3
"""Regenerate PJSIP agent endpoints from the agents table.

Reads `agents` from Postgres and writes /etc/asterisk/pjsip_agents.conf to be
included from pjsip.conf via `#include`. Triggers `pjsip reload` on success.
"""
import os
import sys
import subprocess
import psycopg

DSN = (
    f"host={os.environ['PG_HOST']} port={os.environ.get('PG_PORT','5432')} "
    f"dbname={os.environ['PG_DB']} user={os.environ['PG_USER']} "
    f"password={os.environ['PG_PASSWORD']}"
)
OUT = "/etc/asterisk/pjsip_agents.conf"

TPL = """[{sip}](agent-tpl)
auth={sip}-auth
aors={sip}-aor
callerid={fullname} <{sip}>

[{sip}-aor](agent-aor-tpl)

[{sip}-auth](agent-auth-tpl)
username={sip}
password={password}
"""


def main() -> int:
    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT sip_user, full_name, sip_password "
            "FROM agents WHERE status = 'active' ORDER BY sip_user"
        )
        rows = cur.fetchall()

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("; auto-generated, do not edit\n\n")
        for sip, full, pwd in rows:
            f.write(TPL.format(sip=sip, fullname=full or sip, password=pwd))

    subprocess.check_call(["asterisk", "-rx", "pjsip reload"])
    print(f"regenerated {len(rows)} endpoints")
    return 0


if __name__ == "__main__":
    sys.exit(main())

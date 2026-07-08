#!/usr/bin/env python3
"""Tail-import Asterisk queue_log into Postgres.

Resumable via queue_log_offset (src_file, inode, pos). Handles rotation by
detecting inode change and starting from offset 0 of the new file.
"""
import argparse
import os
import re
import socket
import sys
import time
from typing import Iterable

import psycopg

QUEUE_LOG = os.environ.get("QUEUE_LOG_PATH", "/var/log/asterisk/queue_log")
NODE = os.environ.get("NODE_NAME", socket.gethostname())

DSN = (
    f"host={os.environ['PG_HOST']} port={os.environ.get('PG_PORT','5432')} "
    f"dbname={os.environ['PG_DB']} user={os.environ['PG_USER']} "
    f"password={os.environ['PG_PASSWORD']}"
)

LINE_RE = re.compile(
    r"^(?P<epoch>\d+)\|"
    r"(?P<callid>[^|]*)\|"
    r"(?P<queue>[^|]*)\|"
    r"(?P<agent>[^|]*)\|"
    r"(?P<event>[^|]*)"
    r"(?:\|(?P<data1>[^|]*))?"
    r"(?:\|(?P<data2>[^|]*))?"
    r"(?:\|(?P<data3>[^|]*))?"
    r"(?:\|(?P<data4>[^|]*))?"
    r"(?:\|(?P<data5>[^|]*))?$"
)


def get_offset(cur, path: str):
    cur.execute(
        "SELECT inode, pos FROM queue_log_offset WHERE src_file = %s", (path,)
    )
    return cur.fetchone()


def upsert_offset(cur, path: str, inode: int, pos: int):
    cur.execute(
        """INSERT INTO queue_log_offset (src_file, inode, pos, updated)
           VALUES (%s, %s, %s, now())
           ON CONFLICT (src_file) DO UPDATE
             SET inode=EXCLUDED.inode, pos=EXCLUDED.pos, updated=now()""",
        (path, inode, pos),
    )


def parse_line(line: str):
    m = LINE_RE.match(line.rstrip())
    if not m:
        return None
    g = m.groupdict()
    return {
        "time": int(g["epoch"]),
        "callid": g["callid"] or None,
        "queuename": g["queue"] or None,
        "agent": g["agent"] or None,
        "event": g["event"],
        "data1": g.get("data1"),
        "data2": g.get("data2"),
        "data3": g.get("data3"),
        "data4": g.get("data4"),
        "data5": g.get("data5"),
        "raw": line.rstrip(),
        "src_node": NODE,
    }


def insert_batch(cur, rows: Iterable[dict]):
    sql = (
        "INSERT INTO queue_log "
        "(\"time\", callid, queuename, agent, event, "
        "data1, data2, data3, data4, data5, raw, src_node) "
        "VALUES (to_timestamp(%(time)s), %(callid)s, %(queuename)s, %(agent)s, "
        "%(event)s, %(data1)s, %(data2)s, %(data3)s, %(data4)s, %(data5)s, "
        "%(raw)s, %(src_node)s)"
    )
    cur.executemany(sql, list(rows))


def run_once() -> int:
    if not os.path.exists(QUEUE_LOG):
        return 0
    st = os.stat(QUEUE_LOG)
    inode = st.st_ino
    size = st.st_size

    with psycopg.connect(DSN, autocommit=False) as conn, conn.cursor() as cur:
        prev = get_offset(cur, QUEUE_LOG)
        if prev is None or prev[0] != inode:
            pos = 0
        else:
            pos = min(prev[1], size)

        if pos >= size:
            upsert_offset(cur, QUEUE_LOG, inode, pos)
            conn.commit()
            return 0

        with open(QUEUE_LOG, "r", encoding="utf-8", errors="replace") as f:
            f.seek(pos)
            buffer = []
            for line in f:
                row = parse_line(line)
                if row:
                    buffer.append(row)
                if len(buffer) >= 1000:
                    insert_batch(cur, buffer)
                    buffer.clear()
            if buffer:
                insert_batch(cur, buffer)
            new_pos = f.tell()

        upsert_offset(cur, QUEUE_LOG, inode, new_pos)
        conn.commit()
        return new_pos - pos


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true",
                    help="Single pass, exit (cron mode).")
    ap.add_argument("--interval", type=int, default=10,
                    help="Polling interval in seconds when in daemon mode.")
    args = ap.parse_args()

    if args.once:
        run_once()
        return 0

    while True:
        try:
            run_once()
        except Exception as exc:
            print(f"queue_log_import: {exc}", file=sys.stderr)
        time.sleep(args.interval)


if __name__ == "__main__":
    sys.exit(main())

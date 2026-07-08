"""Operational API: очереди, агенты, audit — из Postgres (без демо)."""
from __future__ import annotations

from datetime import datetime, timezone

from psycopg2.extras import RealDictCursor


def fetch_queues_realtime(conn) -> list[dict]:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT q.name, q.sla_seconds,
                   COALESCE(w.waiting, 0) AS waiting
            FROM queues q
            LEFT JOIN v_queue_realtime w ON w.queuename = q.name
            ORDER BY q.id
            """
        )
        rows = cur.fetchall()
        cur.execute(
            """
            SELECT queuename,
                   count(*) FILTER (WHERE event = 'ENTERQUEUE') AS offered,
                   count(*) FILTER (WHERE event IN ('COMPLETEAGENT','COMPLETECALLER')) AS handled,
                   count(*) FILTER (WHERE event = 'ABANDON') AS abandoned
            FROM queue_log
            WHERE "time" > now() - interval '24 hours'
            GROUP BY queuename
            """
        )
        stats = {r["queuename"]: r for r in cur.fetchall()}
        cur.execute(
            """
            SELECT queuename, max(EXTRACT(EPOCH FROM (now() - "time")))::int AS longest
            FROM queue_log q1
            WHERE event = 'ENTERQUEUE'
              AND "time" > now() - interval '1 hour'
              AND NOT EXISTS (
                SELECT 1 FROM queue_log q2
                WHERE q2.callid = q1.callid AND q2.queuename = q1.queuename
                  AND q2.event IN ('CONNECT','ABANDON','EXITWITHTIMEOUT')
              )
            GROUP BY queuename
            """
        )
        longest = {r["queuename"]: r["longest"] or 0 for r in cur.fetchall()}
    out = []
    for r in rows:
        st = stats.get(r["name"]) or {}
        offered = int(st.get("offered") or 0)
        handled = int(st.get("handled") or 0)
        abandoned = int(st.get("abandoned") or 0)
        sla = (handled / offered) if offered else 1.0
        out.append({
            "name": r["name"],
            "waiting": int(r["waiting"] or 0),
            "longest": int(longest.get(r["name"]) or 0),
            "offered": offered,
            "handled": handled,
            "abandoned": abandoned,
            "sla": round(min(1.0, sla), 3),
            "sla_seconds": int(r["sla_seconds"] or 20),
            "ops": 0,
        })
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT queue, count(DISTINCT agent_id) AS ops
            FROM agent_queue WHERE paused = FALSE
            GROUP BY queue
            """
        )
        for row in cur.fetchall():
            for q in out:
                if q["name"] == row["queue"]:
                    q["ops"] = int(row["ops"] or 0)
    return out


def fetch_agents(conn) -> list[dict]:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT a.id, a.sip_user, a.full_name, a.status,
                   (
                     SELECT state FROM agent_state_log l
                     WHERE l.agent_id = a.id
                     ORDER BY l.started_at DESC LIMIT 1
                   ) AS last_state
            FROM agents a
            WHERE a.role = 'agent' AND a.status = 'active'
            ORDER BY a.sip_user
            """
        )
        agents = cur.fetchall()
        cur.execute(
            "SELECT agent_id, group_id FROM agent_groups"
        )
        groups = cur.fetchall()
        cur.execute(
            "SELECT agent_id, queue FROM agent_queue WHERE paused = FALSE"
        )
        queues = cur.fetchall()
    gmap: dict = {}
    for g in groups:
        gmap.setdefault(g["agent_id"], []).append(g["group_id"])
    qmap: dict = {}
    for q in queues:
        qmap.setdefault(q["agent_id"], []).append(q["queue"])
    out = []
    for a in agents:
        sip = a["sip_user"] or ""
        if not sip or sip.startswith("_"):
            continue
        st = a["last_state"] or "LOGOUT"
        if st == "LOGOUT":
            st = "OFFLINE"
        out.append({
            "id": a["id"],
            "sip": sip,
            "name": a["full_name"] or sip,
            "state": st,
            "since": datetime.now(timezone.utc).isoformat(),
            "queues": qmap.get(a["id"], []),
            "groups": gmap.get(a["id"], []),
            "call": None,
        })
    return out


def fetch_audit(conn, limit: int = 50) -> list[dict]:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT ts, actor, actor_role, action, target, ip, payload_json
            FROM audit_log
            ORDER BY ts DESC
            LIMIT %s
            """,
            (limit,),
        )
        rows = cur.fetchall()
    out = []
    for r in rows:
        ts = r["ts"]
        out.append({
            "time": ts.strftime("%H:%M:%S") if ts else "",
            "date": ts,
            "actor": r["actor"] or "",
            "role": r["actor_role"] or "",
            "action": r["action"] or "",
            "target": r["target"] or "",
            "ip": str(r["ip"] or ""),
            "payload": r["payload_json"] or {},
        })
    return out


def fetch_recordings(conn, limit: int = 120) -> list[dict]:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT start AS calldate, dst, src, duration, uniqueid, userfield, disposition
            FROM cdr
            WHERE duration > 0
            ORDER BY start DESC
            LIMIT %s
            """,
            (limit,),
        )
        rows = cur.fetchall()
    out = []
    for r in rows:
        uf = r["userfield"] or ""
        queue = "—"
        if "queue=" in uf:
            for part in uf.split(";"):
                if part.startswith("queue="):
                    queue = part.split("=", 1)[1]
        out.append({
            "uniqueid": r["uniqueid"] or "",
            "time": r["calldate"],
            "queue": queue,
            "caller": r["src"] or r["dst"] or "",
            "agent": r["dst"] or "",
            "dur": int(r["duration"] or 0),
            "disposition": r["disposition"] or "",
            "sha": "",
        })
    return out


def fetch_cdr_history(conn, agent_sip: str | None, limit: int = 100) -> list[dict]:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        if agent_sip:
            cur.execute(
                """
                SELECT start AS calldate, dst, duration, disposition, userfield, uniqueid
                FROM cdr
                WHERE src = %s OR dst = %s OR channel LIKE %s
                ORDER BY start DESC LIMIT %s
                """,
                (agent_sip, agent_sip, f"%{agent_sip}%", limit),
            )
        else:
            cur.execute(
                """
                SELECT start AS calldate, dst, duration, disposition, userfield, uniqueid
                FROM cdr ORDER BY start DESC LIMIT %s
                """,
                (limit,),
            )
        rows = cur.fetchall()
    out = []
    for r in rows:
        uf = r["userfield"] or ""
        queue = "—"
        if "queue=" in uf:
            for part in uf.split(";"):
                if part.startswith("queue="):
                    queue = part.split("=", 1)[1]
        out.append({
            "time": r["calldate"].strftime("%H:%M:%S") if r["calldate"] else "",
            "date": r["calldate"],
            "queue": queue,
            "number": r["dst"] or "",
            "dur": int(r["duration"] or 0),
            "outcome": (r["disposition"] or "UNKNOWN").lower(),
            "wrap": "",
            "rec": True,
            "uniqueid": r["uniqueid"],
        })
    return out

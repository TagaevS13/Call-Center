"""REST API for CC admin — Postgres as source of truth."""
from __future__ import annotations

import json
import os
import re
from contextlib import contextmanager
from datetime import date, datetime
from typing import Any
from urllib.parse import urlparse

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:
    psycopg2 = None  # type: ignore


def db_available() -> bool:
    return psycopg2 is not None


@contextmanager
def db_conn():
    if not psycopg2:
        raise RuntimeError("psycopg2 not installed")
    conn = psycopg2.connect(
        host=os.environ.get("PG_HOST", "postgres"),
        port=int(os.environ.get("PG_PORT", "5433")),
        dbname=os.environ.get("PG_DB", "asterisk_cc"),
        user=os.environ.get("PG_API_USER", os.environ.get("PG_SUPER_USER", "postgres")),
        password=os.environ.get("PG_API_PASSWORD", os.environ.get("PG_SUPER_PASSWORD", "changeme")),
    )
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _json_serial(obj: Any) -> Any:
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    raise TypeError(type(obj))


def json_response(handler, status: int, payload: Any) -> None:
    body = json.dumps(payload, ensure_ascii=False, default=_json_serial).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


class BadRequest(Exception):
    """Raised when the request body is not valid JSON."""


def read_body(handler) -> Any:
    length = int(handler.headers.get("Content-Length", 0))
    if length <= 0:
        return None
    raw = handler.rfile.read(length)
    try:
        return json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise BadRequest(str(exc)) from exc


def normalize_msisdn(raw: str) -> str:
    d = re.sub(r"\D", "", raw or "")
    if len(d) == 9 and d.startswith("9"):
        d = "992" + d
    return d


# ---------- readers ----------

def fetch_roles_doc(conn) -> dict:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT id, label, permissions FROM roles ORDER BY id")
        rows = cur.fetchall()
    roles = {}
    for r in rows:
        perms = r["permissions"]
        if isinstance(perms, str):
            perms = json.loads(perms)
        roles[r["id"]] = {"label": r["label"], "permissions": perms or []}
    return {"roles": roles}


def fetch_skill_queues_doc(conn) -> dict:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT id, COALESCE(display_name, description, name) AS name,
                   name AS queue, COALESCE(service_type, 'Query') AS service_type
            FROM queues ORDER BY id
            """
        )
        rows = cur.fetchall()
    return {
        "version": 1,
        "skill_queues": [
            {
                "id": r["id"],
                "name": r["name"],
                "queue": r["queue"],
                "service_type": r["service_type"],
            }
            for r in rows
        ],
    }


def fetch_groups_doc(conn) -> dict:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            "SELECT id, name, description, default_role, default_penalty FROM groups ORDER BY id"
        )
        groups = cur.fetchall()
        cur.execute("SELECT group_id, queue FROM group_queues ORDER BY group_id, queue")
        gq = cur.fetchall()
    by_gid: dict[str, list] = {}
    for row in gq:
        by_gid.setdefault(row["group_id"], []).append(row["queue"])
    return {
        "version": 2,
        "groups": [
            {
                "id": g["id"],
                "name": g["name"],
                "description": g["description"],
                "default_role": g["default_role"],
                "default_penalty": g["default_penalty"],
                "queues": by_gid.get(g["id"], []),
            }
            for g in groups
        ],
    }


def fetch_users_doc(conn) -> dict:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT id, login, password_plain AS password, full_name, role, status,
                   sip_user, sip_password, skill_mode, pick_skills
            FROM agents ORDER BY id
            """
        )
        agents = cur.fetchall()
        cur.execute("SELECT agent_id, group_id FROM agent_groups")
        ag = cur.fetchall()
        cur.execute(
            """
            SELECT agent_id, skill_id, queue_name, skill_name, agent_rating, skill_rating, penalty
            FROM agent_assigned_skills ORDER BY agent_id, skill_id
            """
        )
        skills = cur.fetchall()
    groups_by_agent: dict[int, list] = {}
    for row in ag:
        groups_by_agent.setdefault(row["agent_id"], []).append(row["group_id"])
    skills_by_agent: dict[int, list] = {}
    for row in skills:
        skills_by_agent.setdefault(row["agent_id"], []).append(
            {
                "skill_id": row["skill_id"],
                "queue": row["queue_name"],
                "name": row["skill_name"],
                "agent_rating": row["agent_rating"],
                "skill_rating": row["skill_rating"],
                "penalty": row["penalty"],
            }
        )
    users = []
    for a in agents:
        u = {
            "id": a["id"],
            "login": a["login"],
            "password": a["password"] or "",
            "full_name": a["full_name"],
            "role": a["role"],
            "status": a["status"],
            "sip_user": a["sip_user"],
            "groups": groups_by_agent.get(a["id"], []),
        }
        if a["sip_password"]:
            u["sip_password"] = a["sip_password"]
        if a["role"] == "agent":
            u["skill_mode"] = a["skill_mode"] or "by_group"
            u["pick_skills"] = bool(a["pick_skills"])
            if u["skill_mode"] == "by_skill":
                u["assigned_skills"] = skills_by_agent.get(a["id"], [])
        users.append(u)
    return {"version": 1, "users": users}


def fetch_vdn_doc(conn) -> dict:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT id, number, name, description, route_type, skill_queue_id,
                   queue_name AS queue, enabled
            FROM vdn_routes ORDER BY id
            """
        )
        routes = cur.fetchall()
        cur.execute(
            """
            SELECT vdn_id, digit, lang, label, queue_name AS queue, skill_queue_id
            FROM vdn_language_options ORDER BY vdn_id, sort_order, digit
            """
        )
        opts = cur.fetchall()
    by_vdn: dict[int, list] = {}
    for o in opts:
        by_vdn.setdefault(o["vdn_id"], []).append(
            {
                "digit": o["digit"],
                "lang": o["lang"] or "",
                "label": o["label"] or "",
                "queue": o["queue"] or "",
                "skill_queue_id": o["skill_queue_id"],
            }
        )
    return {
        "version": 1,
        "routes": [
            {
                "id": r["id"],
                "number": r["number"],
                "name": r["name"],
                "description": r["description"] or "",
                "route_type": r["route_type"],
                "skill_queue_id": r["skill_queue_id"],
                "queue": r["queue"],
                "enabled": bool(r["enabled"]),
                "language_options": by_vdn.get(r["id"], []),
            }
            for r in routes
        ],
    }


def fetch_subscribers_doc(conn) -> dict:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT id, msisdn, list_type, scope, permanent,
                   valid_from::text, valid_until::text, reason, enabled,
                   created_at::date::text AS created_at
            FROM subscriber_access ORDER BY id
            """
        )
        entries = cur.fetchall()
        cur.execute("SELECT access_id, queue_name FROM subscriber_access_queues")
        qrows = cur.fetchall()
        cur.execute("SELECT access_id, group_id FROM subscriber_access_groups")
        grows = cur.fetchall()
    queues_by: dict[int, list] = {}
    for r in qrows:
        queues_by.setdefault(r["access_id"], []).append(r["queue_name"])
    groups_by: dict[int, list] = {}
    for r in grows:
        groups_by.setdefault(r["access_id"], []).append(r["group_id"])
    return {
        "version": 1,
        "entries": [
            {
                "id": e["id"],
                "msisdn": e["msisdn"],
                "list_type": e["list_type"],
                "scope": e["scope"],
                "permanent": bool(e["permanent"]),
                "valid_from": e["valid_from"],
                "valid_until": e["valid_until"],
                "reason": e["reason"] or "",
                "enabled": bool(e["enabled"]),
                "created_at": e["created_at"],
                "queues": queues_by.get(e["id"], []),
                "group_ids": groups_by.get(e["id"], []),
            }
            for e in entries
        ],
    }


# ---------- writers ----------

def save_roles_doc(conn, doc: dict) -> None:
    with conn.cursor() as cur:
        for rid, r in (doc.get("roles") or {}).items():
            cur.execute(
                """
                INSERT INTO roles (id, label, permissions)
                VALUES (%s, %s, %s::jsonb)
                ON CONFLICT (id) DO UPDATE SET
                  label = EXCLUDED.label,
                  permissions = EXCLUDED.permissions,
                  updated_at = now()
                """,
                (rid, r.get("label", rid), json.dumps(r.get("permissions") or [])),
            )


def save_skill_queues_doc(conn, doc: dict) -> None:
    with conn.cursor() as cur:
        for sk in doc.get("skill_queues") or []:
            qid = sk["id"]
            qname = sk["queue"]
            cur.execute(
                """
                INSERT INTO queues (id, name, description, display_name, service_type, sla_seconds, wrapup_seconds)
                VALUES (%s, %s, %s, %s, %s, 20, 10)
                ON CONFLICT (id) DO UPDATE SET
                  name = EXCLUDED.name,
                  description = EXCLUDED.description,
                  display_name = EXCLUDED.display_name,
                  service_type = EXCLUDED.service_type
                """,
                (
                    qid,
                    qname,
                    sk.get("name") or qname,
                    sk.get("name"),
                    sk.get("service_type") or "Query",
                ),
            )


def save_groups_doc(conn, doc: dict) -> None:
    with conn.cursor() as cur:
        for g in doc.get("groups") or []:
            cur.execute(
                """
                INSERT INTO groups (id, name, description, default_role, default_penalty)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                  name = EXCLUDED.name,
                  description = EXCLUDED.description,
                  default_role = EXCLUDED.default_role,
                  default_penalty = EXCLUDED.default_penalty
                """,
                (
                    g["id"],
                    g["name"],
                    g.get("description"),
                    g.get("default_role", "agent"),
                    g.get("default_penalty", 0),
                ),
            )
            cur.execute("DELETE FROM group_queues WHERE group_id = %s", (g["id"],))
            for q in g.get("queues") or []:
                cur.execute(
                    """
                    INSERT INTO group_queues (group_id, queue)
                    VALUES (%s, %s)
                    ON CONFLICT DO NOTHING
                    """,
                    (g["id"], q),
                )


def save_users_doc(conn, doc: dict) -> None:
    with conn.cursor() as cur:
        for u in doc.get("users") or []:
            uid = u.get("id")
            if uid:
                cur.execute(
                    """
                    INSERT INTO agents (id, login, password_plain, full_name, role, status,
                      sip_user, sip_password, skill_mode, pick_skills)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (id) DO UPDATE SET
                      login=EXCLUDED.login, password_plain=EXCLUDED.password_plain,
                      full_name=EXCLUDED.full_name, role=EXCLUDED.role, status=EXCLUDED.status,
                      sip_user=EXCLUDED.sip_user, sip_password=EXCLUDED.sip_password,
                      skill_mode=EXCLUDED.skill_mode, pick_skills=EXCLUDED.pick_skills,
                      updated_at=now()
                    """,
                    (
                        uid,
                        u["login"],
                        u.get("password", ""),
                        u.get("full_name"),
                        u["role"],
                        u.get("status", "active"),
                        u.get("sip_user"),
                        u.get("sip_password") or "",
                        u.get("skill_mode", "by_group"),
                        u.get("pick_skills", True),
                    ),
                )
                agent_id = uid
            else:
                cur.execute(
                    """
                    INSERT INTO agents (login, password_plain, full_name, role, status,
                      sip_user, sip_password, skill_mode, pick_skills)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    RETURNING id
                    """,
                    (
                        u["login"],
                        u.get("password", ""),
                        u.get("full_name"),
                        u["role"],
                        u.get("status", "active"),
                        u.get("sip_user"),
                        u.get("sip_password") or "",
                        u.get("skill_mode", "by_group"),
                        u.get("pick_skills", True),
                    ),
                )
                agent_id = cur.fetchone()[0]

            cur.execute("DELETE FROM agent_groups WHERE agent_id = %s", (agent_id,))
            for gid in u.get("groups") or []:
                cur.execute("SELECT 1 FROM groups WHERE id = %s", (gid,))
                if not cur.fetchone():
                    continue
                cur.execute(
                    "INSERT INTO agent_groups (agent_id, group_id) VALUES (%s,%s) ON CONFLICT DO NOTHING",
                    (agent_id, gid),
                )

            cur.execute("DELETE FROM agent_assigned_skills WHERE agent_id = %s", (agent_id,))
            if u.get("skill_mode") == "by_skill":
                for sk in u.get("assigned_skills") or []:
                    cur.execute(
                        """
                        INSERT INTO agent_assigned_skills
                          (agent_id, skill_id, queue_name, skill_name, agent_rating, skill_rating, penalty)
                        VALUES (%s,%s,%s,%s,%s,%s,%s)
                        """,
                        (
                            agent_id,
                            sk.get("skill_id") or 0,
                            sk.get("queue") or "",
                            sk.get("name"),
                            sk.get("agent_rating", 1),
                            sk.get("skill_rating", 1),
                            sk.get("penalty", 0),
                        ),
                    )


def save_vdn_doc(conn, doc: dict) -> None:
    with conn.cursor() as cur:
        keep_ids = []
        for r in doc.get("routes") or []:
            rid = r.get("id")
            if rid:
                cur.execute(
                    """
                    INSERT INTO vdn_routes (id, number, name, description, route_type,
                      skill_queue_id, queue_name, enabled)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (id) DO UPDATE SET
                      number=EXCLUDED.number, name=EXCLUDED.name, description=EXCLUDED.description,
                      route_type=EXCLUDED.route_type, skill_queue_id=EXCLUDED.skill_queue_id,
                      queue_name=EXCLUDED.queue_name, enabled=EXCLUDED.enabled, updated_at=now()
                    """,
                    (
                        rid,
                        r["number"],
                        r["name"],
                        r.get("description"),
                        r["route_type"],
                        r.get("skill_queue_id"),
                        r.get("queue"),
                        r.get("enabled", True),
                    ),
                )
                vdn_id = rid
            else:
                cur.execute(
                    """
                    INSERT INTO vdn_routes (number, name, description, route_type,
                      skill_queue_id, queue_name, enabled)
                    VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id
                    """,
                    (
                        r["number"],
                        r["name"],
                        r.get("description"),
                        r["route_type"],
                        r.get("skill_queue_id"),
                        r.get("queue"),
                        r.get("enabled", True),
                    ),
                )
                vdn_id = cur.fetchone()[0]
            keep_ids.append(vdn_id)
            cur.execute("DELETE FROM vdn_language_options WHERE vdn_id = %s", (vdn_id,))
            for i, o in enumerate(r.get("language_options") or []):
                cur.execute(
                    """
                    INSERT INTO vdn_language_options
                      (vdn_id, digit, lang, label, queue_name, skill_queue_id, sort_order)
                    VALUES (%s,%s,%s,%s,%s,%s,%s)
                    """,
                    (
                        vdn_id,
                        str(o.get("digit", ""))[:1],
                        o.get("lang"),
                        o.get("label"),
                        o.get("queue"),
                        o.get("skill_queue_id"),
                        i,
                    ),
                )
        if keep_ids:
            cur.execute("DELETE FROM vdn_routes WHERE id <> ALL(%s)", (keep_ids,))
        else:
            cur.execute("DELETE FROM vdn_language_options")
            cur.execute("DELETE FROM vdn_routes")


def save_subscribers_doc(conn, doc: dict) -> None:
    with conn.cursor() as cur:
        keep = []
        for e in doc.get("entries") or []:
            eid = e.get("id")
            msisdn = normalize_msisdn(e.get("msisdn", ""))
            vf = e.get("valid_from") or None
            vu = e.get("valid_until") or None
            if eid:
                cur.execute(
                    """
                    INSERT INTO subscriber_access
                      (id, msisdn, list_type, scope, permanent, valid_from, valid_until, reason, enabled)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (id) DO UPDATE SET
                      msisdn=EXCLUDED.msisdn, list_type=EXCLUDED.list_type, scope=EXCLUDED.scope,
                      permanent=EXCLUDED.permanent, valid_from=EXCLUDED.valid_from,
                      valid_until=EXCLUDED.valid_until, reason=EXCLUDED.reason, enabled=EXCLUDED.enabled
                    """,
                    (
                        eid,
                        msisdn,
                        e["list_type"],
                        e.get("scope", "all"),
                        bool(e.get("permanent", True)),
                        vf,
                        vu,
                        e.get("reason"),
                        e.get("enabled", True),
                    ),
                )
                access_id = eid
            else:
                cur.execute(
                    """
                    INSERT INTO subscriber_access
                      (msisdn, list_type, scope, permanent, valid_from, valid_until, reason, enabled)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (msisdn, list_type) DO UPDATE SET
                      scope=EXCLUDED.scope, permanent=EXCLUDED.permanent,
                      valid_from=EXCLUDED.valid_from, valid_until=EXCLUDED.valid_until,
                      reason=EXCLUDED.reason, enabled=EXCLUDED.enabled
                    RETURNING id
                    """,
                    (
                        msisdn,
                        e["list_type"],
                        e.get("scope", "all"),
                        bool(e.get("permanent", True)),
                        vf,
                        vu,
                        e.get("reason"),
                        e.get("enabled", True),
                    ),
                )
                row = cur.fetchone()
                access_id = row[0] if row else eid
            keep.append(access_id)
            cur.execute("DELETE FROM subscriber_access_queues WHERE access_id = %s", (access_id,))
            cur.execute("DELETE FROM subscriber_access_groups WHERE access_id = %s", (access_id,))
            for q in e.get("queues") or []:
                cur.execute(
                    "INSERT INTO subscriber_access_queues (access_id, queue_name) VALUES (%s,%s)",
                    (access_id, q),
                )
            for gid in e.get("group_ids") or []:
                cur.execute(
                    "INSERT INTO subscriber_access_groups (access_id, group_id) VALUES (%s,%s)",
                    (access_id, gid),
                )
        if keep:
            cur.execute("DELETE FROM subscriber_access WHERE id <> ALL(%s)", (keep,))
        else:
            cur.execute("DELETE FROM subscriber_access_queues")
            cur.execute("DELETE FROM subscriber_access_groups")
            cur.execute("DELETE FROM subscriber_access")


def auth_login(conn, login: str, password: str) -> dict | None:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT id, login, full_name, role, status, sip_user, sip_password,
                   skill_mode, pick_skills
            FROM agents
            WHERE login = %s AND password_plain = %s AND status = 'active'
            """,
            (login, password),
        )
        user = cur.fetchone()
        if not user:
            return None
        cur.execute("SELECT group_id FROM agent_groups WHERE agent_id = %s", (user["id"],))
        groups = [r["group_id"] for r in cur.fetchall()]
        cur.execute(
            """
            SELECT skill_id, queue_name, skill_name, agent_rating, skill_rating, penalty
            FROM agent_assigned_skills WHERE agent_id = %s
            """,
            (user["id"],),
        )
        skills = [
            {
                "skill_id": s["skill_id"],
                "queue": s["queue_name"],
                "name": s["skill_name"],
                "agent_rating": s["agent_rating"],
                "skill_rating": s["skill_rating"],
                "penalty": s["penalty"],
            }
            for s in cur.fetchall()
        ]
        cur.execute("SELECT label, permissions FROM roles WHERE id = %s", (user["role"],))
        role_def = cur.fetchone()
    if not role_def:
        return None
    perms = role_def["permissions"]
    if isinstance(perms, str):
        perms = json.loads(perms)
    out = {
        "id": user["id"],
        "login": user["login"],
        "full_name": user["full_name"],
        "role": user["role"],
        "role_label": role_def["label"],
        "permissions": perms or [],
        "groups": groups,
        "sip_user": user["sip_user"],
        "sip_password": user["sip_password"],
        "skill_mode": user["skill_mode"],
        "pick_skills": user["pick_skills"],
    }
    if user["role"] == "agent" and user["skill_mode"] == "by_skill":
        out["assigned_skills"] = skills
    return out


# ---------- HTTP dispatch ----------

ROUTES_GET = {
    "/api/admin/roles": fetch_roles_doc,
    "/api/admin/skill-queues": fetch_skill_queues_doc,
    "/api/admin/groups": fetch_groups_doc,
    "/api/admin/users": fetch_users_doc,
    "/api/admin/vdn-routes": fetch_vdn_doc,
    "/api/admin/subscribers-access": fetch_subscribers_doc,
}

ROUTES_PUT = {
    "/api/admin/roles": save_roles_doc,
    "/api/admin/skill-queues": save_skill_queues_doc,
    "/api/admin/groups": save_groups_doc,
    "/api/admin/users": save_users_doc,
    "/api/admin/vdn-routes": save_vdn_doc,
    "/api/admin/subscribers-access": save_subscribers_doc,
}


def _import_crm():
    from crm_api import (
        builtin_crm_payload,
        fetch_crm_doc,
        get_connector_by_id,
        parse_wsdl_operations,
        save_crm_doc,
        subscriber_lookup,
        test_connector,
    )
    return (
        builtin_crm_payload,
        fetch_crm_doc,
        get_connector_by_id,
        parse_wsdl_operations,
        save_crm_doc,
        subscriber_lookup,
        test_connector,
    )


def _import_ops():
    from ops_api import (
        fetch_agents,
        fetch_audit,
        fetch_cdr_history,
        fetch_queues_realtime,
        fetch_recordings,
    )
    return fetch_agents, fetch_audit, fetch_cdr_history, fetch_queues_realtime, fetch_recordings


def export_json_snapshot(conn, filename: str, fetcher) -> None:
    """Синхронизация JSON на диск для AGI (subscribers_access и др.)."""
    from pathlib import Path

    data_dir = Path(os.environ.get("CC_DATA_DIR", Path(__file__).parent / "data"))
    data_dir.mkdir(parents=True, exist_ok=True)
    doc = fetcher(conn)
    path = data_dir / filename
    path.write_text(
        json.dumps(doc, ensure_ascii=False, indent=2, default=_json_serial) + "\n",
        encoding="utf-8",
    )


def trigger_asterisk_sync() -> dict:
    try:
        from asterisk_sync import run_asterisk_sync

        return run_asterisk_sync()
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


SYNC_AFTER_PUT = {
    "/api/admin/skill-queues",
    "/api/admin/groups",
    "/api/admin/users",
    "/api/admin/vdn-routes",
    "/api/admin/subscribers-access",
}


def run_seed_from_disk() -> None:
    from pathlib import Path
    from seed_admin import seed_all

    data_dir = Path(os.environ.get("CC_DATA_DIR", Path(__file__).parent / "data"))
    seed_all(data_dir)


def handle_api(handler) -> bool:
    path = urlparse(handler.path).path
    method = handler.command

    if path == "/api/health" and method == "GET":
        try:
            with db_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
            json_response(handler, 200, {"ok": True, "db": True})
        except Exception as exc:
            json_response(handler, 503, {"ok": False, "db": False, "error": str(exc)})
        return True

    if path == "/api/public/telephony" and method == "GET":
        host = (os.environ.get("PUBLIC_DOMAIN") or "172.16.6.183").strip()
        turn_user = (os.environ.get("TURN_USER") or "ccagent").strip()
        turn_password = (os.environ.get("TURN_PASSWORD") or "ccagentturn").strip()
        webrtc_mode = (os.environ.get("AGENT_WEBRTC_MODE") or "manual").strip().lower()
        bundle_policy = "max-bundle" if webrtc_mode == "standard" else "balanced"
        json_response(
            handler,
            200,
            {
                "domain": host,
                "wss": f"wss://{host}:8089/ws",
                "ws": f"ws://{host}:8088/ws",
                "cert_url": f"https://{host}:8089/static/index.html",
                "agent_cert_url": f"https://{host}:9443/agent/",
                "cert_urls": [
                    f"https://{host}:9443/agent/",
                    f"https://{host}:8089/static/index.html",
                ],
                "sip_provider_signal": os.environ.get("SIP_PROVIDER_SIGNAL", "10.1.5.10"),
                "sip_provider_media": os.environ.get("SIP_PROVIDER_MEDIA", "10.1.5.75"),
                "sip_provider_signal_net": os.environ.get(
                    "SIP_PROVIDER_SIGNAL_NET", "10.1.5.8/29"
                ),
                "sip_provider_media_net": os.environ.get(
                    "SIP_PROVIDER_MEDIA_NET", "10.1.5.64/27"
                ),
                "turn": True,
                "turn_urls": [f"turn:{host}:3478?transport=udp"],
                "turn_user": turn_user,
                "turn_password": turn_password,
                "webrtc_mode": webrtc_mode,
                "bundle_policy": bundle_policy,
            },
        )
        return True

    if not db_available():
        json_response(handler, 503, {"error": "psycopg2 not installed"})
        return True

    try:
        if path == "/api/auth/login" and method == "POST":
            body = read_body(handler) or {}
            with db_conn() as conn:
                user = auth_login(conn, body.get("login", ""), body.get("password", ""))
            if not user:
                json_response(handler, 401, {"ok": False, "error": "Неверный логин или пароль"})
            else:
                json_response(handler, 200, {"ok": True, "user": user})
            return True

        if method == "GET" and path in ROUTES_GET:
            with db_conn() as conn:
                data = ROUTES_GET[path](conn)
            json_response(handler, 200, data)
            return True

        if path == "/api/admin/crm-connectors" and method == "GET":
            _, fetch_crm_doc, *_ = _import_crm()
            with db_conn() as conn:
                data = fetch_crm_doc(conn)
            json_response(handler, 200, data)
            return True

        if path == "/api/ops/sip/registration" and method == "GET":
            from ami_client import pjsip_endpoint_registered

            q = urlparse(handler.path).query
            ext = "1001"
            if "ext=" in q:
                ext = q.split("ext=")[1].split("&")[0].strip() or ext
            json_response(handler, 200, pjsip_endpoint_registered(ext))
            return True

        if path == "/api/ops/queues/realtime" and method == "GET":
            _, _, _, fetch_queues_realtime, _ = _import_ops()
            with db_conn() as conn:
                data = fetch_queues_realtime(conn)
            json_response(handler, 200, {"queues": data})
            return True

        if path == "/api/ops/agents" and method == "GET":
            fetch_agents, *_ = _import_ops()
            with db_conn() as conn:
                data = fetch_agents(conn)
            json_response(handler, 200, {"agents": data})
            return True

        if path == "/api/ops/audit" and method == "GET":
            _, fetch_audit, *_ = _import_ops()
            q = urlparse(handler.path).query
            limit = 50
            if "limit=" in q:
                try:
                    limit = min(500, int(q.split("limit=")[1].split("&")[0]))
                except ValueError:
                    pass
            with db_conn() as conn:
                data = fetch_audit(conn, limit=limit)
            json_response(handler, 200, {"audit": data})
            return True

        if path == "/api/ops/recordings" and method == "GET":
            *_, fetch_recordings = _import_ops()
            with db_conn() as conn:
                data = fetch_recordings(conn)
            json_response(handler, 200, {"recordings": data})
            return True

        if path.startswith("/api/ops/cdr") and method == "GET":
            _, _, fetch_cdr_history, _, _ = _import_ops()
            q = urlparse(handler.path).query
            agent_sip = None
            if "agent=" in q:
                agent_sip = q.split("agent=")[1].split("&")[0]
            with db_conn() as conn:
                data = fetch_cdr_history(conn, agent_sip=agent_sip)
            json_response(handler, 200, {"history": data})
            return True

        m_sub = re.match(r"^/api/subscribers/([^/]+)$", path)
        if m_sub and method == "GET":
            _, _, _, _, _, subscriber_lookup, _ = _import_crm()
            msisdn = m_sub.group(1)
            q = urlparse(handler.path).query
            connector_id = None
            if "connector=" in q:
                try:
                    connector_id = int(q.split("connector=")[1].split("&")[0])
                except ValueError:
                    pass
            with db_conn() as conn:
                data = subscriber_lookup(conn, msisdn, connector_id=connector_id)
            json_response(handler, 200, data)
            return True

        m_builtin = re.match(r"^/api/crm/builtin/([^/]+)$", path)
        if m_builtin and method == "GET":
            builtin_crm_payload, *_ = _import_crm()
            json_response(handler, 200, builtin_crm_payload(m_builtin.group(1)))
            return True

        if path == "/api/crm/wsdl-parse" and method == "GET":
            _, _, _, parse_wsdl_operations, _, _, _ = _import_crm()
            q = urlparse(handler.path).query
            wsdl = ""
            if "url=" in q:
                from urllib.parse import unquote
                wsdl = unquote(q.split("url=", 1)[1].split("&")[0])
            if not wsdl:
                json_response(handler, 400, {"error": "url required"})
                return True
            data = parse_wsdl_operations(wsdl)
            json_response(handler, 200, data)
            return True

        if path == "/api/admin/seed" and method == "POST":
            run_seed_from_disk()
            sync = trigger_asterisk_sync()
            json_response(handler, 200, {"ok": True, "asterisk_sync": sync})
            return True

        if path == "/api/admin/apply-asterisk" and method == "POST":
            sync = trigger_asterisk_sync()
            json_response(handler, 200, sync)
            return True

        if path == "/api/admin/sync-status" and method == "GET":
            try:
                from asterisk_sync import get_sync_status

                json_response(handler, 200, get_sync_status())
            except Exception as exc:
                json_response(handler, 200, {"ok": False, "error": str(exc)})
            return True

        if path == "/api/admin/crm-connectors" and method == "PUT":
            _, _, _, _, _, save_crm_doc, _ = _import_crm()
            body = read_body(handler)
            with db_conn() as conn:
                save_crm_doc(conn, body)
            json_response(handler, 200, {"ok": True})
            return True

        if path == "/api/crm/test" and method == "POST":
            _, _, _, _, _, _, test_connector = _import_crm()
            body = read_body(handler) or {}
            cid = int(body.get("connector_id") or 0)
            msisdn = body.get("msisdn") or ""
            if not cid or not msisdn:
                json_response(handler, 400, {"error": "connector_id and msisdn required"})
                return True
            with db_conn() as conn:
                data = test_connector(conn, cid, msisdn)
            json_response(handler, 200, data)
            return True

        if method == "PUT" and path in ROUTES_PUT:
            body = read_body(handler)
            with db_conn() as conn:
                ROUTES_PUT[path](conn, body)
                if path == "/api/admin/subscribers-access":
                    export_json_snapshot(conn, "subscribers_access.json", fetch_subscribers_doc)
            payload = {"ok": True}
            if path in SYNC_AFTER_PUT:
                payload["asterisk_sync"] = trigger_asterisk_sync()
            json_response(handler, 200, payload)
            return True

    except BadRequest as exc:
        json_response(handler, 400, {"error": f"invalid JSON body: {exc}"})
        return True
    except Exception as exc:
        json_response(handler, 500, {"error": str(exc)})
        return True

    json_response(handler, 404, {"error": "not found"})
    return True

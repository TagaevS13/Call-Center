"""CRM connectors API — REST / SOAP (WSDL), карточка абонента."""
from __future__ import annotations

import json
from typing import Any
from psycopg2.extras import RealDictCursor

from cc_api import normalize_msisdn
from crm_engine import builtin_mock_profile, lookup_subscriber

try:
    from zeep import Client as ZeepClient
    from zeep.transports import Transport
except ImportError:
    ZeepClient = None  # type: ignore


def _connector_row(r: dict) -> dict:
    cfg = r.get("config") or {}
    if isinstance(cfg, str):
        cfg = json.loads(cfg)
    mapping = r.get("field_mapping") or {}
    if isinstance(mapping, str):
        mapping = json.loads(mapping)
    return {
        "id": r["id"],
        "name": r["name"],
        "connector_type": r["connector_type"],
        "enabled": bool(r["enabled"]),
        "is_default": bool(r["is_default"]),
        "config": cfg,
        "field_mapping": mapping,
        "description": r.get("description") or "",
    }


def fetch_crm_doc(conn) -> dict:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT id, name, connector_type, enabled, is_default,
                   config, field_mapping, description
            FROM crm_connectors
            ORDER BY id
            """
        )
        rows = cur.fetchall()
    return {"version": 1, "connectors": [_connector_row(r) for r in rows]}


def save_crm_doc(conn, doc: dict) -> None:
    items = doc.get("connectors") or []
    keep: list[int] = []
    with conn.cursor() as cur:
        defaults = [c for c in items if c.get("is_default")]
        if len(defaults) > 1:
            for c in items:
                if c is not defaults[0]:
                    c["is_default"] = False
        for c in items:
            cfg = c.get("config") or {}
            mapping = c.get("field_mapping") or {}
            cid = c.get("id")
            if cid:
                cur.execute(
                    """
                    UPDATE crm_connectors SET
                      name=%s, connector_type=%s, enabled=%s, is_default=%s,
                      config=%s::jsonb, field_mapping=%s::jsonb, description=%s,
                      updated_at=now()
                    WHERE id=%s
                    """,
                    (
                        c["name"],
                        c.get("connector_type") or "rest",
                        bool(c.get("enabled")),
                        bool(c.get("is_default")),
                        json.dumps(cfg, ensure_ascii=False),
                        json.dumps(mapping, ensure_ascii=False),
                        c.get("description") or "",
                        cid,
                    ),
                )
                keep.append(int(cid))
            else:
                cur.execute(
                    """
                    INSERT INTO crm_connectors
                      (name, connector_type, enabled, is_default, config, field_mapping, description)
                    VALUES (%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s)
                    RETURNING id
                    """,
                    (
                        c["name"],
                        c.get("connector_type") or "rest",
                        bool(c.get("enabled")),
                        bool(c.get("is_default")),
                        json.dumps(cfg, ensure_ascii=False),
                        json.dumps(mapping, ensure_ascii=False),
                        c.get("description") or "",
                    ),
                )
                keep.append(int(cur.fetchone()[0]))
        if keep:
            cur.execute("DELETE FROM crm_connectors WHERE id <> ALL(%s)", (keep,))
        else:
            cur.execute("DELETE FROM crm_connectors")


def get_connector_by_id(conn, connector_id: int) -> dict | None:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT id, name, connector_type, enabled, is_default,
                   config, field_mapping, description
            FROM crm_connectors WHERE id = %s
            """,
            (connector_id,),
        )
        row = cur.fetchone()
    return _connector_row(row) if row else None


def get_default_connector(conn) -> dict | None:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT id, name, connector_type, enabled, is_default,
                   config, field_mapping, description
            FROM crm_connectors
            WHERE enabled = TRUE AND is_default = TRUE
            ORDER BY id LIMIT 1
            """
        )
        row = cur.fetchone()
        if row:
            return _connector_row(row)
        cur.execute(
            """
            SELECT id, name, connector_type, enabled, is_default,
                   config, field_mapping, description
            FROM crm_connectors
            WHERE enabled = TRUE
            ORDER BY id LIMIT 1
            """
        )
        row = cur.fetchone()
    return _connector_row(row) if row else None


def enrich_access_flags(conn, profile: dict, msisdn: str) -> dict:
    n = normalize_msisdn(msisdn)
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT list_type, scope, permanent, valid_from, valid_until, enabled
            FROM subscriber_access
            WHERE msisdn = %s AND enabled = TRUE
            """,
            (n,),
        )
        rows = cur.fetchall()
    flags = []
    for r in rows:
        flags.append(r["list_type"])
    if "vip" in flags:
        profile["vip"] = True
        profile["segment"] = profile.get("segment") or "VIP"
    if "blacklist" in flags:
        profile["blacklist"] = True
    profile["access_flags"] = flags
    return profile


def subscriber_lookup(conn, msisdn: str, connector_id: int | None = None) -> dict:
    n = normalize_msisdn(msisdn)
    if not n:
        raise ValueError("Некорректный номер")
    connector = None
    if connector_id:
        connector = get_connector_by_id(conn, connector_id)
        if not connector:
            raise ValueError("Коннектор не найден")
    else:
        connector = get_default_connector(conn)

    profile: dict
    error = None
    if connector and connector.get("enabled"):
        try:
            profile = lookup_subscriber(n, connector)
        except Exception as exc:
            error = str(exc)
            profile = builtin_mock_profile(n)
            profile["crm_error"] = error
    else:
        profile = builtin_mock_profile(n)
        if not connector:
            profile["crm_note"] = "CRM-коннектор не настроен — встроенная карточка"

    enrich_access_flags(conn, profile, n)
    return {"ok": True, "msisdn": n, "profile": profile, "connector": connector, "error": error}


def test_connector(conn, connector_id: int, msisdn: str) -> dict:
    connector = get_connector_by_id(conn, connector_id)
    if not connector:
        raise ValueError("Коннектор не найден")
    n = normalize_msisdn(msisdn)
    started = __import__("time").time()
    try:
        profile = lookup_subscriber(n, connector)
        ms = int((__import__("time").time() - started) * 1000)
        return {"ok": True, "ms": ms, "profile": profile}
    except Exception as exc:
        ms = int((__import__("time").time() - started) * 1000)
        return {"ok": False, "ms": ms, "error": str(exc)}


def builtin_crm_payload(msisdn: str) -> dict:
    n = normalize_msisdn(msisdn)
    return {
        "msisdn": n,
        "fullName": f"Абонент {n}",
        "tariffPlan": "R500",
        "balance": "42.50",
        "category": "Физическое лицо",
        "segment": "mass",
        "imsi": "",
        "accountCode": "",
        "customerCode": "",
    }


def parse_wsdl_operations(wsdl_url: str, timeout: int = 20) -> dict:
    if ZeepClient is None:
        raise RuntimeError("Установите zeep для разбора WSDL")
    import requests

    session = requests.Session()
    transport = Transport(session=session, timeout=timeout)
    client = ZeepClient(wsdl_url, transport=transport)
    ops = []
    for name in sorted(client.service._binding._operations.keys()):
        ops.append(name)
    return {"ok": True, "wsdl": wsdl_url, "operations": ops}

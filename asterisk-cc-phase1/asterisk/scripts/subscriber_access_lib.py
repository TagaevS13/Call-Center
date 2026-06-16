"""ЧС / VIP: общая логика для FastAGI (читает subscribers_access.json)."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_JSON = "/opt/cc/webui-data/subscribers_access.json"
GROUPS_JSON = "/opt/cc/webui-data/groups.json"


def agi_read_env() -> dict[str, str]:
    import sys
    env = {}
    while True:
        line = sys.stdin.readline()
        if not line or line.strip() == "":
            break
        if ":" in line:
            k, v = line.split(":", 1)
            env[k.strip()] = v.strip()
    return env


def agi_send(cmd: str) -> str:
    import sys
    sys.stdout.write(cmd + "\n")
    sys.stdout.flush()
    return sys.stdin.readline().strip()


def set_var(name: str, value: str) -> None:
    agi_send(f'SET VARIABLE {name} "{value}"')


def normalize_msisdn(raw: str) -> str:
    d = re.sub(r"\D", "", raw or "")
    if len(d) == 9 and d.startswith("9"):
        d = "992" + d
    return d


def load_json(path: str) -> dict:
    p = Path(path)
    if not p.is_file():
        return {}
    with p.open(encoding="utf-8") as f:
        return json.load(f)


def is_active(entry: dict, now: datetime) -> bool:
    if not entry.get("enabled", True):
        return False
    if entry.get("permanent"):
        return True
    vf = entry.get("valid_from")
    vu = entry.get("valid_until")
    if vf:
        start = datetime.strptime(vf, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        if now < start:
            return False
    if vu:
        end = datetime.strptime(vu, "%Y-%m-%d").replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
        if now > end:
            return False
    return bool(vf or vu)


def resolve_queues(entry: dict, groups_doc: dict) -> list[str]:
    qs = {str(q).lower() for q in entry.get("queues") or []}
    for gid in entry.get("group_ids") or []:
        for g in groups_doc.get("groups") or []:
            if g.get("id") == gid:
                for q in g.get("queues") or []:
                    qs.add(str(q).lower())
    return sorted(qs)


def check_access(doc: dict, msisdn: str, groups_doc: dict) -> dict:
    norm = normalize_msisdn(msisdn)
    now = datetime.now(timezone.utc)
    active = [
        e for e in doc.get("entries") or []
        if normalize_msisdn(e.get("msisdn")) == norm and is_active(e, now)
    ]

    for e in active:
        if e.get("list_type") != "blacklist":
            continue
        if e.get("scope") == "selected":
            continue
        return {
            "blocked": True,
            "block_reason": e.get("reason") or "blacklist",
            "vip": False,
            "vip_queue": "vip",
        }

    for e in active:
        if e.get("list_type") != "vip":
            continue
        if e.get("scope") not in (None, "all", ""):
            continue
        qs = resolve_queues(e, groups_doc)
        return {
            "blocked": False,
            "block_reason": "",
            "vip": True,
            "vip_queue": qs[0] if qs else (e.get("queues") or ["vip"])[0],
        }

    return {"blocked": False, "block_reason": "", "vip": False, "vip_queue": "vip"}


def check_queue_block(doc: dict, msisdn: str, queue: str, groups_doc: dict) -> bool:
    norm = normalize_msisdn(msisdn)
    now = datetime.now(timezone.utc)
    q = (queue or "").lower()
    for e in doc.get("entries") or []:
        if normalize_msisdn(e.get("msisdn")) != norm or not is_active(e, now):
            continue
        if e.get("list_type") != "blacklist":
            continue
        scope = e.get("scope") or "all"
        if scope == "all":
            return True
        if q in resolve_queues(e, groups_doc):
            return True
    return False


def check_queue_vip(doc: dict, msisdn: str, queue: str, groups_doc: dict) -> bool:
    norm = normalize_msisdn(msisdn)
    now = datetime.now(timezone.utc)
    q = (queue or "").lower()
    for e in doc.get("entries") or []:
        if normalize_msisdn(e.get("msisdn")) != norm or not is_active(e, now):
            continue
        if e.get("list_type") != "vip":
            continue
        scope = e.get("scope") or "all"
        if scope == "all":
            return True
        if q in resolve_queues(e, groups_doc):
            return True
    return False

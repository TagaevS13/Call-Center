"""Загрузка webui/data/*.json в Postgres (идемпотентно)."""
from __future__ import annotations

import json
from pathlib import Path

from cc_api import (
    db_conn,
    save_groups_doc,
    save_roles_doc,
    save_skill_queues_doc,
    save_subscribers_doc,
    save_users_doc,
    save_vdn_doc,
)
from crm_api import save_crm_doc


def seed_all(data_dir: Path) -> None:
    data_dir = Path(data_dir)
    with db_conn() as conn:
        roles = json.loads((data_dir / "roles.json").read_text(encoding="utf-8"))
        save_roles_doc(conn, roles)

        sq = json.loads((data_dir / "skill_queues.json").read_text(encoding="utf-8"))
        save_skill_queues_doc(conn, sq)

        groups = json.loads((data_dir / "groups.json").read_text(encoding="utf-8"))
        save_groups_doc(conn, groups)

        users = json.loads((data_dir / "users.json").read_text(encoding="utf-8"))
        for u in users.get("users") or []:
            if not u.get("sip_user"):
                u["sip_user"] = f"_{u['login']}"
        save_users_doc(conn, users)

        vdn = json.loads((data_dir / "vdn_routes.json").read_text(encoding="utf-8"))
        save_vdn_doc(conn, vdn)

        sub_path = data_dir / "subscribers_access.json"
        if sub_path.is_file():
            sub = json.loads(sub_path.read_text(encoding="utf-8"))
            save_subscribers_doc(conn, sub)

        crm_path = data_dir / "crm_connectors.json"
        if crm_path.is_file():
            crm = json.loads(crm_path.read_text(encoding="utf-8"))
            save_crm_doc(conn, crm)


if __name__ == "__main__":
    import os
    import sys

    root = Path(__file__).parent / "data"
    if len(sys.argv) > 1:
        root = Path(sys.argv[1])
    os.environ.setdefault("PG_HOST", "127.0.0.1")
    os.environ.setdefault("PG_PORT", "5433")
    seed_all(root)
    print("seed_admin: OK", flush=True)

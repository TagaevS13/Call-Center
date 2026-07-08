"""Вызов cc_config_sync из Web UI (общий том asterisk/etc)."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path

_STATUS_FILE = Path(os.environ.get("CC_ASTERISK_ETC", "/asterisk-etc")) / ".cc_sync_status.json"


def _load_sync_module():
    mod_path = Path(__file__).resolve().parent / "cc_config_sync.py"
    if not mod_path.is_file():
        root = Path(__file__).resolve().parent.parent
        mod_path = root / "asterisk" / "scripts" / "cc_config_sync.py"
    if not mod_path.is_file():
        raise FileNotFoundError(f"cc_config_sync.py not found: {mod_path}")
    spec = importlib.util.spec_from_file_location("cc_config_sync", mod_path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(mod)
    return mod


def run_asterisk_sync() -> dict:
    os.environ.setdefault("CC_ASTERISK_ETC", "/asterisk-etc")
    mod = _load_sync_module()
    etc = Path(os.environ["CC_ASTERISK_ETC"])
    if hasattr(mod, "set_etc_paths"):
        mod.set_etc_paths(etc)
    else:
        mod.ASTERISK_ETC = etc
        mod.QUEUES_FILE = etc / "queues_generated.conf"
        mod.VDN_FILE = etc / "vdn_generated.conf"
        mod.PJSIP_AGENTS_FILE = etc / "pjsip_agents.conf"
        mod.RELOAD_STAMP = etc / ".reload_requested"
    stats = mod.sync_all(request_reload=True)
    stats["ok"] = True
    _STATUS_FILE.write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
    return stats


def get_sync_status() -> dict:
    if _STATUS_FILE.is_file():
        try:
            return json.loads(_STATUS_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    pending = Path(os.environ.get("CC_ASTERISK_ETC", "/asterisk-etc")) / ".reload_requested"
    return {"ok": True, "pending_reload": pending.is_file()}

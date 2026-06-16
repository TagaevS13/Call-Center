"""Minimal AMI client for Asterisk CLI commands (host network / internal LAN)."""
from __future__ import annotations

import os
import re
import socket


def _read_packets(sock: socket.socket, idle_timeout: float = 0.4) -> str:
    import time

    chunks: list[bytes] = []
    sock.settimeout(idle_timeout)
    deadline = time.time() + 8.0
    while time.time() < deadline:
        try:
            data = sock.recv(8192)
        except socket.timeout:
            if chunks:
                break
            continue
        if not data:
            break
        chunks.append(data)
        if b"--END COMMAND--" in b"".join(chunks):
            break
    return b"".join(chunks).decode("utf-8", errors="replace")


def ami_command(command: str, timeout: float = 5.0) -> tuple[bool, str]:
    host = os.environ.get("ASTERISK_AMI_HOST", "127.0.0.1")
    port = int(os.environ.get("ASTERISK_AMI_PORT", "5038"))
    user = os.environ.get("ASTERISK_AMI_USER", "cti")
    secret = os.environ.get("ASTERISK_AMI_PASSWORD", "changeme")
    try:
        sock = socket.create_connection((host, port), timeout=timeout)
    except OSError as exc:
        return False, str(exc)
    try:
        _read_packets(sock)
        sock.sendall(
            f"Action: Login\r\nUsername: {user}\r\nSecret: {secret}\r\nEvents: off\r\n\r\n".encode()
        )
        login = _read_packets(sock)
        if "Success" not in login and "Authentication accepted" not in login:
            return False, login[:500]
        sock.sendall(
            f"Action: Command\r\nCommand: {command}\r\n\r\n".encode()
        )
        out = _read_packets(sock)
        sock.sendall(b"Action: Logoff\r\n\r\n")
        return True, out
    finally:
        sock.close()


def pjsip_endpoint_registered(ext: str) -> dict:
    ext = re.sub(r"\D", "", ext or "")
    ok, raw = ami_command(f"pjsip show endpoint {ext}")
    if not ok:
        return {"ok": False, "registered": False, "error": raw, "ext": ext}
    registered = "Not in use" in raw or "Avail" in raw
    contacts_ok, contacts_raw = ami_command("pjsip show contacts")
    has_contact = False
    if contacts_ok and ext:
        has_contact = bool(re.search(rf"\b{ext}\b|/{ext}@", contacts_raw))
    return {
        "ok": True,
        "ext": ext,
        "registered": has_contact,
        "endpoint_hint": registered,
        "contacts_snippet": contacts_raw[:800] if contacts_raw else "",
    }

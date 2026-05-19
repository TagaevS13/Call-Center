#!/usr/bin/env python3
"""AMI listener that maps Asterisk events to agent_state_log and audit_log.

Subscribes to AMI on 127.0.0.1:5038 (cti user), translates events:
  - QueueMemberAdded / QueueMemberRemoved -> audit_log
  - QueueMemberPause / QueueMemberStatus  -> agent_state_log
  - UserEvent SupervisorSpy / SupervisorWhisper -> audit_log
  - DeviceStateChange (PJSIP/<sip>) -> agent_state_log (READY/BUSY)
"""
import asyncio
import json
import os
import socket
import sys
from typing import Optional

import psycopg

AMI_HOST = os.environ.get("AMI_HOST", "127.0.0.1")
AMI_PORT = int(os.environ.get("AMI_PORT", "5038"))
AMI_USER = os.environ["ASTERISK_AMI_USER"]
AMI_PASS = os.environ["ASTERISK_AMI_PASSWORD"]
NODE = os.environ.get("NODE_NAME", socket.gethostname())

DSN = (
    f"host={os.environ['PG_HOST']} port={os.environ.get('PG_PORT','5432')} "
    f"dbname={os.environ['PG_DB']} user={os.environ['PG_USER']} "
    f"password={os.environ['PG_PASSWORD']}"
)


def ami_pack(d: dict) -> bytes:
    return ("".join(f"{k}: {v}\r\n" for k, v in d.items()) + "\r\n").encode()


async def parse_event(reader: asyncio.StreamReader) -> Optional[dict]:
    msg = {}
    while True:
        raw = await reader.readline()
        if not raw:
            return None
        line = raw.decode(errors="replace").rstrip("\r\n")
        if not line:
            return msg
        if ":" in line:
            k, _, v = line.partition(":")
            msg[k.strip()] = v.strip()


def agent_id(cur, sip: Optional[str]) -> Optional[int]:
    if not sip:
        return None
    cur.execute("SELECT id FROM agents WHERE sip_user = %s", (sip,))
    r = cur.fetchone()
    return r[0] if r else None


def upsert_state(cur, aid: int, state: str, reason: Optional[str]):
    cur.execute(
        "UPDATE agent_state_log SET ended_at = now() "
        "WHERE agent_id = %s AND ended_at IS NULL",
        (aid,),
    )
    cur.execute(
        "INSERT INTO agent_state_log (agent_id, state, reason, started_at) "
        "VALUES (%s, %s, %s, now())",
        (aid, state, reason),
    )


def audit(cur, actor: str, action: str, target: str, payload: dict):
    cur.execute(
        "SELECT log_action(%s, %s, %s, %s, %s::jsonb, NULL, %s)",
        (actor, "system", action, target, json.dumps(payload), f"AMI/{NODE}"),
    )


def device_state(state: str) -> Optional[str]:
    return {
        "NOT_INUSE": "READY",
        "INUSE":     "BUSY",
        "RINGING":   "BUSY",
        "BUSY":      "BUSY",
        "ONHOLD":    "BUSY",
        "UNAVAILABLE": "LOGOUT",
    }.get(state.upper())


async def handle(event: dict, conn):
    name = event.get("Event", "")
    with conn.cursor() as cur:
        if name == "QueueMemberPause":
            sip = (event.get("Interface") or "").split("/")[-1]
            aid = agent_id(cur, sip)
            if aid:
                if event.get("Paused") == "1":
                    upsert_state(cur, aid, "PAUSE", event.get("PausedReason"))
                else:
                    upsert_state(cur, aid, "READY", None)
        elif name == "DeviceStateChange":
            sip = (event.get("Device") or "").split("/")[-1].split("-")[0]
            aid = agent_id(cur, sip)
            mapped = device_state(event.get("State", ""))
            if aid and mapped:
                upsert_state(cur, aid, mapped, event.get("State"))
        elif name in ("QueueMemberAdded", "QueueMemberRemoved"):
            audit(
                cur,
                actor=event.get("Interface", "unknown"),
                action=f"queue_member_{'add' if name.endswith('Added') else 'remove'}",
                target=event.get("Queue", ""),
                payload=event,
            )
        elif name == "UserEvent" and event.get("UserEvent") in (
            "SupervisorSpy", "SupervisorWhisper"
        ):
            audit(
                cur,
                actor=event.get("Actor", "unknown"),
                action=event["UserEvent"].lower(),
                target=event.get("Target", ""),
                payload=event,
            )
        conn.commit()


async def main():
    while True:
        try:
            reader, writer = await asyncio.open_connection(AMI_HOST, AMI_PORT)
            writer.write(ami_pack({"Action": "Login",
                                   "Username": AMI_USER,
                                   "Secret": AMI_PASS,
                                   "Events": "system,call,agent,user"}))
            await writer.drain()
            with psycopg.connect(DSN, autocommit=False) as conn:
                while True:
                    ev = await parse_event(reader)
                    if ev is None:
                        break
                    if ev.get("Event"):
                        await handle(ev, conn)
        except Exception as exc:
            print(f"ami_state_listener: {exc}", file=sys.stderr)
            await asyncio.sleep(5)


if __name__ == "__main__":
    asyncio.run(main())

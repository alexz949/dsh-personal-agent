#!/usr/bin/env python3
"""Small local SQLite task/event store for Personal Dots v0.1.

No external packages; *not* a security boundary. All writers sharing the local
OS account can access the same file. No untrusted shell commands are executed.
"""

import argparse
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

AGENTS = ("phd", "research", "life", "school")
STATUSES = ("todo", "doing", "done", "blocked")
ROOT = Path(__file__).resolve().parent.parent
DB = Path(os.environ.get("PERSONAL_DOTS_DB", str(ROOT / "data" / "state.sqlite3"))).expanduser()


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def quoted(values):
    return ",".join(f"'{value}'" for value in values)


# The agent CHECKs are built from AGENTS; tables created before an agent was added are rebuilt.
TABLES = {
    "tasks": f"""
        CREATE TABLE tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent TEXT NOT NULL CHECK(agent IN ({quoted(AGENTS)})),
            title TEXT NOT NULL,
            details TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','doing','done','blocked')),
            priority INTEGER NOT NULL DEFAULT 1 CHECK(priority BETWEEN 0 AND 3),
            due_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );""",
    "events": f"""
        CREATE TABLE events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL CHECK(source IN ({quoted((*AGENTS, "user"))})),
            target TEXT NOT NULL CHECK(target IN ({quoted(AGENTS)})),
            kind TEXT NOT NULL,
            summary TEXT NOT NULL,
            created_at TEXT NOT NULL,
            acknowledged_at TEXT
        );""",
}


def connect():
    DB.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(DB), timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA busy_timeout=10000")
    for name, create in TABLES.items():
        row = con.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)).fetchone()
        if row is None:
            con.executescript(create)
        elif any(f"'{agent}'" not in row["sql"] for agent in AGENTS):
            con.executescript(f"""
                BEGIN;
                ALTER TABLE {name} RENAME TO {name}_old;
                {create}
                INSERT INTO {name} SELECT * FROM {name}_old;
                DROP TABLE {name}_old;
                COMMIT;
            """)
    con.executescript("""
        CREATE INDEX IF NOT EXISTS tasks_agent_status ON tasks(agent, status);
        CREATE INDEX IF NOT EXISTS events_target_ack ON events(target, acknowledged_at);
    """)
    return con


def output(rows, as_json=False):
    payload = [dict(x) for x in rows]
    if as_json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    elif not payload:
        print("(none)")
    else:
        for row in payload:
            print(" | ".join(f"{k}={v}" for k, v in row.items()))


def parser():
    p = argparse.ArgumentParser(description="Local task + event state for the personal agents")
    sub = p.add_subparsers(dest="command", required=True)
    sub.add_parser("init", help="Create/open the SQLite database")
    a = sub.add_parser("add", help="Add a task")
    a.add_argument("--agent", choices=AGENTS, required=True)
    a.add_argument("--title", required=True)
    a.add_argument("--details", default="")
    a.add_argument("--priority", type=int, choices=range(4), default=1)
    a.add_argument("--due", help="ISO date or date-time, verified by the caller")
    ls = sub.add_parser("list", help="List tasks")
    ls.add_argument("--agent", choices=AGENTS)
    ls.add_argument("--status", choices=STATUSES)
    ls.add_argument("--json", action="store_true")
    ss = sub.add_parser("set-status", help="Set task status")
    ss.add_argument("id", type=int)
    ss.add_argument("status", choices=STATUSES)
    ev = sub.add_parser("event", help="Emit a minimal, nonsensitive cross-agent event")
    ev.add_argument("--source", choices=(*AGENTS, "user"), required=True)
    ev.add_argument("--target", choices=AGENTS, required=True)
    ev.add_argument("--kind", required=True)
    ev.add_argument("--summary", required=True)
    es = sub.add_parser("events", help="List events for one target agent")
    es.add_argument("--agent", choices=AGENTS, required=True)
    es.add_argument("--unread", action="store_true")
    es.add_argument("--json", action="store_true")
    ack = sub.add_parser("ack-event", help="Acknowledge an event as the targeted Agent")
    ack.add_argument("id", type=int)
    ack.add_argument("--agent", choices=AGENTS, required=True)
    return p


def main():
    args = parser().parse_args()
    with connect() as con:
        command = args.command
        now = utc_now()
        if command == "init":
            print(f"Initialized: {DB}")
        elif command == "add":
            if not args.title.strip():
                raise SystemExit("title must not be empty")
            if args.due:
                try:
                    datetime.fromisoformat(args.due.replace("Z", "+00:00"))
                except ValueError:
                    raise SystemExit("due must be an ISO date or datetime")
            cursor = con.execute(
                "INSERT INTO tasks (agent,title,details,priority,due_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
                (args.agent, args.title, args.details, args.priority, args.due, now, now),
            )
            print(f"Created task #{cursor.lastrowid}")
        elif command == "list":
            clauses, values = [], []
            if args.agent:
                clauses.append("agent = ?")
                values.append(args.agent)
            if args.status:
                clauses.append("status = ?")
                values.append(args.status)
            where = " WHERE " + " AND ".join(clauses) if clauses else ""
            rows = con.execute(
                "SELECT id,agent,title,status,priority,due_at,updated_at FROM tasks" + where +
                " ORDER BY CASE status WHEN 'done' THEN 1 ELSE 0 END, priority DESC, id", values
            ).fetchall()
            output(rows, args.json)
        elif command == "set-status":
            cursor = con.execute("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?", (args.status, now, args.id))
            if cursor.rowcount != 1:
                raise SystemExit(f"task #{args.id} not found")
            print(f"Updated task #{args.id} -> {args.status}")
        elif command == "event":
            if not args.kind.strip() or not args.summary.strip():
                raise SystemExit("kind and summary must not be empty")
            cursor = con.execute(
                "INSERT INTO events (source,target,kind,summary,created_at) VALUES (?,?,?,?,?)",
                (args.source, args.target, args.kind, args.summary, now),
            )
            print(f"Created event #{cursor.lastrowid}")
        elif command == "events":
            sql = "SELECT id,source,target,kind,summary,created_at,acknowledged_at FROM events WHERE target = ?"
            if args.unread:
                sql += " AND acknowledged_at IS NULL"
            sql += " ORDER BY id"
            output(con.execute(sql, (args.agent,)).fetchall(), args.json)
        elif command == "ack-event":
            cursor = con.execute(
                "UPDATE events SET acknowledged_at = ? WHERE id = ? AND target = ? AND acknowledged_at IS NULL",
                (now, args.id, args.agent),
            )
            if cursor.rowcount != 1:
                raise SystemExit("event not found, already acknowledged, or target agent mismatch")
            print(f"Acknowledged event #{args.id}")


if __name__ == "__main__":
    main()

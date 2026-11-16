"""No network, keys or third-party dependencies needed."""
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "state.py"


class StateTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.env = {**os.environ, "PERSONAL_DOTS_DB": str(Path(self.tempdir.name) / "state.sqlite3")}

    def tearDown(self):
        self.tempdir.cleanup()

    def cli(self, *args, success=True):
        p = subprocess.run([sys.executable, str(SCRIPT), *args], env=self.env, text=True, capture_output=True)
        if success:
            self.assertEqual(p.returncode, 0, p.stderr)
        return p

    def test_tasks_events(self):
        self.cli("init")
        self.cli("add", "--agent", "phd", "--title", "Draft school list", "--priority", "2")
        tasks = json.loads(self.cli("list", "--agent", "phd", "--json").stdout)
        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0]["status"], "todo")
        self.cli("set-status", str(tasks[0]["id"]), "doing")
        updated = json.loads(self.cli("list", "--agent", "phd", "--json").stdout)
        self.assertEqual(updated[0]["status"], "doing")
        self.cli("event", "--source", "life", "--target", "phd", "--kind", "mail", "--summary", "Needs review")
        events = json.loads(self.cli("events", "--agent", "phd", "--unread", "--json").stdout)
        self.assertEqual(len(events), 1)
        self.cli("ack-event", str(events[0]["id"]), "--agent", "phd")
        events = json.loads(self.cli("events", "--agent", "phd", "--unread", "--json").stdout)
        self.assertFalse(events)

    def test_invalid_agent_and_wrong_ack(self):
        self.assertNotEqual(self.cli("add", "--agent", "invalid", "--title", "X", success=False).returncode, 0)
        self.cli("event", "--source", "user", "--target", "research", "--kind", "paper", "--summary", "New paper")
        self.assertNotEqual(self.cli("ack-event", "1", "--agent", "phd", success=False).returncode, 0)

    def test_old_database_gains_school_and_keeps_rows(self):
        db = self.env["PERSONAL_DOTS_DB"]
        con = sqlite3.connect(db)
        con.executescript("""
            CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, agent TEXT NOT NULL CHECK(agent IN ('phd','research','life')),
                title TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'todo', priority INTEGER NOT NULL DEFAULT 1,
                due_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL CHECK(source IN ('phd','research','life','user')),
                target TEXT NOT NULL CHECK(target IN ('phd','research','life')), kind TEXT NOT NULL, summary TEXT NOT NULL,
                created_at TEXT NOT NULL, acknowledged_at TEXT);
            INSERT INTO tasks (agent, title, created_at, updated_at) VALUES ('research', 'Old task', 'x', 'x');
        """)
        con.close()
        self.cli("add", "--agent", "school", "--title", "Check HW 3 submission")
        self.cli("event", "--source", "school", "--target", "life", "--kind", "deadline", "--summary", "HW due Friday")
        tasks = json.loads(self.cli("list", "--json").stdout)
        self.assertEqual([(t["id"], t["agent"], t["title"]) for t in tasks], [(1, "research", "Old task"), (2, "school", "Check HW 3 submission")])
        self.assertEqual(len(json.loads(self.cli("events", "--agent", "life", "--json").stdout)), 1)


if __name__ == "__main__":
    unittest.main()

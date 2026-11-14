"""Populate the platform with demo projects by running the real pipeline on the example requirements.

Usage:  python -m app.seed
"""

import os

from .agents.orchestrator import add_activity, start_pipeline, workspace_for
from .database import init_db, session_scope
from .models import Project
from .routers.projects import EXAMPLES


def main() -> None:
    os.environ.setdefault("DEVSECURE_PACING_MS", "0")
    init_db()
    for ex in EXAMPLES:
        with session_scope() as db:
            if db.query(Project).filter_by(name=ex["name"]).first():
                print(f"skip  {ex['name']} (exists)")
                continue
            p = Project(name=ex["name"], requirements=ex["requirements"], description=ex["requirements"].split("\n")[0],
                        project_type="service" if "Attendance" in ex["name"] else "web")
            db.add(p)
            db.flush()
            p.workspace = str(workspace_for(p.id))
            pid = p.id
        add_activity("info", f"Project created: {ex['name']}", pid)
        print(f"run   {ex['name']} ...", flush=True)
        start_pipeline(pid, background=False)
        with session_scope() as db:
            print(f"done  {ex['name']}: {db.get(Project, pid).status}")


if __name__ == "__main__":
    main()

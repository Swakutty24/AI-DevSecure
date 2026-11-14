from datetime import timezone

from sqlalchemy.orm import Session

from .models import AgentStep, Finding, PipelineRun, Project, Report, TestCase

AGENTS = ["planner", "developer", "tester", "security"]


def iso(dt):
    if dt is None:
        return None
    # SQLite returns naive datetimes; all stored values are UTC.
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).isoformat()


def latest_run(db: Session, project_id: int) -> PipelineRun | None:
    return db.query(PipelineRun).filter_by(project_id=project_id).order_by(PipelineRun.id.desc()).first()


def project_summary(db: Session, p: Project) -> dict:
    run = latest_run(db, p.id)
    open_findings = db.query(Finding).filter_by(run_id=run.id, status="open").count() if run else 0
    tests = db.query(TestCase).filter_by(run_id=run.id).all() if run else []
    return {
        "id": p.id, "name": p.name, "language": p.language, "project_type": p.project_type,
        "description": p.description, "status": p.status, "created_at": iso(p.created_at),
        "latest_run_id": run.id if run else None,
        "open_findings": open_findings,
        "tests_passed": sum(t.status == "passed" for t in tests), "tests_total": len(tests),
        "coverage": run.coverage if run else 0,
    }


def step_dict(s: AgentStep) -> dict:
    duration = None
    if s.started_at and s.finished_at:
        duration = round((s.finished_at - s.started_at).total_seconds(), 1)
    return {"agent": s.agent, "iteration": s.iteration, "status": s.status, "summary": s.summary,
            "started_at": iso(s.started_at), "finished_at": iso(s.finished_at), "duration": duration}


def run_dict(db: Session, run: PipelineRun) -> dict:
    steps = db.query(AgentStep).filter_by(run_id=run.id).order_by(AgentStep.id).all()
    latest: dict[str, AgentStep] = {}
    for s in steps:
        latest[s.agent] = s
    return {
        "id": run.id, "project_id": run.project_id, "status": run.status, "current_agent": run.current_agent,
        "progress": run.progress, "iteration": run.iteration, "files_created": run.files_created,
        "lines_of_code": run.lines_of_code, "coverage": run.coverage, "gate": run.gate or {},
        "plan": run.plan or {}, "started_at": iso(run.started_at), "finished_at": iso(run.finished_at),
        "steps": [step_dict(latest[a]) if a in latest else {"agent": a, "status": "pending", "iteration": 0} for a in AGENTS],
        "history": [step_dict(s) for s in steps if s.status != "pending"],
    }


def finding_dict(f: Finding) -> dict:
    return {"id": f.id, "severity": f.severity, "tool": f.tool, "rule_id": f.rule_id, "issue": f.issue, "detail": f.detail,
            "cwe": f.cwe, "owasp": f.owasp, "file": f.file, "line": f.line, "snippet": f.snippet,
            "status": f.status, "category": f.category, "iteration": f.iteration}


def report_dict(db: Session, r: Report) -> dict:
    project = db.get(Project, r.project_id) if r.project_id else None
    return {"id": r.id, "name": r.name, "report_type": r.report_type, "fmt": r.fmt, "generated_by": r.generated_by,
            "project": project.name if project else "All Projects", "project_id": r.project_id, "size_bytes": r.size_bytes,
            "sha256": r.sha256, "status": r.status, "created_at": iso(r.created_at)}

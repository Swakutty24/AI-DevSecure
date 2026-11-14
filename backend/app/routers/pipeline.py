from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..agents.orchestrator import cancel_pipeline, rerun
from ..database import get_db
from ..models import AgentMessage, Finding, LogEntry, PipelineRun, Project, TestCase
from ..serializers import finding_dict, iso, latest_run, run_dict

router = APIRouter(prefix="/api", tags=["pipeline"])


def _run_for(db: Session, project_id: int, run_id: int | None = None) -> PipelineRun:
    if db.get(Project, project_id) is None:
        raise HTTPException(404, "Project not found")
    run = db.get(PipelineRun, run_id) if run_id else latest_run(db, project_id)
    if run is None or run.project_id != project_id:
        raise HTTPException(404, "No pipeline run for this project")
    return run


@router.get("/projects/{project_id}/pipeline")
def pipeline_state(project_id: int, after_log: int = 0, agent: str | None = None, db: Session = Depends(get_db)):
    run = _run_for(db, project_id)
    q = db.query(LogEntry).filter(LogEntry.run_id == run.id, LogEntry.id > after_log)
    if agent and agent != "all":
        q = q.filter(LogEntry.agent == agent)
    logs = q.order_by(LogEntry.id).limit(500).all()
    messages = db.query(AgentMessage).filter_by(run_id=run.id).order_by(AgentMessage.id).all()
    return {
        "run": run_dict(db, run),
        "logs": [{"id": l.id, "agent": l.agent, "level": l.level, "message": l.message, "created_at": iso(l.created_at)} for l in logs],
        "messages": [{"id": m.message_id, "sender": m.sender, "recipient": m.recipient, "type": m.msg_type,
                      "verified": m.verified, "note": m.note, "created_at": iso(m.created_at)} for m in messages],
    }


@router.post("/runs/{run_id}/stop")
def stop_run(run_id: int, db: Session = Depends(get_db)):
    run = db.get(PipelineRun, run_id)
    if run is None:
        raise HTTPException(404, "Run not found")
    if run.status != "running" or not cancel_pipeline(run_id):
        raise HTTPException(409, "Run is not active")
    return {"stopping": True}


@router.get("/projects/{project_id}/tests")
def test_results(project_id: int, db: Session = Depends(get_db)):
    run = _run_for(db, project_id)
    cases = db.query(TestCase).filter_by(run_id=run.id).order_by(TestCase.id).all()
    logs = db.query(LogEntry).filter_by(run_id=run.id, agent="tester").order_by(LogEntry.id).all()
    total = len(cases)
    passed = sum(c.status == "passed" for c in cases)
    return {
        "run_id": run.id, "run_status": run.status, "running": run.status == "running",
        "summary": {"total": total, "passed": passed, "failed": sum(c.status == "failed" for c in cases),
                    "success_rate": round(100 * passed / total) if total else 0, "coverage": run.coverage},
        "cases": [{"id": c.id, "name": c.name, "file": c.file, "status": c.status, "duration": c.duration, "message": c.message} for c in cases],
        "coverage_files": (run.coverage_detail or {}).get("files", []),
        "output": run.test_output,
        "logs": [f"[{iso(l.created_at)[11:19]}] {l.level} {l.message}" for l in logs],
    }


@router.post("/projects/{project_id}/tests/run")
def run_tests(project_id: int, db: Session = Depends(get_db)):
    run = _run_for(db, project_id)
    if run.status == "running":
        raise HTTPException(409, "Pipeline is running")
    if not run.plan:
        raise HTTPException(409, "Pipeline has no plan yet")
    rerun(run.id, "tests")
    return {"started": True, "run_id": run.id}


@router.get("/projects/{project_id}/security")
def security_results(project_id: int, db: Session = Depends(get_db)):
    run = _run_for(db, project_id)
    findings = db.query(Finding).filter_by(run_id=run.id).all()
    order = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3}
    findings.sort(key=lambda f: (f.status != "open", order.get(f.severity, 9), f.file, f.line))
    open_f = [f for f in findings if f.status == "open"]
    logs = db.query(LogEntry).filter_by(run_id=run.id, agent="security").order_by(LogEntry.id).all()
    return {
        "run_id": run.id, "run_status": run.status, "running": run.status == "running",
        "counts": {"total": len(open_f), **{s: sum(f.severity == s for f in open_f) for s in order}},
        "fixed": sum(f.status == "fixed" for f in findings),
        "findings": [finding_dict(f) for f in findings if f.category != "dependency"],
        "dependencies": [finding_dict(f) for f in findings if f.category == "dependency"],
        "logs": [f"[{iso(l.created_at)[11:19]}] {l.level} {l.message}" for l in logs],
        "gate": run.gate or {},
    }


@router.post("/projects/{project_id}/security/run")
def run_security(project_id: int, db: Session = Depends(get_db)):
    run = _run_for(db, project_id)
    if run.status == "running":
        raise HTTPException(409, "Pipeline is running")
    rerun(run.id, "security")
    return {"started": True, "run_id": run.id}


@router.get("/runs")
def list_runs(limit: int = Query(20, le=100), db: Session = Depends(get_db)):
    runs = db.query(PipelineRun).order_by(PipelineRun.id.desc()).limit(limit).all()
    return [run_dict(db, r) for r in runs]

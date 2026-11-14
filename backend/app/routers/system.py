import shutil

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import __version__
from ..agents.security import semgrep_available
from ..config import REPORTS_DIR, WORKSPACES_DIR
from ..database import get_db
from ..models import Activity, AgentStep, PipelineRun, Project, Report
from ..serializers import iso, project_summary
from ..services.settings import get_settings, public_settings, reset_settings, update_settings

router = APIRouter(prefix="/api", tags=["system"])

AGENT_MINUTE_QUOTA = 10_000


class Confirm(BaseModel):
    confirm: str


def _agent_minutes(db: Session) -> float:
    total = 0.0
    for s in db.query(AgentStep).filter(AgentStep.started_at.is_not(None), AgentStep.finished_at.is_not(None)):
        total += (s.finished_at - s.started_at).total_seconds()
    return round(total / 60, 2)


@router.get("/health")
def health(db: Session = Depends(get_db)):
    s = get_settings(db)
    return {"status": "ok", "version": __version__, "llm_connected": bool(s["integrations"]["llm_api_key"]),
            "semgrep": semgrep_available(), "git": shutil.which("git") is not None}


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db)):
    projects = db.query(Project).order_by(Project.id.desc()).all()
    counts = {k: sum(p.status == k for p in projects) for k in ("completed", "in_progress", "failed")}
    dist = {a: db.query(AgentStep).filter(AgentStep.agent == a, AgentStep.status.in_(["completed", "failed"])).count()
            for a in ("planner", "developer", "tester", "security")}
    acts = db.query(Activity).order_by(Activity.id.desc()).limit(6).all()
    running = db.query(PipelineRun).filter_by(status="running").count()
    return {
        "stats": {"total": len(projects), **counts, "running_pipelines": running},
        "recent_projects": [project_summary(db, p) for p in projects[:5]],
        "task_distribution": dist,
        "activity": [{"id": a.id, "kind": a.kind, "message": a.message, "project_id": a.project_id, "created_at": iso(a.created_at)} for a in acts],
    }


@router.get("/activity")
def activity(limit: int = 50, db: Session = Depends(get_db)):
    acts = db.query(Activity).order_by(Activity.id.desc()).limit(min(limit, 200)).all()
    return [{"id": a.id, "kind": a.kind, "message": a.message, "project_id": a.project_id, "created_at": iso(a.created_at)} for a in acts]


@router.get("/settings")
def read_settings(db: Session = Depends(get_db)):
    out = public_settings(get_settings(db))
    out["usage"] = {"agent_minutes": _agent_minutes(db), "quota": AGENT_MINUTE_QUOTA, "pipelines": db.query(PipelineRun).count()}
    out["environment"] = {"semgrep": semgrep_available(), "git": shutil.which("git") is not None, "version": __version__}
    return out


@router.put("/settings")
def write_settings(patch: dict, db: Session = Depends(get_db)):
    update_settings(db, patch)
    return read_settings(db)


@router.post("/settings/reset")
def reset(db: Session = Depends(get_db)):
    reset_settings(db)
    return read_settings(db)


@router.post("/settings/purge-cache")
def purge_cache():
    removed = 0
    for pattern in ("__pycache__", ".devsecure", ".pytest_cache"):
        for d in WORKSPACES_DIR.rglob(pattern):
            if d.is_dir():
                shutil.rmtree(d, ignore_errors=True)
                removed += 1
    for f in WORKSPACES_DIR.rglob(".coverage"):
        f.unlink(missing_ok=True)
        removed += 1
    return {"purged": removed}


@router.post("/settings/delete-workspace")
def delete_workspace(body: Confirm, db: Session = Depends(get_db)):
    if body.confirm != "DELETE":
        raise HTTPException(400, 'Type "DELETE" to confirm')
    if db.query(PipelineRun).filter_by(status="running").count():
        raise HTTPException(409, "Stop running pipelines first")
    for model in (Report, Activity, Project):
        db.query(model).delete()
    db.commit()
    for child in WORKSPACES_DIR.iterdir():
        shutil.rmtree(child, ignore_errors=True) if child.is_dir() else child.unlink(missing_ok=True)
    for child in REPORTS_DIR.iterdir():
        child.unlink(missing_ok=True)
    return {"deleted": True}

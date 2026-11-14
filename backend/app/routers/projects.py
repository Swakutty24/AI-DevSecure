import io
import shutil
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..agents.orchestrator import add_activity, start_pipeline, workspace_for
from ..database import get_db
from ..models import Project
from ..security.guard import inspect_text
from ..security.sandbox import safe_join
from ..serializers import latest_run, project_summary, run_dict

router = APIRouter(prefix="/api", tags=["projects"])

HIDDEN = (".git", ".devsecure", "__pycache__", ".coverage", ".pytest_cache")
EDITABLE_SUFFIXES = {".py", ".txt", ".md", ".toml", ".cfg", ".ini", ".json", ".yml", ".yaml"}

EXAMPLES = [
    {"key": "student", "label": "Student Management", "name": "Student Registration API",
     "requirements": "Create a REST API to register students with the following fields:\n- Student name\n- Register number\n- Email\nValidate inputs and prevent duplicate register numbers. Include proper error handling and follow best practices."},
    {"key": "library", "label": "Library System", "name": "Library Management System",
     "requirements": "Create a REST API to manage library books with the following fields:\n- Title\n- Author\n- ISBN\n- Published year\n- Available copies\nValidate inputs and prevent duplicate ISBN values."},
    {"key": "quiz", "label": "Quiz App", "name": "Online Quiz Application",
     "requirements": "Create a REST API to manage quiz questions with the following fields:\n- Question text\n- Option A\n- Option B\n- Option C\n- Option D\n- Correct answer\n- Difficulty level\nQuestion text must be unique."},
    {"key": "hostel", "label": "Hostel", "name": "Hostel Management System",
     "requirements": "Create a REST API to manage hostel rooms with the following fields:\n- Room number\n- Block\n- Capacity\n- Monthly fee\nPrevent duplicate room numbers."},
    {"key": "attendance", "label": "Attendance", "name": "Attendance Management",
     "requirements": "Create a REST API to record attendance entries with the following fields:\n- Student email\n- Course code\n- Session date\n- Hours attended\nValidate all inputs."},
]


class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    language: str = Field("python-fastapi", max_length=40)
    project_type: str = Field("web", pattern="^(web|service|desktop|library)$")
    description: str = Field("", max_length=500)
    requirements: str = Field("", max_length=20000)
    start: bool = True


class FileUpdate(BaseModel):
    path: str
    content: str = Field(..., max_length=200_000)


def _project(db: Session, project_id: int) -> Project:
    p = db.get(Project, project_id)
    if p is None:
        raise HTTPException(404, "Project not found")
    return p


@router.get("/examples")
def examples():
    return EXAMPLES


@router.post("/guard/check")
def guard_check(body: dict):
    res = inspect_text(str(body.get("text", "")))
    return {"safe": res.safe, "detections": res.detections}


@router.get("/projects")
def list_projects(db: Session = Depends(get_db)):
    return [project_summary(db, p) for p in db.query(Project).order_by(Project.id.desc()).all()]


@router.post("/projects", status_code=201)
def create_project(body: ProjectCreate, db: Session = Depends(get_db)):
    requirements = body.requirements.strip() or body.description.strip()
    if not requirements:
        raise HTTPException(422, "Requirements or description are required")
    p = Project(name=body.name.strip(), language=body.language, project_type=body.project_type,
                description=body.description.strip(), requirements=requirements)
    db.add(p)
    db.commit()
    p.workspace = str(workspace_for(p.id))
    db.commit()
    add_activity("info", f"Project created: {p.name}", p.id)
    run_id = start_pipeline(p.id) if body.start else None
    return {**project_summary(db, p), "run_id": run_id}


@router.get("/projects/{project_id}")
def get_project(project_id: int, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    run = latest_run(db, p.id)
    return {**project_summary(db, p), "requirements": p.requirements, "workspace": p.workspace,
            "latest_run": run_dict(db, run) if run else None}


@router.post("/projects/{project_id}/run")
def rerun_project(project_id: int, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    run = latest_run(db, p.id)
    if run and run.status == "running":
        raise HTTPException(409, "A pipeline is already running for this project")
    return {"run_id": start_pipeline(p.id)}


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(project_id: int, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    ws = Path(p.workspace) if p.workspace else None
    db.delete(p)
    db.commit()
    if ws and ws.exists():
        shutil.rmtree(ws, ignore_errors=True)


def _visible_files(ws: Path) -> list[Path]:
    if not ws.exists():
        return []
    return sorted(p for p in ws.rglob("*") if p.is_file() and not any(part in HIDDEN for part in p.relative_to(ws).parts) and p.name != ".gitignore")


@router.get("/projects/{project_id}/files")
def list_files(project_id: int, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    ws = Path(p.workspace)
    return {"root": ws.name, "workspace": str(ws), "files": [{"path": f.relative_to(ws).as_posix(), "size": f.stat().st_size} for f in _visible_files(ws)]}


@router.get("/projects/{project_id}/files/content")
def read_file(project_id: int, path: str = Query(...), db: Session = Depends(get_db)):
    p = _project(db, project_id)
    try:
        target = safe_join(Path(p.workspace), path)
    except ValueError:
        raise HTTPException(400, "Invalid path")
    if not target.is_file() or any(part in HIDDEN for part in Path(path).parts):
        raise HTTPException(404, "File not found")
    return {"path": path, "content": target.read_text(errors="replace"), "absolute_path": str(target)}


@router.put("/projects/{project_id}/files/content")
def write_file(project_id: int, body: FileUpdate, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    try:
        target = safe_join(Path(p.workspace), body.path)
    except ValueError:
        raise HTTPException(400, "Invalid path")
    if target.suffix not in EDITABLE_SUFFIXES or any(part in HIDDEN for part in Path(body.path).parts):
        raise HTTPException(400, "File type not editable")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(body.content)
    add_activity("code", f"{body.path} edited manually in {p.name}", p.id)
    return {"path": body.path, "saved": True}


@router.get("/projects/{project_id}/download")
def download_zip(project_id: int, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    ws = Path(p.workspace)
    buf = io.BytesIO()
    root = "".join(c if c.isalnum() else "_" for c in p.name.lower()).strip("_") or "project"
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in _visible_files(ws):
            zf.write(f, f"{root}/{f.relative_to(ws).as_posix()}")
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{root}.zip"'})

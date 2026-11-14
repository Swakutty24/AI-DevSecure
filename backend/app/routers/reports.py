from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AgentMessage, Finding, PipelineRun, Project, Report, TestCase
from ..serializers import report_dict
from ..services.reports import create_report

router = APIRouter(prefix="/api/reports", tags=["reports"])

OWASP_CWES = {"CWE-89", "CWE-78", "CWE-95", "CWE-94", "CWE-20", "CWE-798", "CWE-259", "CWE-502", "CWE-327", "CWE-295", "CWE-489", "CWE-1104"}
SANS_TOP25 = {"CWE-89", "CWE-78", "CWE-94", "CWE-95", "CWE-20", "CWE-798", "CWE-502", "CWE-22", "CWE-79", "CWE-287", "CWE-352", "CWE-434"}
MEDIA = {"pdf": "application/pdf", "csv": "text/csv", "json": "application/json"}


class ReportCreate(BaseModel):
    report_type: str = Field("executive", pattern="^(security|testing|pipeline|executive)$")
    fmt: str = Field("pdf", pattern="^(pdf|csv|json)$")
    project_id: int | None = None


def _latest_runs(db: Session) -> list[PipelineRun]:
    latest: dict[int, PipelineRun] = {}
    for r in db.query(PipelineRun).filter(PipelineRun.status != "running").order_by(PipelineRun.id):
        latest[r.project_id] = r
    return list(latest.values())


def _score(findings: list[Finding], cwes: set[str]) -> tuple[int, int, int]:
    relevant = [f for f in findings if f.cwe in cwes]
    if not relevant:
        return 100, 0, 0
    fixed = sum(f.status == "fixed" for f in relevant)
    return round(100 * fixed / len(relevant)), fixed, len(relevant) - fixed


@router.get("")
def list_reports(report_type: str | None = None, project_id: int | None = None, fmt: str | None = None,
                 days: int = Query(30, ge=1, le=3650), db: Session = Depends(get_db)):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    q = db.query(Report)
    if report_type and report_type != "all":
        q = q.filter(Report.report_type == report_type)
    if project_id:
        q = q.filter(Report.project_id == project_id)
    if fmt and fmt != "all":
        q = q.filter(Report.fmt == fmt)
    reports = [r for r in q.order_by(Report.id.desc()).all() if r.created_at.replace(tzinfo=r.created_at.tzinfo or timezone.utc) >= since]

    runs = _latest_runs(db)
    run_ids = [r.id for r in runs]
    findings = db.query(Finding).filter(Finding.run_id.in_(run_ids)).all() if run_ids else []
    tests = db.query(TestCase).filter(TestCase.run_id.in_(run_ids)).all() if run_ids else []
    msgs = db.query(AgentMessage).filter(AgentMessage.run_id.in_(run_ids)).all() if run_ids else []

    owasp, o_fixed, o_open = _score(findings, OWASP_CWES)
    sans, s_fixed, s_open = _score(findings, SANS_TOP25)
    gate_rate = round(100 * sum(bool((r.gate or {}).get("passed")) for r in runs) / len(runs)) if runs else 100
    verified = sum(m.verified for m in msgs)
    msg_rate = round(100 * verified / len(msgs)) if msgs else 100
    compliance = [
        {"name": "OWASP Top 10", "score": owasp, "left": "A01-A10 mapped", "right": f"{o_open} open"},
        {"name": "CWE / SANS Top 25", "score": sans, "left": "Injection & memory checks", "right": f"{s_fixed} remediated"},
        {"name": "Policy Gate Pass Rate", "score": gate_rate, "left": "Release gate enforcement", "right": f"{len(runs)} pipelines"},
        {"name": "Secure Agent Messaging", "score": msg_rate, "left": "HMAC-verified messages", "right": f"{verified}/{len(msgs)}"},
    ]
    month_ago = datetime.now(timezone.utc) - timedelta(days=30)
    all_reports = db.query(Report).all()
    passed = sum(t.status == "passed" for t in tests)
    exports = db.query(Report).order_by(Report.id.desc()).limit(3).all()
    open_critical = sum(f.status == "open" and f.severity == "Critical" for f in findings)
    return {
        "kpis": {
            "total_reports": len(all_reports),
            "reports_this_month": sum((r.created_at.replace(tzinfo=r.created_at.tzinfo or timezone.utc)) >= month_ago for r in all_reports),
            "projects": db.query(Project).count(),
            "compliance_score": round(sum(c["score"] for c in compliance) / len(compliance), 1),
            "open_critical": open_critical,
            "test_pass_rate": round(100 * passed / len(tests), 1) if tests else 0,
            "tests_total": len(tests),
            "resolved_vulnerabilities": sum(f.status == "fixed" for f in db.query(Finding).all()),
        },
        "compliance": compliance,
        "reports": [report_dict(db, r) for r in reports],
        "exports": [report_dict(db, r) for r in exports],
    }


@router.post("", status_code=201)
def generate(body: ReportCreate, db: Session = Depends(get_db)):
    if body.project_id and db.get(Project, body.project_id) is None:
        raise HTTPException(404, "Project not found")
    rid = create_report(body.report_type, body.fmt, project_id=body.project_id, generated_by="Admin")
    return report_dict(db, db.get(Report, rid))


@router.post("/digest/run", status_code=201)
def run_digest(db: Session = Depends(get_db)):
    from ..services.digest import send_digest

    return report_dict(db, db.get(Report, send_digest()))


@router.get("/{report_id}/download")
def download(report_id: int, db: Session = Depends(get_db)):
    r = db.get(Report, report_id)
    if r is None or not Path(r.path).exists():
        raise HTTPException(404, "Report not found")
    filename = "".join(c if c.isalnum() or c in "-_" else "_" for c in r.name)[:80] + f".{r.fmt}"
    return FileResponse(r.path, media_type=MEDIA[r.fmt], filename=filename)


@router.delete("/{report_id}", status_code=204)
def delete(report_id: int, db: Session = Depends(get_db)):
    r = db.get(Report, report_id)
    if r is None:
        raise HTTPException(404, "Report not found")
    Path(r.path).unlink(missing_ok=True)
    db.delete(r)
    db.commit()

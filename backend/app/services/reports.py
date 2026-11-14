"""Report generation (PDF / CSV / JSON) for security audits, test coverage and pipeline summaries."""

import csv
import hashlib
import io
import json
from datetime import datetime, timezone

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from ..config import REPORTS_DIR
from ..database import session_scope
from ..models import Finding, PipelineRun, Project, Report, TestCase

TYPE_LABELS = {"security": "Security Audit", "testing": "Test Coverage", "pipeline": "Agent Performance", "executive": "Executive Summary"}
GENERATED_BY = {"security": "Security Agent", "testing": "Tester Agent", "pipeline": "System Admin", "executive": "System Admin"}
BRAND = colors.HexColor("#4f46e5")


def _collect(run_id: int | None, project_id: int | None) -> dict:
    with session_scope() as db:
        runs = []
        if run_id:
            runs = [db.get(PipelineRun, run_id)]
        elif project_id:
            r = db.query(PipelineRun).filter_by(project_id=project_id).order_by(PipelineRun.id.desc()).first()
            runs = [r] if r else []
        else:
            latest: dict[int, PipelineRun] = {}
            for r in db.query(PipelineRun).order_by(PipelineRun.id).all():
                latest[r.project_id] = r
            runs = list(latest.values())
        data = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "projects": []}
        for r in runs:
            if r is None:
                continue
            p = db.get(Project, r.project_id)
            findings = db.query(Finding).filter_by(run_id=r.id).all()
            tests = db.query(TestCase).filter_by(run_id=r.id).all()
            data["projects"].append({
                "project": p.name, "project_id": p.id, "run_id": r.id, "status": r.status, "iterations": r.iteration,
                "coverage": r.coverage, "gate": r.gate or {}, "files": r.files_created, "lines": r.lines_of_code,
                "started_at": r.started_at.isoformat() if r.started_at else "", "finished_at": r.finished_at.isoformat() if r.finished_at else "",
                "findings": [{"severity": f.severity, "tool": f.tool, "rule": f.rule_id, "issue": f.issue, "file": f.file, "line": f.line,
                              "cwe": f.cwe, "owasp": f.owasp, "status": f.status, "iteration": f.iteration} for f in findings],
                "tests": [{"name": t.name, "status": t.status, "duration": t.duration} for t in tests],
                "coverage_files": (r.coverage_detail or {}).get("files", []),
            })
        return data


def _table(rows: list[list], widths: list[float]) -> Table:
    t = Table(rows, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BRAND), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f1f5f9")]),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#cbd5e1")), ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return t


def _pdf(report_type: str, title: str, data: dict) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=16 * mm, bottomMargin=16 * mm, title=title)
    ss = getSampleStyleSheet()
    ss["Title"].textColor = BRAND
    story = [Paragraph("AI DevSecure - Secure Multi-Agent AI Framework", ss["Normal"]), Paragraph(title, ss["Title"]),
             Paragraph(f"Generated {data['generated_at']} UTC", ss["Normal"]), Spacer(1, 8)]
    if not data["projects"]:
        story.append(Paragraph("No pipeline runs available.", ss["Normal"]))
    for p in data["projects"]:
        open_f = [f for f in p["findings"] if f["status"] == "open"]
        passed = sum(t["status"] == "passed" for t in p["tests"])
        gate = p["gate"]
        story += [Paragraph(f"{p['project']} (run #{p['run_id']})", ss["Heading2"]),
                  Paragraph(f"Status: <b>{p['status'].upper()}</b> &nbsp; Iterations: {p['iterations']} &nbsp; "
                            f"Tests: {passed}/{len(p['tests'])} passed &nbsp; Coverage: {p['coverage']}% &nbsp; "
                            f"Open findings: {len(open_f)} &nbsp; Policy gate: <b>{'PASS' if gate.get('passed') else 'BLOCKED'}</b>", ss["Normal"])]
        if gate.get("reasons"):
            story.append(Paragraph("Gate reasons: " + "; ".join(gate["reasons"]), ss["Normal"]))
        story.append(Spacer(1, 6))
        if report_type in ("security", "executive", "pipeline") and p["findings"]:
            rows = [["Severity", "Tool", "Issue", "File:Line", "CWE", "Status"]]
            rows += [[f["severity"], f["tool"], Paragraph(f["issue"], ss["BodyText"]), f"{f['file']}:{f['line']}", f["cwe"], f["status"]] for f in p["findings"]]
            story += [Paragraph("Vulnerability findings", ss["Heading3"]), _table(rows, [18 * mm, 26 * mm, 58 * mm, 36 * mm, 18 * mm, 16 * mm]), Spacer(1, 6)]
        if report_type in ("testing", "executive", "pipeline") and p["tests"]:
            rows = [["Test", "Status", "Time (s)"]] + [[t["name"], t["status"], f"{t['duration']:.2f}"] for t in p["tests"]]
            story += [Paragraph("Test cases", ss["Heading3"]), _table(rows, [110 * mm, 30 * mm, 30 * mm]), Spacer(1, 6)]
        if report_type == "testing" and p["coverage_files"]:
            rows = [["File", "Statements", "Missing", "Coverage %"]] + [[c["file"], c["statements"], c["missing"], c["percent"]] for c in p["coverage_files"]]
            story += [Paragraph("Coverage by file", ss["Heading3"]), _table(rows, [90 * mm, 26 * mm, 26 * mm, 28 * mm])]
    doc.build(story)
    return buf.getvalue()


def _csv(data: dict) -> bytes:
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["project", "run_id", "severity", "tool", "rule", "issue", "file", "line", "cwe", "owasp", "status"])
    for p in data["projects"]:
        for f in p["findings"]:
            w.writerow([p["project"], p["run_id"], f["severity"], f["tool"], f["rule"], f["issue"], f["file"], f["line"], f["cwe"], f["owasp"], f["status"]])
    return out.getvalue().encode()


def create_report(report_type: str, fmt: str = "pdf", run_id: int | None = None, project_id: int | None = None,
                  generated_by: str | None = None, name: str | None = None) -> int:
    report_type = report_type if report_type in TYPE_LABELS else "executive"
    fmt = fmt if fmt in ("pdf", "csv", "json") else "pdf"
    data = _collect(run_id, project_id)
    scope = data["projects"][0]["project"] if len(data["projects"]) == 1 and (run_id or project_id) else "All Projects"
    title = name or f"{TYPE_LABELS[report_type]} Report - {scope}"
    if fmt == "pdf":
        content = _pdf(report_type, title, data)
    elif fmt == "csv":
        content = _csv(data)
    else:
        content = json.dumps({"title": title, **data}, indent=2).encode()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
    path = REPORTS_DIR / f"{report_type}_{stamp}.{fmt}"
    path.write_bytes(content)
    with session_scope() as db:
        rep = Report(project_id=project_id or (data["projects"][0]["project_id"] if run_id and data["projects"] else None),
                     run_id=run_id, name=title, report_type=report_type, fmt=fmt,
                     generated_by=generated_by or GENERATED_BY[report_type], path=str(path), size_bytes=len(content),
                     sha256=hashlib.sha256(content).hexdigest())
        db.add(rep)
        db.flush()
        return rep.id


def generate_pipeline_reports(run_id: int) -> None:
    create_report("security", "pdf", run_id=run_id)
    create_report("testing", "pdf", run_id=run_id)

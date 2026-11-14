"""Pipeline orchestrator: Planner -> Developer -> Tester -> Security with a feedback loop."""

import os
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

from ..config import BUS_SECRET, WORKSPACES_DIR
from ..database import session_scope
from ..models import Activity, AgentMessage, AgentStep, Finding, LogEntry, PipelineRun, Project, TestCase, utcnow
from ..security.guard import inspect_text
from ..security.messaging import Envelope, MessageRejected, SecureMessageBus
from ..services.settings import get_settings
from .base import AgentContext, PipelineCancelled
from .developer import DeveloperAgent
from .llm import LLMClient
from .planner import PlannerAgent
from .security import SecurityAgent
from .tester import TesterAgent

AGENTS = ["planner", "developer", "tester", "security"]
LOOP_SEVERITIES = {"Critical", "High", "Medium"}

_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="pipeline")
_cancel_flags: dict[int, threading.Event] = {}


def add_activity(kind: str, message: str, project_id: int | None = None) -> None:
    with session_scope() as db:
        db.add(Activity(kind=kind, message=message[:255], project_id=project_id))


def workspace_for(project_id: int) -> Path:
    path = WORKSPACES_DIR / f"project_{project_id}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def start_pipeline(project_id: int, background: bool = True) -> int:
    with session_scope() as db:
        project = db.get(Project, project_id)
        project.status = "in_progress"
        project.workspace = str(workspace_for(project_id))
        run = PipelineRun(project_id=project_id, status="running", current_agent="planner")
        db.add(run)
        db.flush()
        for agent in AGENTS:
            db.add(AgentStep(run_id=run.id, agent=agent, status="pending"))
        run_id = run.id
    _cancel_flags[run_id] = threading.Event()
    if background:
        _executor.submit(_safe_run, run_id, "full")
    else:
        _safe_run(run_id, "full")
    return run_id


def rerun(run_id: int, mode: str) -> None:
    """mode: 'tests' or 'security' - re-execute a single agent against the existing workspace."""
    _cancel_flags[run_id] = threading.Event()
    with session_scope() as db:
        run = db.get(PipelineRun, run_id)
        run.status = "running"
    _executor.submit(_safe_run, run_id, mode)


def cancel_pipeline(run_id: int) -> bool:
    flag = _cancel_flags.get(run_id)
    if flag:
        flag.set()
        return True
    return False


def _safe_run(run_id: int, mode: str) -> None:
    try:
        Pipeline(run_id).execute(mode)
    except Exception:  # pragma: no cover - last-resort guard for background thread
        traceback.print_exc()


class Pipeline:
    def __init__(self, run_id: int):
        self.run_id = run_id
        with session_scope() as db:
            run = db.get(PipelineRun, run_id)
            project = db.get(Project, run.project_id)
            self.project_id = project.id
            self.project_name = project.name
            self.requirements = project.requirements or project.description
            self.workspace = Path(project.workspace or workspace_for(project.id))
            self.plan = run.plan or {}
            settings = get_settings(db)
        self.settings = settings
        self.llm = LLMClient(settings["integrations"]["llm_base_url"], settings["integrations"]["llm_api_key"])
        self.bus = SecureMessageBus(BUS_SECRET, on_event=self._on_message)
        self.cancel_flag = _cancel_flags.setdefault(run_id, threading.Event())
        self.ctx = AgentContext(
            run_id=run_id, project_name=self.project_name, workspace=self.workspace, settings=settings,
            llm=self.llm, bus=self.bus, log=self._log, set_progress=self._set_progress, is_cancelled=self.cancel_flag.is_set,
            pacing_s=float(os.getenv("DEVSECURE_PACING_MS", settings["general"].get("pacing_ms", 0)) or 0) / 1000,
        )

    # ---- persistence helpers -------------------------------------------------
    def _log(self, agent: str, level: str, message: str) -> None:
        with session_scope() as db:
            db.add(LogEntry(run_id=self.run_id, agent=agent, level=level, message=message[:2000]))

    def _set_progress(self, pct: int) -> None:
        with session_scope() as db:
            run = db.get(PipelineRun, self.run_id)
            run.progress = pct
            if "files_created" in self.ctx.extras:
                run.files_created = self.ctx.extras["files_created"]
                run.lines_of_code = self.ctx.extras["lines_of_code"]

    def _on_message(self, env: Envelope, verified: bool, note: str) -> None:
        with session_scope() as db:
            db.add(AgentMessage(run_id=self.run_id, message_id=env.id, sender=env.sender, recipient=env.recipient,
                                msg_type=env.msg_type, verified=verified, note=note or f"sig {env.signature[:12]}…"))
        self._log("bus", "INFO" if verified else "ERROR",
                  f"{'✓' if verified else '✗'} {env.sender} → {env.recipient} [{env.msg_type}] {'HMAC verified' if verified else 'REJECTED: ' + note}")

    def _step(self, agent: str, iteration: int, status: str, summary: str = "") -> None:
        with session_scope() as db:
            step = (db.query(AgentStep).filter_by(run_id=self.run_id, agent=agent)
                    .order_by(AgentStep.id.desc()).first())
            if step is None or (status == "running" and step.status in ("completed", "failed") and step.iteration != iteration):
                step = AgentStep(run_id=self.run_id, agent=agent, iteration=iteration)
                db.add(step)
            step.iteration = iteration
            step.status = status
            if summary:
                step.summary = summary
            if status == "running":
                step.started_at, step.finished_at = utcnow(), None
            elif status in ("completed", "failed", "stopped"):
                step.finished_at = utcnow()
            run = db.get(PipelineRun, self.run_id)
            run.iteration = iteration
            if status == "running":
                run.current_agent, run.progress = agent, 0

    # ---- execution -----------------------------------------------------------
    def execute(self, mode: str = "full") -> None:
        current = "planner"
        try:
            if mode == "full":
                self._full()
            elif mode == "tests":
                current = "tester"
                self._run_tester(self.plan, self._iteration(), write=False)
                self._finish_partial()
            elif mode == "security":
                current = "security"
                self._run_security(self._iteration())
                self._finish_partial()
        except PipelineCancelled:
            self._log("orchestrator", "WARN", "Execution stopped by user")
            self._finalize("stopped")
        except MessageRejected as exc:
            self._log("orchestrator", "ERROR", f"Secure bus rejected message: {exc}")
            self._finalize("failed")
        except Exception as exc:
            self._log("orchestrator", "ERROR", f"{type(exc).__name__}: {exc}")
            self._log("orchestrator", "ERROR", traceback.format_exc()[-1500:])
            with session_scope() as db:
                run = db.get(PipelineRun, self.run_id)
                current = run.current_agent or current
            self._step(current, self._iteration(), "failed")
            self._finalize("failed")
        finally:
            _cancel_flags.pop(self.run_id, None)

    def _iteration(self) -> int:
        with session_scope() as db:
            return db.get(PipelineRun, self.run_id).iteration

    def _full(self) -> None:
        max_iter = max(1, int(self.settings["general"].get("max_feedback_iterations", 3)))
        auto_fix = self.settings["agents"].get("auto_fix_vulnerabilities", True)

        self._log("orchestrator", "INFO", f"Pipeline started for '{self.project_name}'")
        requirements = self.requirements
        if self.settings["security"].get("prompt_injection_guard", True):
            check = inspect_text(requirements)
            if not check.safe:
                self._log("orchestrator", "WARN", f"Prompt-injection guard removed suspicious content: {', '.join(check.detections)}")
                add_activity("warning", f"Injection attempt blocked in '{self.project_name}' requirements", self.project_id)
                requirements = check.sanitized

        # Planner
        self._step("planner", 1, "running")
        self.bus.send("orchestrator", "planner", "requirements", {"project": self.project_name, "requirements": requirements})
        spec = PlannerAgent(self.ctx).run(requirements)
        with session_scope() as db:
            db.get(PipelineRun, self.run_id).plan = spec
        self._step("planner", 1, "completed", f"Created task plan with {len(spec['tasks'])} tasks")
        self.bus.send("planner", "developer", "task_plan", {"spec": {k: v for k, v in spec.items() if k != "tasks"}, "tasks": spec["tasks"]})

        feedback = None
        for iteration in range(1, max_iter + 1):
            self.ctx.extras.clear()
            self._step("developer", iteration, "running")
            dev = DeveloperAgent(self.ctx).run(spec, iteration, feedback)
            self._step("developer", iteration, "completed", f"Generated {len(dev['files'])} files ({dev['lines']} lines)")
            add_activity("code", f"Code generated for {self.project_name}" + (f" (fix iteration {iteration})" if feedback else ""), self.project_id)
            self.bus.send("developer", "tester", "code_ready", {"files": dev["files"], "commit": dev["commit"] or "", "iteration": iteration})

            tests = self._run_tester(spec, iteration, write=True)
            self.bus.send("tester", "security", "test_report", {"passed": tests["passed"], "failed": tests["failed"], "coverage": tests["coverage"]})

            scan = self._run_security(iteration)
            loop_findings = [f for f in scan["findings"] if f["severity"] in LOOP_SEVERITIES]
            self.bus.send("security", "orchestrator", "scan_report", {
                "counts": scan["counts"],
                "findings": [{k: f[k] for k in ("severity", "tool", "issue", "file", "line", "cwe", "snippet")} for f in loop_findings[:50]],
            })

            failed_tests = [c["name"] for c in tests["cases"] if c["status"] == "failed"]
            if (loop_findings or failed_tests or tests["collection_error"]) and auto_fix and iteration < max_iter:
                self._log("orchestrator", "WARN", f"Issues detected → feedback loop to Developer Agent ({len(loop_findings)} findings, {len(failed_tests)} failed tests)")
                feedback = {
                    "findings": [{k: f[k] for k in ("severity", "issue", "file", "line", "cwe", "snippet", "detail")} for f in loop_findings[:30]],
                    "failed_tests": failed_tests,
                }
                self.bus.send("orchestrator", "developer", "fix_request", feedback)
                continue
            break

        self._finalize_full(spec)

    def _run_tester(self, spec: dict, iteration: int, write: bool) -> dict:
        self._step("tester", iteration, "running")
        result = TesterAgent(self.ctx).run(spec, write=write)
        with session_scope() as db:
            db.query(TestCase).filter_by(run_id=self.run_id).delete()
            for c in result["cases"]:
                db.add(TestCase(run_id=self.run_id, **c))
            run = db.get(PipelineRun, self.run_id)
            run.coverage = result["coverage"]
            run.coverage_detail = {"files": result["coverage_files"]}
            run.test_output = result["output"]
        status = "completed" if not result["collection_error"] else "failed"
        self._step("tester", iteration, status, f"{result['passed']}/{result['total']} tests passed, coverage {result['coverage']}%")
        add_activity("success" if result["failed"] == 0 and result["total"] else "error",
                     f"Test execution completed: {result['passed']}/{result['total']} passed ({self.project_name})", self.project_id)
        return result

    def _run_security(self, iteration: int) -> dict:
        self._step("security", iteration, "running")
        result = SecurityAgent(self.ctx).run()
        with session_scope() as db:
            open_rows: dict[tuple, list[Finding]] = {}
            for row in db.query(Finding).filter_by(run_id=self.run_id, status="open").order_by(Finding.line):
                open_rows.setdefault((row.file, row.issue), []).append(row)
            for f in result["findings"]:
                bucket = open_rows.get((f["file"], f["issue"]))
                if bucket:
                    row = bucket.pop(0)
                    row.line, row.snippet, row.severity = f["line"], f["snippet"], f["severity"]
                else:
                    db.add(Finding(run_id=self.run_id, iteration=iteration, **f))
            for bucket in open_rows.values():
                for row in bucket:
                    row.status = "fixed"
        c = result["counts"]
        self._step("security", iteration, "completed", f"{len(result['findings'])} findings (C{c['Critical']} H{c['High']} M{c['Medium']} L{c['Low']})")
        if result["findings"]:
            add_activity("warning", f"Security scan found {len(result['findings'])} issues in {self.project_name}", self.project_id)
        else:
            add_activity("success", f"Security scan passed for {self.project_name}", self.project_id)
        if c["Critical"] and self.settings["integrations"].get("chatops_alerts") and self.settings["integrations"].get("webhook_url"):
            self._send_alert(c)
        return result

    def _send_alert(self, counts: dict) -> None:
        try:
            httpx.post(self.settings["integrations"]["webhook_url"], json={
                "text": f"[AI DevSecure] {counts['Critical']} critical finding(s) in {self.project_name}", "project_id": self.project_id,
            }, timeout=5)
            self._log("security", "INFO", "ChatOps alert dispatched")
        except httpx.HTTPError as exc:
            self._log("security", "WARN", f"ChatOps alert failed: {exc}")

    def _evaluate_gate(self) -> dict:
        sec = self.settings["security"]
        reasons = []
        with session_scope() as db:
            run = db.get(PipelineRun, self.run_id)
            open_findings = db.query(Finding).filter_by(run_id=self.run_id, status="open").all()
            tests = db.query(TestCase).filter_by(run_id=self.run_id).all()
            coverage = run.coverage
        blocking = [f for f in open_findings if f.severity in ("Critical", "High")]
        if sec.get("block_on_critical_high", True) and blocking:
            reasons.append(f"{len(blocking)} open Critical/High vulnerabilities")
        failed = [t for t in tests if t.status == "failed"]
        if failed or not tests:
            reasons.append(f"{len(failed)} failing tests" if tests else "no tests executed")
        min_cov = float(sec.get("min_test_coverage", 0) or 0)
        if coverage < min_cov:
            reasons.append(f"coverage {coverage}% below required {min_cov:g}%")
        return {"passed": not reasons, "reasons": reasons, "min_coverage": min_cov}

    def _finalize_full(self, spec: dict) -> None:
        from ..services.reports import generate_pipeline_reports

        gate = self._evaluate_gate()
        if gate["passed"]:
            self._log("orchestrator", "INFO", "Policy gate PASSED - artifacts approved for release")
        else:
            self._log("orchestrator", "WARN", "Policy gate BLOCKED release: " + "; ".join(gate["reasons"]))
        with session_scope() as db:
            db.get(PipelineRun, self.run_id).gate = gate
        self._log("orchestrator", "INFO", "No blocking issues → report generation" if gate["passed"] else "Generating reports")
        try:
            generate_pipeline_reports(self.run_id)
            self._log("orchestrator", "INFO", "Security audit and test coverage reports generated")
        except Exception as exc:  # report failure must not fail the pipeline
            self._log("orchestrator", "WARN", f"Report generation failed: {exc}")
        self._finalize("completed" if gate["passed"] else "failed")

    def _finish_partial(self) -> None:
        gate = self._evaluate_gate()
        with session_scope() as db:
            db.get(PipelineRun, self.run_id).gate = gate
        self._finalize("completed" if gate["passed"] else "failed")

    def _finalize(self, status: str) -> None:
        with session_scope() as db:
            run = db.get(PipelineRun, self.run_id)
            run.status = status
            run.finished_at = utcnow()
            run.current_agent = ""
            if status == "stopped":
                for step in db.query(AgentStep).filter_by(run_id=self.run_id, status="running"):
                    step.status = "stopped"
            project = db.get(Project, self.project_id)
            project.status = {"completed": "completed", "stopped": "stopped"}.get(status, "failed")
        kind = {"completed": "success", "stopped": "info"}.get(status, "error")
        add_activity(kind, f"Pipeline {status} for {self.project_name}", self.project_id)
        self._log("orchestrator", "INFO", f"Pipeline finished with status: {status.upper()}")

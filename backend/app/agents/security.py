"""Security Agent: static analysis (Bandit, Semgrep, AST rules), secret scanning and CVE matching."""

import json
import shutil
from pathlib import Path

from ..security.sandbox import python_executable, run_sandboxed
from . import rules
from .base import BaseAgent

SEVERITY_ORDER = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3}
TOOL_PRIORITY = {"Bandit": 0, "Semgrep": 1, "DevSecure AST": 2, "Secret Scanner": 3, "Dependency Scan": 4}

BANDIT_MAP = {
    "B608": ("Critical", "Possible SQL injection risk", rules.A03),
    "B307": ("High", "Insecure use of eval()", rules.A03),
    "B102": ("High", "Insecure use of exec()", rules.A03),
    "B602": ("High", "Using subprocess with shell=True", rules.A03),
    "B605": ("High", "Starting a process with a shell", rules.A03),
    "B105": ("Medium", "Hardcoded secret key", rules.A07),
    "B106": ("Medium", "Hardcoded password argument", rules.A07),
    "B107": ("Medium", "Hardcoded password default", rules.A07),
    "B301": ("High", "Unsafe pickle deserialization", rules.A08),
    "B506": ("High", "yaml.load without SafeLoader", rules.A08),
    "B104": ("Medium", "Binding to all interfaces", rules.A05),
    "B404": ("Low", "subprocess module imported", rules.A03),
    "B603": ("Low", "subprocess call - validate untrusted input", rules.A03),
    "B607": ("Low", "Process started with a partial executable path", rules.A03),
    "B201": ("High", "Flask app run with debug=True", rules.A05),
    "B324": ("Medium", "Weak hash algorithm", rules.A02),
    "B501": ("Medium", "TLS certificate verification disabled", rules.A02),
}
BANDIT_SEV = {"HIGH": "High", "MEDIUM": "Medium", "LOW": "Low"}
SEMGREP_SEV = {"ERROR": "High", "WARNING": "Medium", "INFO": "Low"}
SEMGREP_RULES = Path(__file__).with_name("semgrep_rules.yml")
CWE_FAMILY = {"CWE-259": "secret", "CWE-798": "secret", "CWE-78": "cmd", "CWE-89": "sqli", "CWE-95": "eval", "CWE-94": "eval"}


def semgrep_available() -> bool:
    return shutil.which("semgrep") is not None


class SecurityAgent(BaseAgent):
    name = "security"
    title = "Security Agent"

    def run(self) -> dict:
        cfg = self.ctx.settings["security"]
        ws = self.ctx.workspace
        app_dir = ws / "app"
        findings: list[dict] = []
        tools_run: list[str] = []
        logs: list[str] = []

        def note(msg: str, level: str = "INFO"):
            logs.append(f"[{level}] {msg}")
            self.log(msg, level)

        if cfg.get("bandit_enabled", True):
            note("Running Bandit static analysis on app/")
            res = run_sandboxed([python_executable(), "-m", "bandit", "-r", "app", "-f", "json", "-q"], cwd=ws, timeout=120)
            try:
                data = json.loads(res.stdout or "{}")
                for r in data.get("results", []):
                    sev, issue, owasp = BANDIT_MAP.get(r["test_id"], (BANDIT_SEV.get(r["issue_severity"], "Low"), r["issue_text"], ""))
                    findings.append({
                        "tool": "Bandit", "rule_id": r["test_id"], "severity": sev, "issue": issue,
                        "file": str(Path(r["filename"]).as_posix()).removeprefix("./"), "line": r["line_number"],
                        "cwe": f"CWE-{r.get('issue_cwe', {}).get('id', '')}" if r.get("issue_cwe") else "",
                        "owasp": owasp, "snippet": (r.get("code") or "").strip()[:400], "detail": r["issue_text"], "category": "code",
                    })
                tools_run.append("Bandit")
                note(f"Bandit: {len(data.get('results', []))} issues")
            except json.JSONDecodeError:
                note("Bandit output could not be parsed: " + (res.stderr or "")[-300:], "WARN")
        self.progress(30)
        self.checkpoint()

        if cfg.get("semgrep_enabled", True):
            if semgrep_available():
                note("Running Semgrep SAST with DevSecure ruleset")
                res = run_sandboxed(["semgrep", "--config", str(SEMGREP_RULES), "--json", "--metrics=off", "--quiet", "app"], cwd=ws, timeout=180)
                try:
                    data = json.loads(res.stdout or "{}")
                    for r in data.get("results", []):
                        meta = r.get("extra", {}).get("metadata", {})
                        findings.append({
                            "tool": "Semgrep", "rule_id": r["check_id"].split(".")[-1], "severity": SEMGREP_SEV.get(r["extra"].get("severity"), "Medium"),
                            "issue": r["extra"].get("message", ""), "file": r["path"], "line": r["start"]["line"],
                            "cwe": meta.get("cwe", ""), "owasp": meta.get("owasp", ""), "snippet": r["extra"].get("lines", "").strip()[:400],
                            "detail": "", "category": "code",
                        })
                    tools_run.append("Semgrep")
                    note(f"Semgrep: {len(data.get('results', []))} issues")
                except json.JSONDecodeError:
                    note("Semgrep output could not be parsed", "WARN")
            else:
                note("Semgrep not installed - built-in AST rule engine covers the same rules", "WARN")
        self.progress(50)

        note("Running DevSecure AST rule engine (injection, deserialization, crypto, validation)")
        for py in sorted(app_dir.rglob("*.py")) if app_dir.exists() else []:
            findings.extend(rules.scan_python_ast(py, py.relative_to(ws).as_posix()))
        tools_run.append("DevSecure AST")
        self.progress(65)
        self.checkpoint()

        if cfg.get("secrets_scan_enabled", True):
            note("Scanning for committed secrets (TruffleHog-style patterns + entropy)")
            for p in sorted(ws.rglob("*")):
                rel = p.relative_to(ws).as_posix()
                if p.is_file() and not rel.startswith((".git/", ".devsecure/", "tests/")) and p.suffix in {".py", ".txt", ".md", ".json", ".yml", ".yaml", ".env", ".cfg", ".ini", ".toml"}:
                    findings.extend(rules.scan_secrets(p, rel))
            tools_run.append("Secret Scanner")
        self.progress(80)

        if cfg.get("dependency_scan_enabled", True):
            note("Matching pinned dependencies against CVE advisory database")
            deps = rules.scan_dependencies(ws / "requirements.txt", "requirements.txt")
            findings.extend(deps)
            tools_run.append("Dependency Scan")
            note(f"Dependency scan: {len(deps)} vulnerable packages")

        findings = self._dedupe(findings)
        counts = {s: sum(f["severity"] == s for f in findings) for s in SEVERITY_ORDER}
        for f in findings:
            note(f"[{f['severity']}] {f['tool']}: {f['issue']} ({f['file']}:{f['line']})", "WARN" if f["severity"] in ("Critical", "High") else "INFO")
        note(f"Scan complete: {len(findings)} findings (Critical {counts['Critical']}, High {counts['High']}, Medium {counts['Medium']}, Low {counts['Low']})")
        self.progress(100)
        return {"findings": findings, "counts": counts, "tools": tools_run, "log": "\n".join(logs)}

    @staticmethod
    def _dedupe(findings: list[dict]) -> list[dict]:
        findings.sort(key=lambda f: (TOOL_PRIORITY.get(f["tool"], 9), SEVERITY_ORDER.get(f["severity"], 9)))
        seen: set[tuple] = set()
        out = []
        for f in findings:
            key = (f["file"], f["line"], CWE_FAMILY.get(f["cwe"], f["cwe"] or f["issue"]))
            alt = (f["file"], f["line"], f["issue"])
            if key in seen or alt in seen:
                continue
            seen.update({key, alt})
            out.append(f)
        out.sort(key=lambda f: (SEVERITY_ORDER.get(f["severity"], 9), f["file"], f["line"]))
        return out

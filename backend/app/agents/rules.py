"""Built-in AST rule engine, secret scanner and dependency/CVE matcher used by the Security Agent."""

import ast
import math
import re
from pathlib import Path

A01, A02, A03, A05, A06, A07, A08 = (
    "A01 Broken Access Control", "A02 Cryptographic Failures", "A03 Injection",
    "A05 Security Misconfiguration", "A06 Vulnerable Components", "A07 Auth Failures",
    "A08 Integrity Failures",
)

SQL_RE = re.compile(r"\b(select|insert|update|delete)\b.+\b(from|into|set|where)\b", re.I)
SECRET_NAME_RE = re.compile(r"(secret|passw(or)?d|pwd|token|api_?key|private_?key)", re.I)


def _finding(rule_id, severity, issue, file, line, cwe, owasp, snippet="", detail=""):
    return {"tool": "DevSecure AST", "rule_id": rule_id, "severity": severity, "issue": issue, "file": file,
            "line": line, "cwe": cwe, "owasp": owasp, "snippet": snippet, "detail": detail, "category": "code"}


def _call_name(node: ast.Call) -> str:
    f = node.func
    parts = []
    while isinstance(f, ast.Attribute):
        parts.append(f.attr)
        f = f.value
    if isinstance(f, ast.Name):
        parts.append(f.id)
    return ".".join(reversed(parts))


def _kw(node: ast.Call, name: str):
    for kw in node.keywords:
        if kw.arg == name:
            return kw.value
    return None


def _is_dynamic_sql(node: ast.AST) -> bool:
    if isinstance(node, ast.JoinedStr):
        text = "".join(v.value for v in node.values if isinstance(v, ast.Constant) and isinstance(v.value, str))
        return bool(SQL_RE.search(text)) and any(isinstance(v, ast.FormattedValue) for v in node.values)
    if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Mod)):
        consts = [n.value for n in ast.walk(node) if isinstance(n, ast.Constant) and isinstance(n.value, str)]
        return bool(SQL_RE.search(" ".join(consts))) and any(isinstance(n, ast.Name) for n in ast.walk(node))
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "format":
        base = node.func.value
        return isinstance(base, ast.Constant) and isinstance(base.value, str) and bool(SQL_RE.search(base.value))
    return False


def scan_python_ast(path: Path, rel: str) -> list[dict]:
    source = path.read_text(errors="replace")
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        return [_finding("DS000", "Medium", "Syntax error prevents analysis", rel, exc.lineno or 0, "CWE-710", A05)]
    lines = source.splitlines()
    out: list[dict] = []

    def snip(n: int) -> str:
        return lines[n - 1].strip() if 0 < n <= len(lines) else ""

    def suppressed(n: int, end: int | None = None) -> bool:
        return any("nosec" in snip(i) for i in range(n, (end or n) + 1))

    sql_vars: dict[str, int] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            if _is_dynamic_sql(node.value):
                sql_vars[node.targets[0].id] = node.lineno

    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            name = _call_name(node)
            ln = node.lineno
            if suppressed(ln, node.end_lineno):
                continue
            if name in ("eval", "exec"):
                out.append(_finding("DS001", "High", f"Insecure use of {name}()", rel, ln, "CWE-95", A03, snip(ln),
                                    "Dynamic code execution on untrusted input allows arbitrary code execution."))
            elif name.startswith("subprocess.") and isinstance(_kw(node, "shell"), ast.Constant) and _kw(node, "shell").value is True:
                out.append(_finding("DS002", "High", "Using subprocess with shell=True", rel, ln, "CWE-78", A03, snip(ln),
                                    "Shell interpretation of interpolated input enables OS command injection."))
            elif name in ("os.system", "os.popen"):
                out.append(_finding("DS003", "High", f"OS command execution via {name}", rel, ln, "CWE-78", A03, snip(ln)))
            elif name.endswith(("execute", "executemany", "executescript")) and node.args:
                arg = node.args[0]
                dynamic = _is_dynamic_sql(arg) or (isinstance(arg, ast.Name) and arg.id in sql_vars)
                if isinstance(arg, ast.Name) and arg.id in sql_vars:
                    ln = sql_vars[arg.id]
                if dynamic and not suppressed(ln):
                    out.append(_finding("DS004", "Critical", "Possible SQL injection risk", rel, ln, "CWE-89", A03, snip(ln),
                                        "SQL statement built from string formatting; use parameterized queries."))
            elif name in ("pickle.loads", "pickle.load", "marshal.loads"):
                out.append(_finding("DS006", "High", "Unsafe deserialization", rel, ln, "CWE-502", A08, snip(ln)))
            elif name == "yaml.load" and _kw(node, "Loader") is None:
                out.append(_finding("DS007", "High", "yaml.load without SafeLoader", rel, ln, "CWE-502", A08, snip(ln)))
            elif name in ("hashlib.md5", "hashlib.sha1"):
                out.append(_finding("DS008", "Medium", f"Weak hash algorithm ({name.split('.')[-1]})", rel, ln, "CWE-327", A02, snip(ln)))
            elif name.startswith("requests.") and isinstance(_kw(node, "verify"), ast.Constant) and _kw(node, "verify").value is False:
                out.append(_finding("DS009", "Medium", "TLS certificate verification disabled", rel, ln, "CWE-295", A02, snip(ln)))

        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            value = node.value
            ln = node.lineno
            if suppressed(ln) or value is None:
                continue
            for t in targets:
                tname = t.id if isinstance(t, ast.Name) else (t.attr if isinstance(t, ast.Attribute) else "")
                if SECRET_NAME_RE.search(tname) and isinstance(value, ast.Constant) and isinstance(value.value, str) and len(value.value) >= 6:
                    out.append(_finding("DS005", "Medium", "Hardcoded secret key", rel, ln, "CWE-798", A07, snip(ln),
                                        "Credentials must come from environment variables or a secret manager."))
                if tname.upper() == "DEBUG" and isinstance(value, ast.Constant) and value.value is True:
                    out.append(_finding("DS010", "Low", "Debug mode enabled", rel, ln, "CWE-489", A05, snip(ln)))

        elif isinstance(node, ast.ClassDef):
            if not any(isinstance(b, ast.Name) and b.id == "BaseModel" for b in node.bases):
                continue
            for stmt in node.body:
                if (isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name) and stmt.value is None
                        and isinstance(stmt.annotation, ast.Name) and stmt.annotation.id == "str"):
                    fname = stmt.target.id
                    if "email" in fname or "url" in fname or "phone" in fname:
                        out.append(_finding("DS011", "Medium", "Missing input validation", rel, stmt.lineno, "CWE-20", A03,
                                            snip(stmt.lineno), f"Field '{fname}' accepts arbitrary strings; add format validation."))
    return out


SECRET_PATTERNS = [
    ("SEC001", "Critical", "AWS access key", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("SEC002", "Critical", "GitHub token", re.compile(r"gh[pousr]_[A-Za-z0-9]{36,}")),
    ("SEC003", "Critical", "Private key material", re.compile(r"-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----")),
    ("SEC004", "High", "Slack token", re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}")),
    ("SEC005", "High", "OpenAI API key", re.compile(r"sk-[A-Za-z0-9_-]{32,}")),
]
GENERIC_SECRET = re.compile(r"""(?i)(secret|passw(or)?d|token|api_?key)[\w]*\s*[:=]\s*["']([^"'\s]{8,})["']""")


def _entropy(s: str) -> float:
    if not s:
        return 0.0
    counts = {c: s.count(c) for c in set(s)}
    return -sum(n / len(s) * math.log2(n / len(s)) for n in counts.values())


def scan_secrets(path: Path, rel: str) -> list[dict]:
    out = []
    for i, line in enumerate(path.read_text(errors="replace").splitlines(), start=1):
        for rid, sev, label, pat in SECRET_PATTERNS:
            if pat.search(line):
                out.append({"tool": "Secret Scanner", "rule_id": rid, "severity": sev, "issue": f"{label} committed to source",
                            "file": rel, "line": i, "cwe": "CWE-798", "owasp": A07, "snippet": line.strip()[:200], "detail": "", "category": "secret"})
        m = GENERIC_SECRET.search(line)
        if m and "nosec" not in line and _entropy(m.group(3)) >= 3.0:
            out.append({"tool": "Secret Scanner", "rule_id": "SEC100", "severity": "High", "issue": "High-entropy credential in source",
                        "file": rel, "line": i, "cwe": "CWE-798", "owasp": A07, "snippet": line.strip()[:200], "detail": "", "category": "secret"})
    return out


# Small offline advisory database (subset of real CVEs) for dependency pattern matching.
ADVISORIES = [
    ("fastapi", "0.109.1", "CVE-2024-24762", "High", "ReDoS in multipart form Content-Type parsing"),
    ("starlette", "0.40.0", "CVE-2024-47874", "High", "Unbounded multipart form fields allow DoS"),
    ("requests", "2.31.0", "CVE-2023-32681", "Medium", "Proxy-Authorization header leaked on redirect"),
    ("jinja2", "3.1.3", "CVE-2024-22195", "Medium", "XSS via xmlattr filter"),
    ("jinja2", "3.1.4", "CVE-2024-34064", "Medium", "XSS via xmlattr filter keys"),
    ("urllib3", "1.26.18", "CVE-2023-45803", "Medium", "Request body not stripped on 303 redirect"),
    ("pyyaml", "5.4", "CVE-2020-14343", "Critical", "Arbitrary code execution via full_load"),
    ("flask", "2.2.5", "CVE-2023-30861", "High", "Session cookie disclosure via caching proxy"),
    ("werkzeug", "3.0.1", "CVE-2023-46136", "High", "DoS via crafted multipart data"),
    ("pillow", "10.0.1", "CVE-2023-4863", "High", "Heap buffer overflow in libwebp"),
    ("pydantic", "1.8.2", "CVE-2021-29510", "Medium", "Infinite loop parsing 'infinity' datetime"),
    ("cryptography", "41.0.2", "CVE-2023-38325", "Medium", "SSH certificate mishandling"),
    ("sqlalchemy", "1.2.18", "CVE-2019-7164", "Critical", "SQL injection via order_by"),
    ("django", "4.2.8", "CVE-2023-46695", "High", "DoS in UsernameField normalization"),
]


def _ver(v: str) -> tuple:
    return tuple(int(p) if p.isdigit() else 0 for p in re.split(r"[.\-+]", v)[:4])


def scan_dependencies(req_path: Path, rel: str) -> list[dict]:
    out = []
    if not req_path.exists():
        return out
    for i, raw in enumerate(req_path.read_text().splitlines(), start=1):
        line = raw.split("#")[0].strip()
        m = re.match(r"^([A-Za-z0-9_.\-]+)(?:\[.*\])?\s*==\s*([0-9][\w.\-+]*)$", line)
        if not m:
            continue
        pkg, ver = m.group(1).lower(), m.group(2)
        for name, fixed, cve, sev, summary in ADVISORIES:
            if pkg == name and _ver(ver) < _ver(fixed):
                out.append({"tool": "Dependency Scan", "rule_id": cve, "severity": sev, "issue": f"{pkg} {ver}: {summary}",
                            "file": rel, "line": i, "cwe": "CWE-1104", "owasp": A06, "snippet": raw.strip(),
                            "detail": f"Upgrade {pkg} to >= {fixed} ({cve}).", "category": "dependency"})
    return out

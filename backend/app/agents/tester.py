"""Tester Agent: writes pytest suites from the spec and executes them in the sandbox."""

import json
import xml.etree.ElementTree as ET  # nosec B405 - parses junit XML produced by our own pytest run
from pathlib import Path

from ..security.sandbox import python_executable, run_sandboxed
from .base import BaseAgent

SAMPLE = {"text": '"Sample {label} {i}"', "email": '"user{i}@example.com"', "int": "{n}", "float": "{f}", "date": '"2026-01-{d:02d}"', "bool": "True"}


def _payload_fn(spec: dict) -> str:
    entries = []
    for idx, f in enumerate(spec["fields"]):
        tmpl = SAMPLE[f["kind"]]
        label = f["label"].replace('"', "")
        if f["kind"] == "text":
            expr = f'f"Sample {label} {{i}}"'
        elif f["kind"] == "email":
            expr = 'f"user{i}@example.com"'
        elif f["kind"] == "int":
            expr = f"{idx + 3} + i"
        elif f["kind"] == "float":
            expr = f"{idx + 9}.5 + i"
        elif f["kind"] == "date":
            expr = 'f"2026-01-{(i % 27) + 1:02d}"'
        else:
            expr = tmpl
        entries.append(f'        "{f["name"]}": {expr},')
    return "def make_payload(i: int = 1) -> dict:\n    return {\n" + "\n".join(entries) + "\n    }\n"


def generate_tests(spec: dict) -> dict[str, str]:
    e, plural, fields, unique = spec["entity"], spec["entity_plural"], spec["fields"], spec["unique"]
    first = fields[0]["name"]
    text_fields = [f for f in fields if f["kind"] == "text"]
    email_fields = [f for f in fields if f["kind"] == "email"]
    num_fields = [f for f in fields if f["kind"] in ("int", "float")]

    tests: list[str] = []
    tests.append(f'''def test_create_{e}_valid():
    resp = client.post("/{plural}", json=make_payload(1))
    assert resp.status_code == 201
    body = resp.json()
    assert body["id"] > 0
    assert body["{first}"] == make_payload(1)["{first}"]
''')
    for u in unique:
        tests.append(f'''def test_duplicate_{u}():
    client.post("/{plural}", json=make_payload(1))
    duplicate = make_payload(2)
    duplicate["{u}"] = make_payload(1)["{u}"]
    resp = client.post("/{plural}", json=duplicate)
    assert resp.status_code == 409
''')
    for f in email_fields[:1]:
        tests.append(f'''def test_invalid_{f["name"]}():
    payload = make_payload(1)
    payload["{f["name"]}"] = "not-an-email"
    resp = client.post("/{plural}", json=payload)
    assert resp.status_code == 422
''')
    tests.append(f'''def test_missing_required_field():
    payload = make_payload(1)
    payload.pop("{first}")
    resp = client.post("/{plural}", json=payload)
    assert resp.status_code == 422
''')
    if text_fields:
        tf = text_fields[0]["name"]
        tests.append(f'''def test_blank_{tf}_rejected():
    payload = make_payload(1)
    payload["{tf}"] = "   "
    resp = client.post("/{plural}", json=payload)
    assert resp.status_code == 422
''')
    if num_fields:
        nf = num_fields[0]["name"]
        tests.append(f'''def test_negative_{nf}_rejected():
    payload = make_payload(1)
    payload["{nf}"] = -1
    resp = client.post("/{plural}", json=payload)
    assert resp.status_code == 422
''')
    tests.append(f'''def test_get_{e}_by_id():
    created = client.post("/{plural}", json=make_payload(1)).json()
    resp = client.get(f"/{plural}/{{created['id']}}")
    assert resp.status_code == 200
    assert resp.json() == created
''')
    tests.append(f'''def test_get_{e}_not_found():
    resp = client.get("/{plural}/99999")
    assert resp.status_code == 404
''')
    tests.append(f'''def test_get_all_{plural}():
    for i in range(1, 4):
        client.post("/{plural}", json=make_payload(i))
    resp = client.get("/{plural}")
    assert resp.status_code == 200
    assert len(resp.json()) == 3
''')
    upd_field = text_fields[0]["name"] if text_fields else None
    if upd_field:
        tests.append(f'''def test_update_{e}():
    created = client.post("/{plural}", json=make_payload(1)).json()
    resp = client.put(f"/{plural}/{{created['id']}}", json={{"{upd_field}": "Updated value"}})
    assert resp.status_code == 200
    assert resp.json()["{upd_field}"] == "Updated value"
''')
    tests.append(f'''def test_delete_{e}():
    created = client.post("/{plural}", json=make_payload(1)).json()
    assert client.delete(f"/{plural}/{{created['id']}}").status_code == 204
    assert client.get(f"/{plural}/{{created['id']}}").status_code == 404
''')
    for u in unique[:1]:
        tests.append(f'''def test_get_{e}_by_{u}():
    created = client.post("/{plural}", json=make_payload(1)).json()
    resp = client.get(f"/{plural}/by-{u.replace("_", "-")}/{{created['{u}']}}")
    assert resp.status_code == 200
    assert resp.json()["id"] == created["id"]
''')
    tests.append('''def test_health_check():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
''')

    test_api = (
        "from fastapi.testclient import TestClient\n\nfrom app.main import app\n\nclient = TestClient(app)\n\n\n"
        + _payload_fn(spec) + "\n\n" + "\n\n".join(tests)
    )
    conftest = '''import os
import sys

import pytest

os.environ.setdefault("APP_DATABASE", ":memory:")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture(autouse=True)
def clean_database():
    from app import database

    if hasattr(database, "reset_db"):
        database.reset_db()
    yield
'''
    return {"tests/__init__.py": "", "tests/conftest.py": conftest, "tests/test_api.py": test_api}


def parse_junit(path: Path) -> list[dict]:
    if not path.exists():
        return []
    root = ET.parse(path).getroot()  # nosec B314
    cases = []
    for tc in root.iter("testcase"):
        status, message = "passed", ""
        for tag in ("failure", "error"):
            node = tc.find(tag)
            if node is not None:
                status = "failed"
                message = (node.get("message") or "") + "\n" + (node.text or "")
        if tc.find("skipped") is not None:
            status = "skipped"
        cases.append({
            "name": tc.get("name", ""),
            "file": (tc.get("classname", "").replace(".", "/") + ".py"),
            "status": status,
            "duration": round(float(tc.get("time") or 0), 3),
            "message": message.strip()[:4000],
        })
    return cases


class TesterAgent(BaseAgent):
    name = "tester"
    title = "Tester Agent"

    def run(self, spec: dict, write: bool = True) -> dict:
        ws = self.ctx.workspace
        if write:
            self.log("Generating unit and integration tests from specification")
            for rel, content in generate_tests(spec).items():
                path = ws / rel
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content)
                self.log(f"Writing {rel}")
        self.progress(25)
        self.checkpoint()

        out_dir = ws / ".devsecure"
        out_dir.mkdir(exist_ok=True)
        for stale in ("junit.xml", "coverage.json"):
            (out_dir / stale).unlink(missing_ok=True)

        self.log("Running pytest in isolated sandbox (scrubbed env, CPU/file limits, timeout)")
        res = run_sandboxed(
            [python_executable(), "-m", "pytest", "tests", "-q", "-p", "no:cacheprovider",
             "--junitxml=.devsecure/junit.xml", "--cov=app", "--cov-report=json:.devsecure/coverage.json"],
            cwd=ws, timeout=180, extra_env={"PYTHONPATH": str(ws), "APP_DATABASE": ":memory:"},
        )
        self.progress(80)
        cases = parse_junit(out_dir / "junit.xml")
        coverage, cov_files = 0.0, []
        cov_path = out_dir / "coverage.json"
        if cov_path.exists():
            data = json.loads(cov_path.read_text())
            coverage = round(data.get("totals", {}).get("percent_covered", 0.0), 1)
            for fname, info in sorted(data.get("files", {}).items()):
                s = info.get("summary", {})
                cov_files.append({"file": fname, "statements": s.get("num_statements", 0), "missing": s.get("missing_lines", 0), "percent": round(s.get("percent_covered", 0.0), 1)})

        passed = sum(c["status"] == "passed" for c in cases)
        failed = sum(c["status"] == "failed" for c in cases)
        for c in cases:
            self.log(f"{c['name']} ... {c['status'].upper()} ({c['duration']}s)", "INFO" if c["status"] == "passed" else "ERROR")
        if not cases:
            self.log("Test collection failed - see execution log", "ERROR")
        self.log(f"Tests: {passed} passed, {failed} failed; coverage {coverage}%")
        self.progress(100)
        output = (res.stdout + "\n" + res.stderr).strip()
        return {
            "cases": cases, "passed": passed, "failed": failed, "total": len(cases),
            "coverage": coverage, "coverage_files": cov_files, "output": output[-20000:],
            "collection_error": not cases,
        }

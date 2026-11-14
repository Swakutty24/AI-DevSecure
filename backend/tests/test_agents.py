from app.agents import rules
from app.agents.planner import heuristic_spec
from app.agents.templates import generate_project

STUDENT_REQ = """Create a REST API to register students with the following fields:
- Student name
- Register number
- Email
Validate inputs and prevent duplicate register numbers."""


def test_planner_extracts_spec():
    spec = heuristic_spec("Student Registration API", STUDENT_REQ)
    assert spec["entity"] == "student"
    assert spec["entity_plural"] == "students"
    assert [f["name"] for f in spec["fields"]] == ["name", "register_number", "email"]
    assert spec["fields"][2]["kind"] == "email"
    assert spec["unique"] == ["register_number"]


def test_planner_inline_fields_and_types():
    spec = heuristic_spec("Hostel", "Create an API to manage hostel rooms with fields: room number, capacity, monthly fee. Prevent duplicate room numbers.")
    kinds = {f["name"]: f["kind"] for f in spec["fields"]}
    assert spec["entity"] == "room"
    assert kinds == {"room_number": "text", "capacity": "int", "monthly_fee": "float"}
    assert spec["unique"] == ["room_number"]


def _scan(tmp_path, files):
    out = []
    for rel, content in files.items():
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
        if rel.endswith(".py"):
            out += rules.scan_python_ast(p, rel)
    return out


def test_ast_rules_flag_seeded_draft(tmp_path):
    spec = heuristic_spec("Student Registration API", STUDENT_REQ)
    findings = _scan(tmp_path, generate_project(spec, secure=False))
    issues = {f["issue"] for f in findings}
    assert {"Possible SQL injection risk", "Insecure use of eval()", "Using subprocess with shell=True",
            "Hardcoded secret key", "Missing input validation"} <= issues


def test_ast_rules_clean_on_secure_code(tmp_path):
    spec = heuristic_spec("Student Registration API", STUDENT_REQ)
    findings = _scan(tmp_path, generate_project(spec, secure=True))
    assert [f for f in findings if f["severity"] in ("Critical", "High", "Medium")] == []


def test_dependency_scan(tmp_path):
    req = tmp_path / "requirements.txt"
    req.write_text("fastapi==0.95.0\nrequests==2.32.0\npyyaml==5.3\n")
    found = {f["rule_id"] for f in rules.scan_dependencies(req, "requirements.txt")}
    assert found == {"CVE-2024-24762", "CVE-2020-14343"}


def test_secret_scanner(tmp_path):
    p = tmp_path / "settings.py"
    p.write_text('GITHUB = "ghp_' + "a" * 36 + '"\napi_key = "Zx9#kLm2Qp7Rw4Tv"\nname = "hello world"\n')
    found = rules.scan_secrets(p, "settings.py")
    assert {f["rule_id"] for f in found} == {"SEC002", "SEC100"}

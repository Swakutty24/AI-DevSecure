import os
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("DEVSECURE_DATA_DIR", BASE_DIR / "data"))
WORKSPACES_DIR = Path(os.getenv("DEVSECURE_WORKSPACES_DIR", BASE_DIR / "workspaces"))
REPORTS_DIR = DATA_DIR / "reports"
FRONTEND_DIST = BASE_DIR.parent / "frontend" / "dist"

for _d in (DATA_DIR, WORKSPACES_DIR, REPORTS_DIR):
    _d.mkdir(parents=True, exist_ok=True)

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DATA_DIR / 'devsecure.db'}")


def _load_bus_secret() -> bytes:
    """Master secret used to derive per-agent HMAC keys for the message bus."""
    env = os.getenv("DEVSECURE_BUS_SECRET")
    if env:
        return env.encode()
    key_file = DATA_DIR / ".bus_secret"
    if not key_file.exists():
        key_file.write_text(secrets.token_hex(32))
        key_file.chmod(0o600)
    return key_file.read_text().strip().encode()


BUS_SECRET = _load_bus_secret()

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")

DEFAULT_SETTINGS: dict = {
    "general": {
        "platform_name": "AI DevSecure",
        "max_feedback_iterations": 3,
        "seed_vulnerable_draft": True,
        "pacing_ms": 400,
        "last_digest_at": "",
    },
    "agents": {
        "planner_model": "gpt-4o-mini",
        "developer_model": "gpt-4o-mini",
        "max_concurrency": 4,
        "auto_fix_vulnerabilities": True,
    },
    "security": {
        "bandit_enabled": True,
        "semgrep_enabled": True,
        "secrets_scan_enabled": True,
        "dependency_scan_enabled": True,
        "block_on_critical_high": True,
        "min_test_coverage": 80,
        "sandbox": "subprocess",
        "prompt_injection_guard": True,
    },
    "integrations": {
        "llm_base_url": "https://api.openai.com/v1",
        "llm_api_key": "",
        "github_token": "",
        "webhook_url": "",
        "chatops_alerts": False,
        "weekly_digest": False,
    },
}

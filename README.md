# AI DevSecure

**A Secure Multi-Agent AI Framework for Autonomous Software Development, Testing and Vulnerability Detection**

PG Final Year Project — Department of CSE, United Institute of Technology
Student: SWATHI J (714525405016)

AI DevSecure takes a plain-English software requirement and runs it through four cooperating AI agents that
plan, write, test and security-audit a working Python FastAPI project. Any failing test or vulnerability is sent
back to the Developer Agent automatically (feedback loop) until the project passes the release policy gate, after
which audit reports are generated and shown on the monitoring dashboard.

```
Requirement ──► Planner Agent ──► Developer Agent ──► Tester Agent ──► Security Agent ──► Policy gate
                                       ▲                                         │            │
                                       └──────── fix request (issues found) ◄────┘            ▼
                                                                                   Reports + Dashboard
```

## Quick start

Requirements: Python 3.11+ and Node.js 20+.

```bash
./run.sh            # installs dependencies on first run, builds the UI, serves on http://127.0.0.1:8000
SEED=1 ./run.sh     # same, but first generates 5 demo projects through the real pipeline
```

Other options: `PORT=9000 ./run.sh`, `SKIP_BUILD=1 ./run.sh` (reuse the existing UI build).

### Development mode

```bash
cd backend && .venv/bin/uvicorn app.main:app --reload       # API on :8000
cd frontend && npm run dev                                  # UI on :5173 (proxies /api to :8000)
```

### Tests

```bash
cd backend && .venv/bin/python -m pytest      # 26 tests: security layer, agents, end-to-end API pipeline
```

## The agents

| Agent | Responsibility |
|---|---|
| Planner | Turns the requirement into a specification: entity, fields, validation rules, endpoints and a task plan. |
| Developer | Generates the FastAPI project (models, schemas, CRUD routes, DB layer) and commits every iteration to a per-project git repository. Applies fixes requested by the feedback loop. |
| Tester | Generates PyTest suites, runs them inside the sandbox and measures coverage (pytest-cov). |
| Security | Bandit, Semgrep (if installed), the built-in DevSecure AST rule engine, a secret scanner and CVE matching of pinned dependencies. Findings are de-duplicated by CWE. |

The orchestrator repeats Developer → Tester → Security while there are Critical/High/Medium findings or failing
tests, up to *Max feedback iterations* (Settings). The policy gate then blocks release on open Critical/High
findings, failing tests or coverage below the configured minimum.

## Security of the framework itself

- **Signed inter-agent messaging** — every message is an envelope signed with HMAC-SHA256 using a per-agent key,
  checked against a route allow-list, a timestamp window and a nonce (replay protection). All messages are visible
  on the Agent Pipeline page.
- **Prompt-injection guard** — requirements and message payloads are screened; instruction-override phrases,
  role hijacks and hidden zero-width characters are stripped before they reach an agent.
- **Sandboxed execution** — generated code runs without a shell, with a scrubbed environment, CPU/memory/file
  limits, a timeout and path-traversal protection.
- Secrets in settings are masked in the API and UI.

## Technology

- Backend: Python, FastAPI, SQLAlchemy (SQLite by default; set `DATABASE_URL` for PostgreSQL), PyTest, Bandit,
  ReportLab (PDF reports).
- Frontend: React 19, TypeScript, Vite, Tailwind CSS, lucide-react.

## Configuration

Everything is configurable from the Settings page. Useful environment variables:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | SQLAlchemy URL, e.g. `postgresql+psycopg://user:pass@localhost/devsecure` (requires `pip install "psycopg[binary]"`) |
| `DEVSECURE_BUS_SECRET` | Master secret for agent message signing (otherwise generated into `backend/data/.bus_secret`) |
| `DEVSECURE_PACING_MS` | Delay per agent step so the pipeline can be watched live (`0` = full speed) |

**LLM mode:** by default the agents run in offline template mode, so the demo works without internet or API keys.
Enter an OpenAI-compatible base URL and API key under Settings → Integrations to let the Planner use an LLM.

**Demo setting:** *Seed vulnerable first draft* (Settings → General, on by default) makes the Developer's first
draft contain deliberate flaws (SQL injection, `eval`, `shell=True`, a hardcoded secret, outdated dependencies) so
the Tester/Security agents and the feedback loop can be demonstrated. Turn it off to generate the secure version
directly.

## Project layout

```
backend/
  app/agents/      planner, developer, tester, security, orchestrator, rule engine, code templates
  app/security/    message bus (HMAC), prompt-injection guard, sandbox
  app/routers/     REST API (projects, pipeline, reports, settings/dashboard)
  app/services/    settings, report generation, weekly digest
  tests/           platform test suite
  workspaces/      generated projects (one git repo each, created at runtime)
  data/            SQLite database, reports, bus secret (created at runtime)
frontend/src/
  pages/           Dashboard, Create Project, Projects/Generated Code, Agent Pipeline,
                   Test Results, Security Scan, Reports, Settings
```

## Limitations

- Code generation targets Python FastAPI CRUD services.
- Single administrator account (no login/roles).
- Semgrep is used only when it is installed (`pip install semgrep`); the AST rule engine covers the same rule set otherwise.

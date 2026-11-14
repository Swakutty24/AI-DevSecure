"""Deterministic code generator used by the Developer Agent when no LLM is configured.

`secure=False` produces a first draft that intentionally contains common flaws
(hard-coded secret, SQL built with f-strings, eval, shell=True, missing validation,
missing duplicate check, outdated pinned dependencies). It exists so the
Tester/Security feedback loop can be demonstrated offline; it is only used when the
"seed_vulnerable_draft" setting is enabled.
"""

SQL_TYPES = {"text": "TEXT", "email": "TEXT", "date": "TEXT", "int": "INTEGER", "bool": "INTEGER", "float": "REAL"}
PY_TYPES = {"text": "str", "email": "str", "date": "date", "int": "int", "bool": "bool", "float": "float"}


def _secure_field(kind: str, optional: bool) -> str:
    default = "None" if optional else "..."
    if kind == "text":
        return f"Field({default}, min_length=1, max_length=200)"
    if kind == "email":
        return f"Field({default}, pattern=EMAIL_PATTERN, max_length=254)"
    if kind in ("int", "float"):
        return f"Field({default}, ge=0)"
    return f"Field({default})"


def gen_config(spec: dict, secure: bool) -> str:
    if secure:
        return f'''import os
import secrets


class Settings:
    APP_NAME: str = os.getenv("APP_NAME", "{spec["app_title"]}")
    # Secrets are read from the environment; a random per-process key is used in development.
    SECRET_KEY: str = os.getenv("APP_SECRET_KEY") or secrets.token_urlsafe(32)
    DEBUG: bool = os.getenv("APP_DEBUG", "false").lower() == "true"
    DATABASE: str = os.getenv("APP_DATABASE", ":memory:")


settings = Settings()
'''
    return f'''import os


class Settings:
    APP_NAME: str = "{spec["app_title"]}"
    SECRET_KEY: str = "devsecure-demo-secret-123"
    DEBUG: bool = True
    DATABASE: str = os.getenv("APP_DATABASE", ":memory:")


settings = Settings()
'''


def gen_database(spec: dict, secure: bool) -> str:
    e, plural, fields, unique = spec["entity"], spec["entity_plural"], spec["fields"], spec["unique"]
    cols = ",\n".join(
        f"            {f['name']} {SQL_TYPES[f['kind']]} NOT NULL{' UNIQUE' if f['name'] in unique else ''}" for f in fields
    )
    names = [f["name"] for f in fields]
    col_list = ", ".join(names)
    placeholders = ", ".join("?" for _ in names)
    columns_tuple = ", ".join(f'"{n}"' for n in names) + ("," if len(names) == 1 else "")

    lookups = ""
    for u in unique:
        if secure:
            lookups += f'''

def get_{e}_by_{u}(value) -> Optional[dict]:
    with _lock:
        row = _conn.execute("SELECT * FROM {plural} WHERE {u} = ?", (value,)).fetchone()
    return _row(row)
'''
        else:
            lookups += f'''

def get_{e}_by_{u}(value) -> Optional[dict]:
    query = f"SELECT * FROM {plural} WHERE {u} = '{{value}}'"
    with _lock:
        row = _conn.execute(query).fetchone()
    return _row(row)
'''

    return f'''import sqlite3
import threading
from typing import Optional

from .config import settings

COLUMNS = ({columns_tuple})

_conn = sqlite3.connect(settings.DATABASE, check_same_thread=False)
_conn.row_factory = sqlite3.Row
_lock = threading.Lock()


def init_db() -> None:
    with _lock:
        _conn.execute(
            """CREATE TABLE IF NOT EXISTS {plural} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
{cols}
        )"""
        )
        _conn.commit()


def reset_db() -> None:
    with _lock:
        _conn.execute("DROP TABLE IF EXISTS {plural}")
        _conn.commit()
    init_db()


def _row(row) -> Optional[dict]:
    return dict(row) if row is not None else None


def create_{e}(data: dict) -> dict:
    values = tuple(data[c] for c in COLUMNS)
    with _lock:
        cur = _conn.execute("INSERT INTO {plural} ({col_list}) VALUES ({placeholders})", values)
        _conn.commit()
        new_id = cur.lastrowid
    return get_{e}(new_id)


def get_{e}(item_id: int) -> Optional[dict]:
    with _lock:
        row = _conn.execute("SELECT * FROM {plural} WHERE id = ?", (item_id,)).fetchone()
    return _row(row)


def list_{plural}(skip: int = 0, limit: int = 100) -> list:
    with _lock:
        rows = _conn.execute("SELECT * FROM {plural} ORDER BY id LIMIT ? OFFSET ?", (limit, skip)).fetchall()
    return [dict(r) for r in rows]


def update_{e}(item_id: int, changes: dict) -> Optional[dict]:
    allowed = {{k: v for k, v in changes.items() if k in COLUMNS}}
    if allowed:
        assignments = ", ".join(f"{{k}} = ?" for k in allowed)  # keys restricted to COLUMNS
        with _lock:
            _conn.execute(
                "UPDATE {plural} SET " + assignments + " WHERE id = ?",  # nosec B608
                (*allowed.values(), item_id),
            )
            _conn.commit()
    return get_{e}(item_id)


def delete_{e}(item_id: int) -> bool:
    with _lock:
        cur = _conn.execute("DELETE FROM {plural} WHERE id = ?", (item_id,))
        _conn.commit()
    return cur.rowcount > 0
{lookups}'''


def gen_schemas(spec: dict, secure: bool) -> str:
    cls, fields = spec["class_name"], spec["fields"]
    uses_date = any(f["kind"] == "date" for f in fields)
    lines = ["from typing import Optional", ""]
    if uses_date:
        lines.insert(0, "from datetime import date")
    if secure:
        lines += ["from pydantic import BaseModel, ConfigDict, Field", "",
                  'EMAIL_PATTERN = r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$"', "", ""]
        lines += [f"class {cls}Base(BaseModel):", "    model_config = ConfigDict(str_strip_whitespace=True)", ""]
        lines += [f"    {f['name']}: {PY_TYPES[f['kind']]} = {_secure_field(f['kind'], False)}" for f in fields]
        lines += ["", "", f"class {cls}Create({cls}Base):", "    pass", "", ""]
        lines += [f"class {cls}Update(BaseModel):", "    model_config = ConfigDict(str_strip_whitespace=True)", ""]
        lines += [f"    {f['name']}: Optional[{PY_TYPES[f['kind']]}] = {_secure_field(f['kind'], True)}" for f in fields]
    else:
        lines += ["from pydantic import BaseModel", "", ""]
        lines += [f"class {cls}Base(BaseModel):"]
        lines += [f"    {f['name']}: {PY_TYPES[f['kind']]}" for f in fields]
        lines += ["", "", f"class {cls}Create({cls}Base):", "    pass", "", ""]
        lines += [f"class {cls}Update(BaseModel):"]
        lines += [f"    {f['name']}: Optional[{PY_TYPES[f['kind']]}] = None" for f in fields]
    lines += ["", "", f"class {cls}({cls}Base):", "    id: int", ""]
    return "\n".join(lines)


def gen_main(spec: dict, secure: bool) -> str:
    e, plural, cls, unique = spec["entity"], spec["entity_plural"], spec["class_name"], spec["unique"]
    create_checks = ""
    update_checks = ""
    lookup_routes = ""
    for u in unique:
        label = u.replace("_", " ")
        if secure:
            create_checks += f'''    # Check for duplicate {label}
    if database.get_{e}_by_{u}(payload.{u}) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="{cls} with this {label} already exists")
'''
            update_checks += f'''    if "{u}" in changes:
        existing = database.get_{e}_by_{u}(changes["{u}"])
        if existing is not None and existing["id"] != {e}_id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="{cls} with this {label} already exists")
'''
        lookup_routes += f'''

@app.get("/{plural}/by-{u.replace("_", "-")}/{{value}}", response_model={cls})
def get_{e}_by_{u}(value: str):
    item = database.get_{e}_by_{u}(value)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="{cls} not found")
    return item
'''
    return f'''from typing import List

from fastapi import FastAPI, HTTPException, Query, Response, status

from . import database
from .config import settings
from .schemas import {cls}, {cls}Create, {cls}Update

app = FastAPI(title="{spec["app_title"]}", version="1.0.0", debug=settings.DEBUG)
database.init_db()


@app.get("/health")
def health_check():
    return {{"status": "ok", "service": settings.APP_NAME}}


@app.post("/{plural}", response_model={cls}, status_code=status.HTTP_201_CREATED)
def create_{e}(payload: {cls}Create):
{create_checks}    return database.create_{e}(payload.model_dump(mode="json"))


@app.get("/{plural}", response_model=List[{cls}])
def list_{plural}(skip: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=500)):
    return database.list_{plural}(skip=skip, limit=limit)


@app.get("/{plural}/{{{e}_id}}", response_model={cls})
def get_{e}({e}_id: int):
    item = database.get_{e}({e}_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="{cls} not found")
    return item


@app.put("/{plural}/{{{e}_id}}", response_model={cls})
def update_{e}({e}_id: int, payload: {cls}Update):
    if database.get_{e}({e}_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="{cls} not found")
    changes = payload.model_dump(mode="json", exclude_unset=True, exclude_none=True)
{update_checks}    return database.update_{e}({e}_id, changes)


@app.delete("/{plural}/{{{e}_id}}", status_code=status.HTTP_204_NO_CONTENT)
def delete_{e}({e}_id: int):
    if not database.delete_{e}({e}_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="{cls} not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
{lookup_routes}'''


def gen_helpers(spec: dict, secure: bool) -> str:
    if secure:
        return '''SORTABLE_FIELDS = {"id"%s}


def parse_sort_expression(expr: str) -> tuple:
    """Parse "field" or "-field" into (field, descending) using an allow-list."""
    descending = expr.startswith("-")
    field = expr.lstrip("-")
    if field not in SORTABLE_FIELDS:
        raise ValueError(f"cannot sort by {field!r}")
    return field, descending
''' % "".join(f', "{f["name"]}"' for f in spec["fields"])
    return '''def parse_sort_expression(expr: str):
    """Parse a client-supplied sort expression."""
    return eval(expr)
'''


def gen_utils(secure: bool) -> str:
    if secure:
        return '''import socket


def check_service(host: str, port: int = 80, timeout: float = 2.0) -> bool:
    """Check that a dependent service is reachable without spawning a shell."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False
'''
    return '''import subprocess


def check_service(host: str) -> bool:
    return subprocess.call(f"ping -c 1 {host}", shell=True) == 0
'''


def gen_requirements(secure: bool) -> str:
    if secure:
        return "fastapi>=0.115.0\nuvicorn>=0.30.0\npydantic>=2.7.0\nhttpx>=0.27.0\npytest>=8.0.0\n"
    return "fastapi==0.95.0\nuvicorn==0.21.0\npydantic>=1.10\nrequests==2.25.0\njinja2==3.0.0\npytest\n"


def gen_readme(spec: dict) -> str:
    plural = spec["entity_plural"]
    fields = "\n".join(f"- `{f['name']}` ({f['kind']}) - {f['label']}" for f in spec["fields"])
    unique = ", ".join(f"`{u}`" for u in spec["unique"]) or "none"
    return f"""# {spec["app_title"]}

Generated by the **AI DevSecure** Developer Agent.

## Resource: `{spec["class_name"]}`

{fields}

Unique fields: {unique}

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/{plural}` | Create |
| GET | `/{plural}` | List (`skip`, `limit`) |
| GET | `/{plural}/{{id}}` | Get by id |
| PUT | `/{plural}/{{id}}` | Partial update |
| DELETE | `/{plural}/{{id}}` | Delete |

## Run

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload
pytest
```
"""


def generate_project(spec: dict, secure: bool = True) -> dict[str, str]:
    return {
        "app/__init__.py": "",
        "app/config.py": gen_config(spec, secure),
        "app/database.py": gen_database(spec, secure),
        "app/schemas.py": gen_schemas(spec, secure),
        "app/main.py": gen_main(spec, secure),
        "app/helpers.py": gen_helpers(spec, secure),
        "app/utils.py": gen_utils(secure),
        "requirements.txt": gen_requirements(secure),
        "README.md": gen_readme(spec),
    }

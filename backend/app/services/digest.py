"""Weekly executive digest: Mondays 08:00 UTC, PDF report + optional webhook dispatch."""

import threading
from datetime import datetime, timedelta, timezone

import httpx

from ..database import session_scope
from ..models import Report
from .reports import create_report
from .settings import get_settings, update_settings


def last_due(now: datetime) -> datetime:
    monday = (now - timedelta(days=now.weekday())).replace(hour=8, minute=0, second=0, microsecond=0)
    return monday if now >= monday else monday - timedelta(days=7)


def send_digest() -> int:
    rid = create_report("executive", "pdf", generated_by="Automated Cron", name="Weekly Executive Digest")
    with session_scope() as db:
        settings = get_settings(db)
        report = db.get(Report, rid)
        url = settings["integrations"].get("webhook_url")
        update_settings(db, {"general": {"last_digest_at": datetime.now(timezone.utc).isoformat()}})
        payload = {"text": f"[AI DevSecure] {report.name} is ready", "report_id": rid, "sha256": report.sha256}
    if url:
        try:
            httpx.post(url, json=payload, timeout=5)
        except httpx.HTTPError:
            pass
    return rid


def _loop(stop: threading.Event) -> None:
    while not stop.wait(60):
        try:
            with session_scope() as db:
                s = get_settings(db)
            if not s["integrations"].get("weekly_digest"):
                continue
            last = s["general"].get("last_digest_at") or ""
            due = last_due(datetime.now(timezone.utc))
            if not last or datetime.fromisoformat(last) < due:
                send_digest()
        except Exception:  # scheduler must never die
            continue


def start_scheduler() -> threading.Event:
    stop = threading.Event()
    threading.Thread(target=_loop, args=(stop,), daemon=True, name="digest-scheduler").start()
    return stop

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .config import CORS_ORIGINS, FRONTEND_DIST
from .database import SessionLocal, init_db
from .models import PipelineRun
from .routers import pipeline, projects, reports, system
from .services.digest import start_scheduler


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    # Runs interrupted by a server restart can never resume; mark them as failed.
    with SessionLocal() as db:
        for run in db.query(PipelineRun).filter_by(status="running"):
            run.status = "failed"
            run.gate = {"passed": False, "reasons": ["interrupted by server restart"]}
            run.project.status = "failed"
        db.commit()
    stop = start_scheduler()
    yield
    stop.set()


app = FastAPI(title="AI DevSecure API", version=__version__, lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    return response


for r in (projects.router, pipeline.router, reports.router, system.router):
    app.include_router(r)

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        candidate = (FRONTEND_DIST / full_path).resolve()
        if full_path and candidate.is_file() and FRONTEND_DIST.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")

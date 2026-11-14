from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    language: Mapped[str] = mapped_column(String(40), default="python-fastapi")
    project_type: Mapped[str] = mapped_column(String(40), default="web")
    description: Mapped[str] = mapped_column(Text, default="")
    requirements: Mapped[str] = mapped_column(Text, default="")
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    workspace: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    runs: Mapped[list["PipelineRun"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="PipelineRun.id"
    )


class PipelineRun(Base):
    __tablename__ = "pipeline_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(20), default="pending")
    current_agent: Mapped[str] = mapped_column(String(20), default="")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    iteration: Mapped[int] = mapped_column(Integer, default=1)
    plan: Mapped[dict] = mapped_column(JSON, default=dict)
    gate: Mapped[dict] = mapped_column(JSON, default=dict)
    files_created: Mapped[int] = mapped_column(Integer, default=0)
    lines_of_code: Mapped[int] = mapped_column(Integer, default=0)
    coverage: Mapped[float] = mapped_column(Float, default=0.0)
    coverage_detail: Mapped[dict] = mapped_column(JSON, default=dict)
    test_output: Mapped[str] = mapped_column(Text, default="")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    project: Mapped[Project] = relationship(back_populates="runs")
    steps: Mapped[list["AgentStep"]] = relationship(
        cascade="all, delete-orphan", order_by="AgentStep.id"
    )


class AgentStep(Base):
    __tablename__ = "agent_steps"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("pipeline_runs.id", ondelete="CASCADE"))
    agent: Mapped[str] = mapped_column(String(20))
    iteration: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    summary: Mapped[str] = mapped_column(Text, default="")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class LogEntry(Base):
    __tablename__ = "log_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("pipeline_runs.id", ondelete="CASCADE"), index=True)
    agent: Mapped[str] = mapped_column(String(20))
    level: Mapped[str] = mapped_column(String(10), default="INFO")
    message: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AgentMessage(Base):
    """Audit trail of signed inter-agent messages that passed through the secure bus."""

    __tablename__ = "agent_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("pipeline_runs.id", ondelete="CASCADE"), index=True)
    message_id: Mapped[str] = mapped_column(String(40))
    sender: Mapped[str] = mapped_column(String(20))
    recipient: Mapped[str] = mapped_column(String(20))
    msg_type: Mapped[str] = mapped_column(String(40))
    verified: Mapped[bool] = mapped_column(default=True)
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class TestCase(Base):
    __tablename__ = "test_cases"
    __test__ = False

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("pipeline_runs.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    file: Mapped[str] = mapped_column(String(200), default="")
    status: Mapped[str] = mapped_column(String(20))
    duration: Mapped[float] = mapped_column(Float, default=0.0)
    message: Mapped[str] = mapped_column(Text, default="")


class Finding(Base):
    __tablename__ = "findings"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("pipeline_runs.id", ondelete="CASCADE"), index=True)
    iteration: Mapped[int] = mapped_column(Integer, default=1)
    category: Mapped[str] = mapped_column(String(20), default="code")  # code | dependency | secret
    severity: Mapped[str] = mapped_column(String(10))
    tool: Mapped[str] = mapped_column(String(30))
    rule_id: Mapped[str] = mapped_column(String(60), default="")
    issue: Mapped[str] = mapped_column(String(255))
    detail: Mapped[str] = mapped_column(Text, default="")
    cwe: Mapped[str] = mapped_column(String(20), default="")
    owasp: Mapped[str] = mapped_column(String(60), default="")
    file: Mapped[str] = mapped_column(String(200), default="")
    line: Mapped[int] = mapped_column(Integer, default=0)
    snippet: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="open")  # open | fixed


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    run_id: Mapped[int | None] = mapped_column(ForeignKey("pipeline_runs.id", ondelete="SET NULL"), nullable=True)
    name: Mapped[str] = mapped_column(String(200))
    report_type: Mapped[str] = mapped_column(String(30))  # security | testing | pipeline | executive
    fmt: Mapped[str] = mapped_column(String(10), default="pdf")
    generated_by: Mapped[str] = mapped_column(String(40), default="System")
    path: Mapped[str] = mapped_column(String(255), default="")
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    sha256: Mapped[str] = mapped_column(String(64), default="")
    status: Mapped[str] = mapped_column(String(20), default="ready")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Activity(Base):
    __tablename__ = "activities"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(20))  # success | warning | code | info | error
    message: Mapped[str] = mapped_column(String(255))
    project_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON, default=dict)

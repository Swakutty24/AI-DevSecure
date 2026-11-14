import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from ..security.messaging import SecureMessageBus
from .llm import LLMClient


class PipelineCancelled(Exception):
    pass


@dataclass
class AgentContext:
    run_id: int
    project_name: str
    workspace: Path
    settings: dict
    llm: LLMClient
    bus: SecureMessageBus
    log: Callable[[str, str, str], None]
    set_progress: Callable[[int], None]
    is_cancelled: Callable[[], bool]
    pacing_s: float = 0.0
    extras: dict = field(default_factory=dict)


class BaseAgent:
    name = "agent"
    title = "Agent"

    def __init__(self, ctx: AgentContext):
        self.ctx = ctx

    def log(self, message: str, level: str = "INFO") -> None:
        self.ctx.log(self.name, level, message)

    def progress(self, pct: int) -> None:
        self.ctx.set_progress(max(0, min(100, pct)))
        if self.ctx.pacing_s:
            time.sleep(self.ctx.pacing_s)
        self.checkpoint()

    def checkpoint(self) -> None:
        if self.ctx.is_cancelled():
            raise PipelineCancelled()

    def send(self, recipient: str, msg_type: str, payload: dict):
        return self.ctx.bus.send(self.name, recipient, msg_type, payload)

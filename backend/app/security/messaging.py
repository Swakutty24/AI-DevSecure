"""Authenticated inter-agent message bus.

Every agent signs its messages with its own HMAC-SHA256 key derived from the
platform master secret. The bus enforces:
  * signature verification (integrity + sender authenticity)
  * a route allow-list (which agent may talk to which, with which message types)
  * timestamp freshness and nonce-based replay protection
  * payload size limits and prompt-injection screening of string content
Generated source code is exempt from injection screening (it is scanned by the
Security Agent instead) but still covered by the signature.
"""

import hashlib
import hmac
import json
import secrets
import threading
import time
import uuid
from collections import deque
from dataclasses import asdict, dataclass, field
from typing import Callable

from .guard import inspect_payload

MAX_PAYLOAD_BYTES = 2_000_000
MAX_CLOCK_SKEW_S = 60

ROUTES: dict[tuple[str, str], set[str]] = {
    ("orchestrator", "planner"): {"requirements"},
    ("planner", "developer"): {"task_plan"},
    ("developer", "tester"): {"code_ready"},
    ("tester", "security"): {"test_report"},
    ("security", "orchestrator"): {"scan_report"},
    ("orchestrator", "developer"): {"fix_request"},
    ("tester", "orchestrator"): {"test_report"},
}

CODE_FIELDS = frozenset({"files", "code", "snippet", "source", "detail"})


class MessageRejected(Exception):
    pass


@dataclass
class Envelope:
    sender: str
    recipient: str
    msg_type: str
    payload: dict
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    ts: float = field(default_factory=time.time)
    nonce: str = field(default_factory=lambda: secrets.token_hex(12))
    signature: str = ""

    def canonical(self) -> bytes:
        body = {k: v for k, v in asdict(self).items() if k != "signature"}
        return json.dumps(body, sort_keys=True, separators=(",", ":"), default=str).encode()


def derive_key(master: bytes, agent: str) -> bytes:
    return hmac.new(master, f"devsecure-agent:{agent}".encode(), hashlib.sha256).digest()


class SecureMessageBus:
    def __init__(self, master_secret: bytes, on_event: Callable[[Envelope, bool, str], None] | None = None):
        self._master = master_secret
        self._seen: deque[str] = deque(maxlen=10_000)
        self._seen_set: set[str] = set()
        self._lock = threading.Lock()
        self._on_event = on_event

    def sign(self, env: Envelope) -> Envelope:
        key = derive_key(self._master, env.sender)
        env.signature = hmac.new(key, env.canonical(), hashlib.sha256).hexdigest()
        return env

    def send(self, sender: str, recipient: str, msg_type: str, payload: dict) -> Envelope:
        env = self.sign(Envelope(sender=sender, recipient=recipient, msg_type=msg_type, payload=payload))
        return self.deliver(env)

    def deliver(self, env: Envelope) -> Envelope:
        try:
            self.verify(env)
        except MessageRejected as exc:
            if self._on_event:
                self._on_event(env, False, str(exc))
            raise
        if self._on_event:
            self._on_event(env, True, "")
        return env

    def verify(self, env: Envelope) -> None:
        allowed = ROUTES.get((env.sender, env.recipient))
        if allowed is None or env.msg_type not in allowed:
            raise MessageRejected(f"route {env.sender}->{env.recipient}:{env.msg_type} not permitted")

        expected = hmac.new(derive_key(self._master, env.sender), env.canonical(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, env.signature or ""):
            raise MessageRejected("invalid signature")

        if abs(time.time() - env.ts) > MAX_CLOCK_SKEW_S:
            raise MessageRejected("stale message")

        if len(env.canonical()) > MAX_PAYLOAD_BYTES:
            raise MessageRejected("payload too large")

        detections = inspect_payload(env.payload, CODE_FIELDS)
        if detections:
            raise MessageRejected(f"prompt-injection detected: {', '.join(detections)}")

        with self._lock:
            if env.nonce in self._seen_set:
                raise MessageRejected("replayed message")
            if len(self._seen) == self._seen.maxlen:
                self._seen_set.discard(self._seen[0])
            self._seen.append(env.nonce)
            self._seen_set.add(env.nonce)

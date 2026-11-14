"""Prompt-injection and malicious-payload guard for agent inputs and messages."""

import re
import unicodedata
from dataclasses import dataclass, field

INJECTION_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("override-instructions", re.compile(r"\b(ignore|disregard|forget|override)\b.{0,40}\b(previous|prior|above|all|system)\b.{0,20}\b(instructions?|prompts?|rules?)\b", re.I)),
    ("role-hijack", re.compile(r"\byou are (now|no longer)\b|\bact as (an? )?(unfiltered|jailbroken|dan)\b", re.I)),
    ("system-prompt-leak", re.compile(r"\b(reveal|print|show|output|leak)\b.{0,30}\b(system prompt|hidden instructions|api key|secret key|credentials)\b", re.I)),
    ("fake-delimiter", re.compile(r"(<\|?(im_start|im_end|system)\|?>|\[/?INST\]|###\s*system\s*:)", re.I)),
    ("tool-abuse", re.compile(r"\b(rm\s+-rf\s+/|curl\s+[^|]+\|\s*(sh|bash)|wget\s+[^|]+\|\s*(sh|bash)|nc\s+-e|/etc/passwd|~/.ssh)", re.I)),
    ("exfiltration", re.compile(r"\b(send|post|upload|exfiltrate)\b.{0,40}\b(env(ironment)? variables?|secrets?|tokens?|keys?)\b.{0,40}\b(to|at)\b\s+https?://", re.I)),
    ("disable-security", re.compile(r"\b(disable|skip|bypass|turn off)\b.{0,30}\b(security|scan(ner|ning)?|guard|validation)\b", re.I)),
]

MAX_INPUT_CHARS = 20_000


@dataclass
class GuardResult:
    safe: bool
    sanitized: str
    detections: list[str] = field(default_factory=list)


def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    # Strip zero-width / bidi control characters commonly used to hide instructions.
    return re.sub(r"[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]", "", text)


def inspect_text(text: str) -> GuardResult:
    """Detect injection attempts; returns text with offending lines removed."""
    detections: list[str] = []
    text = _normalize(text or "")
    if len(text) > MAX_INPUT_CHARS:
        detections.append("oversized-input")
        text = text[:MAX_INPUT_CHARS]

    kept: list[str] = []
    for line in text.splitlines():
        hits = [name for name, pat in INJECTION_PATTERNS if pat.search(line)]
        if hits:
            detections.extend(hits)
        else:
            kept.append(line)
    return GuardResult(safe=not detections, sanitized="\n".join(kept).strip(), detections=sorted(set(detections)))


def inspect_payload(payload: object, skip_keys: frozenset[str] = frozenset(), depth: int = 0) -> list[str]:
    """Recursively scan all string values of a message payload, ignoring `skip_keys` at any depth."""
    if depth > 8:
        return ["payload-too-deep"]
    found: list[str] = []
    if isinstance(payload, str):
        found.extend(inspect_text(payload).detections)
    elif isinstance(payload, dict):
        for k, v in payload.items():
            if k not in skip_keys:
                found.extend(inspect_payload(v, skip_keys, depth + 1))
    elif isinstance(payload, (list, tuple)):
        for v in payload:
            found.extend(inspect_payload(v, skip_keys, depth + 1))
    return sorted(set(found))

"""Minimal OpenAI-compatible chat client. Agents fall back to deterministic logic when no key is configured."""

import json
import re

import httpx


class LLMError(Exception):
    pass


class LLMClient:
    def __init__(self, base_url: str, api_key: str, timeout: float = 180.0):
        self.base_url = (base_url or "").rstrip("/")
        self.api_key = api_key or ""
        self.timeout = timeout

    @property
    def available(self) -> bool:
        return bool(self.api_key and self.base_url)

    def chat(self, model: str, system: str, user: str, json_mode: bool = True) -> str:
        if not self.available:
            raise LLMError("LLM not configured")
        body: dict = {
            "model": model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": 0.2,
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        try:
            resp = httpx.post(
                f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json=body,
                timeout=self.timeout,
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]
        except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
            raise LLMError(str(exc)) from exc

    def chat_json(self, model: str, system: str, user: str) -> dict:
        raw = self.chat(model, system, user, json_mode=True)
        match = re.search(r"\{.*\}", raw, re.S)
        if not match:
            raise LLMError("model did not return JSON")
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError as exc:
            raise LLMError(f"invalid JSON from model: {exc}") from exc

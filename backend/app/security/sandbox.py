"""Isolated execution of generated code (tests, scanners)."""

import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

SAFE_ENV_KEYS = {"PATH", "LANG", "LC_ALL", "TMPDIR", "SYSTEMROOT"}


@dataclass
class SandboxResult:
    returncode: int
    stdout: str
    stderr: str
    timed_out: bool = False


def _limits() -> None:  # pragma: no cover - runs in child process
    try:
        import resource

        resource.setrlimit(resource.RLIMIT_CPU, (120, 120))
        resource.setrlimit(resource.RLIMIT_FSIZE, (50 * 1024 * 1024, 50 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_NOFILE, (256, 256))
    except (ImportError, ValueError, OSError):
        pass


def run_sandboxed(args: list[str], cwd: Path, timeout: int = 120, extra_env: dict | None = None) -> SandboxResult:
    """Run a command with a scrubbed environment (no API keys/tokens), resource limits and a timeout.

    The command never goes through a shell. Workspace paths are confined to `cwd`.
    """
    home = cwd / ".devsecure" / "home"
    home.mkdir(parents=True, exist_ok=True)
    env = {k: v for k, v in os.environ.items() if k in SAFE_ENV_KEYS}
    env.update({"PYTHONDONTWRITEBYTECODE": "1", "PYTHONHASHSEED": "0", "HOME": str(home)})
    if extra_env:
        env.update(extra_env)
    try:
        proc = subprocess.run(
            args,
            cwd=str(cwd),
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout,
            preexec_fn=_limits if os.name == "posix" else None,
        )
        return SandboxResult(proc.returncode, proc.stdout, proc.stderr)
    except subprocess.TimeoutExpired as exc:
        return SandboxResult(-1, exc.stdout or "", (exc.stderr or "") + "\nTimed out", timed_out=True)


def python_executable() -> str:
    return sys.executable


def safe_join(root: Path, rel: str) -> Path:
    """Resolve `rel` under `root`, rejecting path traversal."""
    root = root.resolve()
    target = (root / rel).resolve()
    if root != target and root not in target.parents:
        raise ValueError("path escapes workspace")
    return target

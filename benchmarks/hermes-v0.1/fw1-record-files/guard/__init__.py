"""Benchmark-only policy/observations. Never implements an answer or a file tool."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import threading
import time


class BenchmarkStop(BaseException):
    """Not swallowed by fire-and-forget hooks; the runner preserves incomplete work."""


class FileGuard:
    def __init__(self, root, inputs, log_path, cwd=None):
        self.root = Path(root).resolve(strict=True)
        self.cwd = Path(cwd or root).resolve(strict=True)
        self.readable = {self.root / name for name in [*inputs, "result.json"]}
        self.output = self.root / "result.json"
        self.log_path = Path(log_path)
        self.lock = threading.Lock()
        self.calls = 0
        self.started = time.monotonic()

    def record(self, kind, **fields):
        with self.lock:
            with self.log_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps({"kind": kind, "elapsedMs": round((time.monotonic() - self.started) * 1000),
                                         **fields}, ensure_ascii=False) + "\n")
                handle.flush()
                os.fsync(handle.fileno())

    def before_tool(self, tool_name, args, **kwargs):
        reason = None
        args = args if isinstance(args, dict) else {}
        if any(args.get(k) for k in ("cross_profile", "sandbox_permissions", "justification")):
            reason = "permission expansion is not available"
        elif tool_name in ("skills_list", "skill_view"):
            # Empty native catalog; skill_manage and file access to profile state are denied.
            pass
        elif tool_name not in ("read_file", "write_file", "patch"):
            reason = "tool is outside the common file capabilities"
        elif tool_name == "patch" and args.get("mode", "replace") != "replace":
            reason = "only single-file replacement is in scope"
        else:
            raw = args.get("path")
            if not isinstance(raw, str) or not raw or "\x00" in raw:
                reason = "a declared file path is required"
            else:
                try:
                    candidate = Path(raw).expanduser()
                    if not candidate.is_absolute():
                        candidate = self.cwd / candidate
                    target = candidate.resolve()
                    allowed = self.readable if tool_name == "read_file" else {self.output}
                    if target not in allowed or candidate.is_symlink():
                        reason = "path is outside the declared operation"
                except (OSError, RuntimeError, ValueError):
                    reason = "path cannot be safely resolved"
        if reason:
            self.record("denied", tool=tool_name, args=args, reason=reason)
            return {"action": "block", "message": "FW1: " + reason}
        self.record("tool-start", tool=tool_name, args=args,
                    callId=kwargs.get("tool_call_id"), requestId=kwargs.get("api_request_id"))
        return None

    def after_tool(self, tool_name, args, result, **kwargs):
        self.record("tool-result", tool=tool_name, args=args, result=result,
                    callId=kwargs.get("tool_call_id"), requestId=kwargs.get("api_request_id"),
                    durationMs=kwargs.get("duration_ms"))

    def before_api(self, **kwargs):
        if self.calls >= 12 or time.monotonic() - self.started >= 600:
            self.record("stopped", reason="fixed execution envelope exhausted")
            raise BenchmarkStop()
        envelope = kwargs.get("request") or {}
        request = envelope.get("body", envelope)
        view = {k: request[k] for k in ("model", "messages", "tools", "max_tokens", "max_completion_tokens",
                                       "temperature", "top_p", "reasoning_effort", "stream") if k in request}
        ceiling = view.get("max_completion_tokens", view.get("max_tokens"))
        if ceiling != 4000:
            self.record("stopped", reason="output ceiling differs from fixed protocol")
            raise BenchmarkStop()
        self.calls += 1
        self.record("api-start", index=self.calls, requestId=kwargs.get("api_request_id"),
                    request=view, requestHash=hashlib.sha256(json.dumps(view, sort_keys=True).encode()).hexdigest())

    def after_api(self, **kwargs):
        self.record("api-result", requestId=kwargs.get("api_request_id"), usage=kwargs.get("usage"),
                    duration=kwargs.get("api_duration"), finishReason=kwargs.get("finish_reason"),
                    responseModel=kwargs.get("response_model"))

    def api_error(self, **kwargs):
        self.record("api-error", requestId=kwargs.get("api_request_id"), statusCode=kwargs.get("status_code"),
                    retryCount=kwargs.get("retry_count"), reason=kwargs.get("reason"))


def register(ctx):
    guard = FileGuard(ctx.get_config("root"), ctx.get_config("inputs"), ctx.get_config("logPath"),
                      cwd=ctx.get_config("cwd"))
    ctx.register_hook("pre_tool_call", guard.before_tool)
    ctx.register_hook("post_tool_call", guard.after_tool)
    ctx.register_hook("pre_api_request", guard.before_api)
    ctx.register_hook("post_api_request", guard.after_api)
    ctx.register_hook("api_request_error", guard.api_error)


def prepare_profile(home, root, inputs, log_path, cwd=None):
    """Create an unused profile; refuses existing state. Generated config contains no credentials."""
    import yaml
    home, root = Path(home), Path(root).resolve(strict=True)
    home.mkdir(mode=0o700, parents=True, exist_ok=False)
    (home / "skills").mkdir()
    target = home / "plugins" / "fw1-file-guard"
    target.parent.mkdir()
    shutil.copytree(Path(__file__).parent, target, ignore=shutil.ignore_patterns("__pycache__"))
    config = {
        "model": {"default": "gpt-5.6-sol", "provider": "custom"},
        "agent": {"api_max_retries": 1, "environment_probe": False},
        "compression": {"enabled": False},
        "auxiliary": {"title_generation": {"enabled": False}},
        "memory": {"memory_enabled": False, "user_profile_enabled": False},
        "terminal": {"backend": "local", "cwd": str(Path(cwd or root).resolve()), "persistent_shell": False},
        "plugins": {"enabled": ["fw1-file-guard"], "entries": {"fw1-file-guard": {"settings": {
            "root": str(root), "inputs": list(inputs), "logPath": str(log_path),
            "cwd": str(Path(cwd or root).resolve()),
        }}}},
    }
    with (home / "config.yaml").open("x", encoding="utf-8") as handle:
        yaml.safe_dump(config, handle, allow_unicode=True)

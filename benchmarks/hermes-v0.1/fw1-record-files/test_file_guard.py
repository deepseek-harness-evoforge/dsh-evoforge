"""Keyless checks; run through the unmodified Hermes scripts/run_tests.sh."""

import importlib.util
import json
from pathlib import Path

import pytest


def load_guard():
    path = Path(__file__).parent / "guard" / "__init__.py"
    spec = importlib.util.spec_from_file_location("fw1_guard_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_native_plugin_and_file_pipeline(tmp_path, monkeypatch):
    module = load_guard()
    from hermes_cli.plugins import discover_plugins, unload_plugins
    from model_tools import handle_function_call

    root = tmp_path / "workspace"
    root.mkdir()
    (root / "input.json").write_text('[1, 2, 3]\n')
    home = tmp_path / "profile"
    module.prepare_profile(home, root, ["input.json"], tmp_path / "events.jsonl")
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.chdir(root)
    from hermes_cli.config import apply_terminal_config_to_env
    apply_terminal_config_to_env()
    discover_plugins(force=True)
    try:
        def call(name, args):
            return json.loads(handle_function_call(name, args, task_id="fw1-keyless"))
        read = call("read_file", {"path": str(root / "input.json")})
        assert "[1, 2, 3]" in read["content"]
        blocked = call("write_file", {"path": str(root / "input.json"), "content": "WRONG"})
        assert "FW1" in json.dumps(blocked)
        outside = call("write_file", {"path": str(tmp_path / "outside.json"), "content": "WRONG"})
        assert "FW1" in json.dumps(outside)
        assert not (tmp_path / "outside.json").exists()
        write = call("write_file", {"path": str(root / "result.json"), "content": '{"n":3}\n'})
        assert not write.get("error")
        result = call("read_file", {"path": str(root / "result.json")})
        assert '{"n":3}' in result["content"]
        assert (root / "input.json").read_text() == '[1, 2, 3]\n'
        events = [json.loads(line) for line in (tmp_path / "events.jsonl").read_text().splitlines()]
        assert len([e for e in events if e["kind"] == "denied"]) == 2
        assert any(e["kind"] == "tool-result" and e["tool"] == "write_file" for e in events)
        assert any(e["kind"] == "tool-result" and e["tool"] == "read_file" for e in events)
    finally:
        from tools.terminal_tool import cleanup_vm
        cleanup_vm("fw1-keyless")
        unload_plugins()


def test_guard_blocks_aliases_and_unreachable_actions(tmp_path):
    module = load_guard()
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "input.json").write_text("[]")
    (root / "result.json").symlink_to(tmp_path / "outside.json")
    guard = module.FileGuard(root, ["input.json"], tmp_path / "events.jsonl")
    for tool, args in [
        ("read_file", {"path": "../secret"}),
        ("write_file", {"path": "result.json", "content": "wrong"}),
        ("write_file", {"path": "input.json", "content": "wrong"}),
        ("patch", {"mode": "patch", "patch": "*** Delete File: input.json"}),
        ("terminal", {"command": "pwd"}),
        ("skill_manage", {"action": "create"}),
        ("read_file", {"path": "input.json", "cross_profile": True}),
    ]:
        assert guard.before_tool(tool, args)["action"] == "block"
    assert guard.before_tool("read_file", {"path": "input.json"}) is None


def test_api_budget_stops_before_thirteenth_dispatch(tmp_path):
    module = load_guard()
    guard = module.FileGuard(tmp_path, [], tmp_path / "events.jsonl")
    for i in range(12):
        guard.before_api(api_call_count=i + 1, request={"max_tokens": 4000})
    with pytest.raises(module.BenchmarkStop):
        guard.before_api(api_call_count=13, request={"max_tokens": 4000})
    assert len([json.loads(x) for x in (tmp_path / "events.jsonl").read_text().splitlines()
                if json.loads(x)["kind"] == "api-start"]) == 12


def test_native_agent_observes_actual_provider_and_tools(tmp_path, monkeypatch):
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    import threading

    module = load_guard()
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "input.json").write_text('[1, 2, 3]\n')
    home = tmp_path / "agent-profile"
    events_path = tmp_path / "agent-events.jsonl"
    module.prepare_profile(home, root, ["input.json"], events_path)
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.chdir(root)
    from hermes_cli.config import apply_terminal_config_to_env
    apply_terminal_config_to_env()
    from hermes_cli.plugins import discover_plugins, unload_plugins
    discover_plugins(force=True)
    requests = []
    tools = [
        ("read_file", {"path": str(root / "input.json")}),
        ("write_file", {"path": str(root / "result.json"), "content": '{"n":3}\n'}),
        ("read_file", {"path": str(root / "result.json")}),
    ]

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            if not self.path.endswith("/chat/completions"):
                # Native model metadata probes (e.g. Ollama /api/show) are not chat completions.
                self.send_response(404)
                self.end_headers()
                return
            index = len(requests)
            requests.append(body)
            message = {"role": "assistant", "content": "Done: result.json" if index >= len(tools) else None}
            if index < len(tools):
                name, args = tools[index]
                message["tool_calls"] = [{"id": f"c{index}", "type": "function",
                                           "function": {"name": name, "arguments": json.dumps(args)}}]
            finish = "tool_calls" if index < len(tools) else "stop"
            usage = {"prompt_tokens": 100, "completion_tokens": 10, "total_tokens": 110}
            reply = {"id": f"req{index}", "object": "chat.completion", "created": 1,
                     "model": "gpt-5.6-sol", "choices": [{"index": 0, "message": message, "finish_reason": finish}],
                     "usage": usage}
            self.send_response(200)
            if body.get("stream"):
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                delta = dict(message)
                if "tool_calls" in delta:
                    delta["tool_calls"][0]["index"] = 0
                chunk = {**reply, "object": "chat.completion.chunk",
                         "choices": [{"index": 0, "delta": delta, "finish_reason": None}]}
                self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
                chunk["choices"] = [{"index": 0, "delta": {}, "finish_reason": finish}]
                self.wfile.write(("data: " + json.dumps(chunk) + "\n\ndata: [DONE]\n\n").encode())
            else:
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(reply).encode())

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    from run_agent import AIAgent
    from hermes_state import SessionDB
    db = SessionDB(home / "state.db")
    agent = AIAgent(model="gpt-5.6-sol", provider="custom", api_mode="chat_completions",
                    base_url=f"http://127.0.0.1:{server.server_port}/v1", api_key="keyless-fixture",
                    max_iterations=12, max_tokens=4000, enabled_toolsets=["file", "skills"],
                    quiet_mode=True, skip_context_files=True, skip_memory=True, skip_background_review=True,
                    session_id="fw1-native-keyless", session_db=db)
    try:
        result = agent.run_conversation("Read input.json, write result.json, read it back, then report its path.",
                                        task_id="fw1-native-keyless")
        assert result["completed"] is True
        assert len(requests) == 4
        assert (root / "result.json").read_text() == '{"n":3}\n'
        events = [json.loads(line) for line in events_path.read_text().splitlines()]
        assert len([e for e in events if e["kind"] == "api-start"]) == 4
        assert len([e for e in events if e["kind"] == "api-result"]) == 4
        assert len([e for e in events if e["kind"] == "tool-result"]) == 3
        assert all((r.get("max_completion_tokens") or r.get("max_tokens")) == 4000 for r in requests)
    finally:
        agent.close()
        db.close()
        unload_plugins()
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)

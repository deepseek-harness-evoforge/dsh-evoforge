"""One native Hermes task. Credentials arrive only through the parent's pipe."""

import json
import os
from pathlib import Path
import sys
import time

from guard import prepare_profile


def main():
    payload_path = Path(sys.argv[1]).resolve(strict=True)
    payload = json.loads(payload_path.read_text(encoding="utf-8"))
    repo = Path(payload["hermesRepo"]).resolve(strict=True)
    if (repo / ".env").exists():
        raise RuntimeError("Benchmark refuses an ambient checkout environment")
    root = Path(payload["root"]).resolve(strict=True)
    home = payload_path.parent / "profile"
    events = payload_path.parent / "events.jsonl"
    prepare_profile(home, root, payload["inputs"], events, cwd=payload["cwd"])
    os.environ["HERMES_HOME"] = str(home)
    sys.path.insert(0, str(repo))
    from hermes_cli.config import apply_terminal_config_to_env
    apply_terminal_config_to_env()
    from hermes_cli.plugins import discover_plugins, get_plugin_manager, unload_plugins
    discover_plugins(force=True)
    if not any(p["key"] == "fw1-file-guard" and p["enabled"] and not p["error"]
               for p in get_plugin_manager().list_plugins()):
        raise RuntimeError("Benchmark policy was not loaded")
    from hermes_state import SessionDB
    from run_agent import AIAgent
    connection = json.loads(sys.stdin.read())
    if connection["model"] != "gpt-5.6-sol":
        raise RuntimeError("Model differs from fixed protocol")
    db = SessionDB(home / "state.db")
    agent = None
    started = time.monotonic()
    try:
        agent = AIAgent(
            model=connection["model"], provider="custom", api_mode="chat_completions",
            base_url=connection["baseURL"], api_key=connection["apiKey"],
            max_iterations=12, max_tokens=4000, enabled_toolsets=["file", "skills"],
            quiet_mode=True, verbose_logging=False, save_trajectories=True,
            skip_context_files=True, load_soul_identity=False, skip_memory=True,
            skip_background_review=True, session_id=payload["sessionId"], session_db=db,
        )
        connection.clear()
        result = agent.run_conversation(payload["prompt"], task_id=payload["sessionId"])
        result.pop("base_url", None)
        result["elapsedMs"] = round((time.monotonic() - started) * 1000)
        with (payload_path.parent / "native-result.json").open("x", encoding="utf-8") as handle:
            json.dump(result, handle, ensure_ascii=False, indent=2)
        print(json.dumps({"case": payload["caseId"], "completed": result.get("completed"),
                          "apiCalls": result.get("api_calls"), "elapsedMs": result["elapsedMs"]}))
    except BaseException as exc:
        # Never serialize a provider exception that might include a credential.
        with (payload_path.parent / "runner-failure.json").open("x", encoding="utf-8") as handle:
            json.dump({"type": type(exc).__name__, "elapsedMs": round((time.monotonic() - started) * 1000)}, handle)
        raise SystemExit(2)
    finally:
        if agent is not None:
            agent.close()
        db.close()
        unload_plugins()


if __name__ == "__main__":
    main()

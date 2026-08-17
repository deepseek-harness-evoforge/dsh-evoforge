"""Exercise Hermes' production kanban_complete tool in one isolated home."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: hermes-kanban-completion.py <hermes-repo> <input-json>")
    hermes_repo = Path(sys.argv[1]).resolve()
    payload = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    sys.path.insert(0, str(hermes_repo))

    from hermes_cli import kanban_db as kb
    from tools import kanban_tools as kt

    kb._INITIALIZED_PATHS.clear()
    kb.init_db()
    outputs = {}
    for case in payload["cases"]:
        conn = kb.connect()
        try:
            task_id = kb.create_task(
                conn,
                title=f"SD-1 {case['id']}",
                body="Complete only if the frozen repository check exits 0.",
                assignee="benchmark-worker",
                goal_mode=True,
            )
            claimed = kb.claim_task(conn, task_id, claimer=f"benchmark:{case['id']}")
            if claimed is None:
                raise RuntimeError(f"could not claim Hermes task {task_id}")
        finally:
            conn.close()

        os.environ["HERMES_KANBAN_TASK"] = task_id
        completed = json.loads(kt._handle_complete({
            "summary": f"frozen check exit={case['exitCode']}; status={case['status']}",
            "metadata": {
                "check": "quality",
                "exit_code": case["exitCode"],
                "observed_status": case["status"],
            },
        }))
        conn = kb.connect()
        try:
            task = kb.get_task(conn, task_id)
            run = kb.latest_run(conn, task_id)
            outputs[case["id"]] = {
                "toolOk": completed.get("ok") is True,
                "taskStatus": task.status,
                "runOutcome": run.outcome if run else None,
                "recordedExitCode": case["exitCode"],
            }
        finally:
            conn.close()

    print(json.dumps({
        "goalJudgeAvailable": kt._goal_judge_available(),
        "cases": outputs,
    }, sort_keys=True))


if __name__ == "__main__":
    main()

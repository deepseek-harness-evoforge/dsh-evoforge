"""Exercise Hermes' production Kanban crash reclaim in one isolated home."""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
from pathlib import Path


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: hermes-kanban-crash.py <hermes-repo>")
    hermes_repo = Path(sys.argv[1]).resolve()
    sys.path.insert(0, str(hermes_repo))

    from hermes_cli import kanban_db as kb

    kb._INITIALIZED_PATHS.clear()
    kb.init_db()
    conn = kb.connect()
    worker: subprocess.Popen[bytes] | None = None
    try:
        task_id = kb.create_task(
            conn,
            title="LC-1 durable local work",
            body="Recover exactly once after the claimed worker is SIGKILLed.",
            assignee="benchmark-worker",
            goal_mode=True,
            max_retries=2,
        )
        first = kb.claim_task(conn, task_id)
        if first is None or first.current_run_id is None:
            raise RuntimeError("could not create the first Hermes worker run")
        first_run_id = first.current_run_id

        worker = subprocess.Popen([
            sys.executable,
            "-c",
            "import time; time.sleep(60)",
        ])
        kb._set_worker_pid(conn, task_id, worker.pid)
        os.kill(worker.pid, signal.SIGKILL)
        return_code = worker.wait(timeout=5)
        if return_code != -signal.SIGKILL:
            raise RuntimeError(f"worker exited with {return_code}, expected SIGKILL")
        kb._record_worker_exit(worker.pid, signal.SIGKILL)

        first_detection = kb.detect_crashed_workers(conn)
        second_detection = kb.detect_crashed_workers(conn)
    finally:
        if worker is not None and worker.poll() is None:
            worker.kill()
            worker.wait(timeout=5)
        conn.close()

    conn = kb.connect()
    try:
        recovered = kb.get_task(conn, task_id)
        if recovered is None:
            raise RuntimeError("Hermes lost the task after reopening canonical storage")
        status_after_reopen = recovered.status
        second = kb.claim_task(conn, task_id)
        if second is None or second.current_run_id is None:
            raise RuntimeError("Hermes could not claim the recovered task")
        second_run_id = second.current_run_id

        stale_owner_mutation_accepted = kb.complete_task(
            conn,
            task_id,
            summary="stale predecessor completion",
            expected_run_id=first_run_id,
        )
        after_stale_attempt = kb.get_task(conn, task_id)
        completion_accepted = kb.complete_task(
            conn,
            task_id,
            summary="successor completed recovered task",
            expected_run_id=second_run_id,
        )
        duplicate_completion_accepted = kb.complete_task(
            conn,
            task_id,
            summary="duplicate successor completion",
            expected_run_id=second_run_id,
        )
    finally:
        conn.close()

    conn = kb.connect()
    try:
        final_task = kb.get_task(conn, task_id)
        events = kb.list_events(conn, task_id)
        runs = conn.execute(
            "SELECT outcome FROM task_runs WHERE task_id = ? ORDER BY id",
            (task_id,),
        ).fetchall()
        print(json.dumps({
            "processSignal": "SIGKILL",
            "firstRunId": first_run_id,
            "secondRunId": second_run_id,
            "firstCrashDetections": len(first_detection),
            "secondCrashDetections": len(second_detection),
            "statusAfterReopen": status_after_reopen,
            "staleOwnerMutationAccepted": stale_owner_mutation_accepted,
            "statusAfterStaleAttempt": after_stale_attempt.status if after_stale_attempt else None,
            "completionAccepted": completion_accepted,
            "duplicateCompletionAccepted": duplicate_completion_accepted,
            "finalStatus": final_task.status if final_task else None,
            "crashedEvents": sum(event.kind == "crashed" for event in events),
            "completedEvents": sum(event.kind == "completed" for event in events),
            "runOutcomes": [row["outcome"] for row in runs],
        }, sort_keys=True))
    finally:
        conn.close()


if __name__ == "__main__":
    main()

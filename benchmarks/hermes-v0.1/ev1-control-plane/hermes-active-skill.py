"""Isolated fixture that exercises Hermes' production skill_manage mutation path."""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
from pathlib import Path
from unittest.mock import patch


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit("usage: hermes-active-skill.py <hermes-repo> <root> <input-json>")

    hermes_repo = Path(sys.argv[1]).resolve()
    root = Path(sys.argv[2]).resolve()
    payload = json.loads(Path(sys.argv[3]).read_text(encoding="utf-8"))
    skills_root = root / "skills"
    skills_root.mkdir(parents=True)
    sys.path.insert(0, str(hermes_repo))

    from tools.skill_manager_tool import skill_manage

    with (
        patch("tools.skill_manager_tool.SKILLS_DIR", skills_root),
        patch("agent.skill_utils.get_all_skills_dirs", return_value=[skills_root]),
        patch("tools.skill_manager_tool._maybe_debounced_sync_push", return_value=None),
    ):
        created = json.loads(skill_manage(
            action="create",
            name=payload["name"],
            content=payload["baseline"],
            task_id="ev1-paired-benchmark",
            session_id="hermes-active-session",
        ))
        if not created.get("success"):
            raise RuntimeError(f"Hermes baseline create failed: {created}")

        active_path = skills_root / payload["name"] / "SKILL.md"
        snapshot_dir = root / "baseline-snapshot"
        shutil.copytree(active_path.parent, snapshot_dir)
        before_hash = sha256(active_path)

        mutated = json.loads(skill_manage(
            action="patch",
            name=payload["name"],
            old_string=payload["oldString"],
            new_string=payload["newString"],
            task_id="ev1-paired-benchmark",
            session_id="hermes-active-session",
        ))
        if not mutated.get("success"):
            raise RuntimeError(f"Hermes active Skill patch failed: {mutated}")
        after_hash = sha256(active_path)

    print(json.dumps({
        "created": True,
        "patched": True,
        "activePath": str(active_path),
        "baselineSnapshot": str(snapshot_dir),
        "beforeHash": before_hash,
        "afterHash": after_hash,
        "sameActivePath": True,
        "activeModifiedInPlace": before_hash != after_hash,
    }, sort_keys=True))


if __name__ == "__main__":
    main()

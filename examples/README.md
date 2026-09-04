# Test fixtures (not user examples)

The directories here are maintainer-owned inputs for deterministic and assembled tests. They are not plugins, Skills to
install, tutorials, or a runtime capability-acquisition source. User installation starts from the root README and suite
manifests.

| Fixture | What it proves |
| --- | --- |
| case-packs/browser-e2e-guidance | Isolated string-level calibration for the EV-1 control-plane slice |
| case-packs/browser-e2e-guidance-assembled | Real DSH loader/Agent/Tool assembly and capability-absent comparison |
| case-packs/cache-safe-status | Host status projection without changing model composition |
| case-packs/dispose-owned-watcher | Cordis-owned listener/timer disposal |
| case-packs/profile-install-remove | Official DSH add/dump/boot/remove lifecycle |
| skills/browser-e2e-baseline | Seed Skill used by the assembled fixtures |

Every fixture is tied to an explicit DSH/evaluator epoch. Changing its tree changes content hashes and invalidates the
evidence that names it; update the runner, tests, manifest epoch, and evidence together. Keep private inputs and secrets out
of this directory.

CI and release checks copy these fixtures through `scripts/prepare-dsh-case-packs.mjs`; removing or renaming one without
migrating those references breaks the acceptance contract. They are intentionally outside the user-facing install surface.

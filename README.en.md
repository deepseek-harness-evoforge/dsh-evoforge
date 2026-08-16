# dsh-evoforge

[中文](README.md) · [Implementation status](docs/status.zh.md) · [Research index](docs/research/README.zh.md)

An out-of-tree extension suite for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). EvoForge adds removable capabilities through supported DSH seams; it is not a DSH fork or a home for core-defect workarounds.

> **Pre-alpha: do not use for automatic activation.** Calibrated Shadow now runs on macOS; a pinned-revision DSH Loader/Agent/Skill/Tool path and the first cache-safe product fixture are green. Two product fixtures and a locally held-out case remain, so P0A has not exited. Generations, activation, rollback, continuity, and UI are not complete.

`dsh-evolve` aims to turn agent self-improvement into an evidence-backed release process:

```text
real outcomes → inactive candidate → sealed paired trial
             → promote / review / reject → future sessions only → rollback
```

The current slice provides deterministic Skill and case-pack hashes, owned-path and symlink boundaries, concurrent-mutation detection, token budgets, explicit incomplete results, known-bad/known-correction calibration, and a sealed paired final test. An opt-in assembled lane verifies the pinned DSH Git revision, mounts it read-only, boots the real Loader and Agent Loop, injects the Skill on demand, completes a real tool round trip, and rejects non-target composition drift. Nothing adds a provider, tool, prompt, or catalog entry to normal DSH sessions, so the current normal-session token and KV-cache delta is zero.

## Verify locally

Requires Node.js `^22.19.0 || >=24` and pnpm `11.7.0`:

```bash
pnpm install
pnpm check
pnpm --filter dsh-evolve pack --pack-destination "$PWD/.evoforge/pack"
```

Read the [Chinese status page](docs/status.zh.md) for the exact implemented/planned boundary, [CONTRIBUTING.md](CONTRIBUTING.md) before proposing a change, and [SECURITY.md](SECURITY.md) for private vulnerability reporting.

Licensed under [MIT](LICENSE).

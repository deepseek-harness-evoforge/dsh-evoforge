# dsh-evoforge

[中文](README.md) · [Implementation status](docs/status.zh.md) · [Research index](docs/research/README.zh.md)

An out-of-tree extension suite for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). EvoForge adds removable capabilities through supported DSH seams; it is not a DSH fork or a home for core-defect workarounds.

> **Pre-alpha: do not use for automatic activation.** The local P0A Shadow gate has passed. P0B implements Local Continuity. P0C.1/P0C.2 add host-only release commands and an asynchronous review-to-inactive-Generation path. Durable pause/resume, automatic-promotion policy, and production multi-day evidence remain incomplete.

`dsh-evolve` aims to turn agent self-improvement into an evidence-backed release process:

```text
real outcomes → inactive candidate → sealed paired trial
             → promote / review / reject → future sessions only → rollback
```

The Shadow lane provides deterministic Skill and case-pack hashes, owned-path and symlink boundaries, concurrent-mutation detection, token budgets, explicit incomplete results, known-bad/known-correction calibration, and a sealed paired final test. Interrupted runs can explicitly `--resume`; an optional resident supervisor scans configured roots and submits only durable, network-free Candidate/Trial recovery to native DSH Jobs. The journal remains authoritative, and an uncertain paid proposal is never retried automatically. Completed evidence appears in a host-only review inbox; approval creates a deterministic owned Git ref and inactive Generation without moving the user's branch, worktree, active pointer, or live Session. Activation remains a separate explicit action. The runtime lane uses DSH Storage Domain plus an Agent-scoped provider backed by verified, read-only Git trees. With no active Generation it adds no model surface. With one active, it reuses DSH's native Skill catalog/body path, freezes that catalog per Session, and never adds an EvoForge Tool or system-prompt fragment. A real two-turn Agent regression proves that promotion preserves the live Session's Tool surface and full prior message prefix.

## Verify locally

Requires Node.js `^22.19.0 || >=24` and pnpm `11.7.0`:

```bash
pnpm install
pnpm check
pnpm --filter dsh-evolve pack --pack-destination "$PWD/.evoforge/pack"
```

Read the [Chinese status page](docs/status.zh.md) for the exact implemented/planned boundary, [CONTRIBUTING.md](CONTRIBUTING.md) before proposing a change, and [SECURITY.md](SECURITY.md) for private vulnerability reporting.

Licensed under [MIT](LICENSE).

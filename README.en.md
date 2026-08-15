# dsh-evoforge

[中文](README.md) · [Implementation status](docs/status.zh.md) · [Research index](docs/research/README.zh.md)

An out-of-tree extension suite for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). EvoForge adds removable capabilities through supported DSH seams; it is not a DSH fork or a home for core-defect workarounds.

> **Pre-alpha: do not use for automatic promotion.** Only the P0A.1 safety tracer and an unwired macOS Sealed Trial primitive are implemented and tested. The complete Trial pipeline, improvement evaluation, generations, promotion, rollback, continuity, and UI are not complete.

`dsh-evolve` aims to turn agent self-improvement into an evidence-backed release process:

```text
real outcomes → inactive candidate → sealed paired trial
             → promote / review / reject → future sessions only → rollback
```

The current tracer provides deterministic Skill and case-pack hashes, owned-path and symlink boundaries, concurrent-mutation detection, token-budget enforcement, minimal evidence, and explicit incomplete results. A separate macOS primitive proves workspace-only reads/writes, denied network and undeclared executables, a clean environment, timeout, and bounded output; it is not wired into `shadow` yet. Nothing adds a provider, tool, prompt, or catalog entry to normal DSH sessions, so the current normal-session token and KV-cache delta is zero.

## Verify locally

Requires Node.js `^22.19.0 || >=24` and pnpm `11.7.0`:

```bash
pnpm install
pnpm check
pnpm --filter dsh-evolve pack --pack-destination "$PWD/.evoforge/pack"
```

Read the [Chinese status page](docs/status.zh.md) for the exact implemented/planned boundary, [CONTRIBUTING.md](CONTRIBUTING.md) before proposing a change, and [SECURITY.md](SECURITY.md) for private vulnerability reporting.

Licensed under [MIT](LICENSE).

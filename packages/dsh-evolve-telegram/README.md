# dsh-evolve-telegram

`dsh-evolve-telegram` sends one durable Telegram notice when `dsh-evolve` has an actionable
Candidate or Evaluator Draft. It solves one concrete gap: evolution may continue in the
background, but a user should not have to keep polling `/evolve status` to discover that a safe
decision is waiting.

The bridge is intentionally small. It reuses the existing `dsh-evolve` control plane and the one
private-chat route already owned by `dsh-telegram`; it does not create a notification platform,
another scheduler, inline approval protocol, or second source of truth.

## What is notified

- a pending Candidate that needs review;
- an automatically approved but still inactive Candidate that needs an explicit promotion
  decision;
- an Evaluator Draft in `uncertain`, `draft-ready`, or `incomplete` state.

Each message contains only a bounded type, safe Skill label, status or recommendation, exact
content id, and the copyable `/evolve` inspection command. It does not include prompts, feedback,
claims, file paths, diffs, credentials, or model output. A notice is attention, never approval;
the original Session keeps running.

## Requirements and installation

Run `dsh-evolve`, `dsh-telegram`, and this package in the same DSH profile. Configure
`dsh-telegram` first with its exact private chat/user allowlist. The bridge has no additional
configuration and is disabled by default in its profile patch.

```bash
pnpm --filter dsh-evolve pack --pack-destination "$PWD/.evoforge/pack"
pnpm --filter dsh-telegram pack --pack-destination "$PWD/.evoforge/pack"
pnpm --filter dsh-evolve-telegram pack --pack-destination "$PWD/.evoforge/pack"

dsh plugin add .evoforge/pack/dsh-evolve-0.1.0-alpha.1.tgz
dsh plugin add .evoforge/pack/dsh-telegram-0.1.0-alpha.1.tgz
dsh plugin add .evoforge/pack/dsh-evolve-telegram-0.1.0-alpha.1.tgz
```

Enable all three rows in the same profile. The bridge consumes the existing Telegram token and
route indirectly; it neither reads nor duplicates that secret.

After a notice arrives, inspect and act through the existing command surface:

```text
/evolve review <candidate-id>
/evolve evaluator <draft-id>
```

There are deliberately no Telegram inline approve, promote, or qualify buttons.

## Delivery and restart semantics

The bridge scans once on load and after the existing evolution supervisor settles. It creates no
timer or watcher. Notice ids are deterministic per exact object and stage, while `dsh-telegram`
persists the send journal. Repeated scans, bridge reloads, and process restarts therefore do not
create a second delivery after a recorded success.

Telegram has no caller-provided idempotency key. If a process or transport fails while a send may
already have reached Telegram, the journal records `uncertain` and does not blindly resend. Only
an explicit Telegram `429 + retry_after` response receives bounded automatic retry.

## KV-cache and token contract

This package registers no Tool, Skill, Prompt, or Command. It performs no model call and does not
change an Agent request, Session composition, or Skill catalog. Normal and idle Session token
increment is `0`. Its integration test serializes the native, Telegram-only, and full bridge DSH
model requests and requires byte equality.

## Deliberate limits

- one existing `dsh-telegram` private-chat route only;
- no generic notification provider or public adapter SPI;
- no polling, digest, escalation, calendar, email, Slack, or multi-recipient routing;
- no inline protected action;
- no claim of production reliability until a real Bot, mobile client, restart, and multi-day soak
  have been independently exercised.

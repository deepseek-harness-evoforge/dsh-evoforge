# ADR-0008: Durable intent before a paid proposal

## Status

Accepted for P0B.2a on 2026-08-16.

## Context

An OpenAI-compatible proposal request is an external, potentially paid effect.
If the process dies after the provider observes the request but before the
response is durable, a local client cannot prove whether the provider charged,
completed, or discarded it. Blind recovery would duplicate a possible paid
effect; pretending it completed would fabricate a Candidate.

Sealed Trials are different: their executor denies network access, confines
writes to an owned temporary workspace, and deletes that workspace. They may be
repeated after interruption without repeating a user-visible external effect.

## Decision

Each explicit Shadow output directory owns one small `run-state.json` journal.
It records the immutable input identity, a deterministic proposal effect id,
the Candidate payload and hash, Trial phase, token usage, and terminal report
reference. Writes use temporary-file fsync, atomic rename, and parent-directory
fsync. The API credential is never stored.

Before the HTTP request, Shadow durably records `proposal-pending` and sends its
effect id as `Idempotency-Key`. If recovery finds that phase without a durable
Candidate, it returns `2 + incomplete` and refuses automatic retry. A provider
may honor the key, but EvoForge does not claim that a generic compatible API
guarantees idempotency.

Once the Candidate and usage are durable, recovery never calls the proposer
again. A `trial-running` run may repeat the sealed paired Trial and then rebuild
the report. A process-owned lock rejects concurrent runners; a later process
may take over a lock only after the recorded PID is no longer alive.

`--resume` is explicit. To retry an uncertain paid effect, the user starts a new
run (and therefore makes a new explicit paid invocation); automatic recovery
does not make that decision.

## Consequences

- Crash recovery is honest about the unavoidable request/response uncertainty
  window and never advertises client-side exactly-once delivery.
- Candidate and Trial continuation require no daemon, queue, Mission, or second
  goal model.
- Run state is host-only and adds zero model-visible prompt, Tool, or catalog
  surface, preserving the KV Cache contract.
- P0B.2a covers explicit offline Shadow recovery. It does not yet prove an
  always-on DSH Job supervisor, multi-day soak, or automatic activation.

## Rejected alternatives

- **Retry every pending request:** may duplicate paid work.
- **Trust `Idempotency-Key` universally:** compatible providers are not required
  to implement identical idempotency semantics.
- **Persist in Session events:** Shadow is offline, and private events would
  damage native replay/removal.
- **Build a workflow database or second daemon:** unnecessary for one bounded
  run and contrary to the project's simplicity boundary.

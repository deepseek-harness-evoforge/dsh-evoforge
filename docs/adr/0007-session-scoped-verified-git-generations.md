# ADR-0007: Session-scoped verified Git Generations

## Status

Accepted for P0B.1 on 2026-08-16.

## Context

Promotion must change a Skill for future DSH Sessions without changing any live
Session, copying mutable Skill bodies into a second database, adding private
events that break native Session replay, or putting evolution state into the
model prefix. DSH already owns Session lifecycle, scoped Skill Providers,
Storage Domain durability, and model-facing Skill presentation.

A manifest-only active pointer is insufficient: a syntactically valid commit or
tree hash may not exist in the configured repository. A provider that reads a
mutable checkout is also insufficient because DSH loads a Skill body on demand;
the body or relative resources could drift after the catalog was first shown.

## Decision

`dsh-evolve` uses one private Storage Domain for content-addressed Generation
manifests, one active pointer, and lifecycle-bound Session pins. The manifest
contains Git commit/tree identities, evaluator/policy versions, and a complete
composition fingerprint; Git remains the content source of truth.

Publication and activation are separate:

1. record an immutable inactive manifest;
2. resolve the configured repository and Skill path;
3. verify the exact full commit and tree object IDs;
4. materialize only non-executable regular files into an owned read-only cache
   and verify every Git blob hash;
5. atomically move the Storage Domain active pointer.

At `agent/session-start`, the plugin starts selecting the lifecycle's
Generation. The first `agent/pre-step` waits for the sidecar pin and scoped
provider registration before the native chain enters the model request. A root
uses the active pointer, resume uses its exact existing pin, and a child uses
its parent's durable pin. Native DSH is itself an explicit durable pin value,
so a Session that starts before the first promotion and all of its children
remain native. Promotion and rollback affect only new, unpinned Sessions. The
provider is registered in the exact Agent scope and is removed with that scope.

Pin or Git integrity failure is fail-closed for the evolved overlay but
fail-open for native DSH: the Session runs without evolved Skills, records a
host diagnostic, and, when its lifecycle pin was already durable, atomically
rewrites that pin to the native baseline so a later cache repair or restart
cannot enable the overlay in the same lifecycle. If Storage itself is the
failure, the diagnostic explicitly says that this fallback could not be
persisted; the live process still never retries the overlay.

No `evolution/*` Session event, Tool, or system-prompt fragment is introduced.
The rebuildable cache is not authoritative and contains an EvoForge owner
marker; an unexpected or corrupted existing cache is rejected rather than
deleted or silently repaired.

## Consequences

- Live Session Skill catalogs and bodies cannot follow the active pointer.
- Native DSH can replay Session and Goal facts after the plugin is removed.
- Rollback restores an exact parent Git tree for future Sessions; rolling back
  the root clears the pointer and returns future Sessions to native DSH. Neither
  operation undoes external effects already produced by an Agent.
- Promotion performs local Git and filesystem work before its one pointer
  write; cached trees make repeated validation cheap.
- P0B accepts only regular non-executable Skill files and caps one tree at
  16 MiB. Executable capability evolution remains a Draft PR/review concern.
- The host service is not an end-user approval surface. P0C still owns review,
  explainability, and explicit human actions; P1 owns narrow auto-promotion.

## Rejected alternatives

- **Write a Generation event into each Session**: plugin removal could make
  native replay reject unknown required events.
- **Read the active Skill directory on demand**: promotion or local edits would
  change a live Session.
- **Copy Skill bodies into the Storage Domain**: duplicates Git authority and
  turns the sidecar into a second content store.
- **Register one process-global Provider**: all live Sessions would observe the
  latest version.
- **Build a second daemon or release coordinator**: DSH/Cordis lifecycle plus
  Storage Domain already provides the necessary single-host boundary.

# EvoForge maintainer instructions

This file is for agents and contributors. It is not the product manual; user-facing installation and behavior belong in
the root README.

## Non-negotiable product model

1. Ship native DeepSeek Harness Cordis/Bundle/Client plugins. DSH is the only Host, Agent runtime, Session, Goal, Skill,
   Tool, Approval, Jobs, Workspace, storage, and lifecycle authority.
2. Treat ordinary DSH conversation events as the primary interaction surface. A native Goal is optional and exists for
   long-running continuation; never describe Goal as the universal entry point.
3. Keep the Gateway resident inside the DSH Host. Adapters own platform protocols and credentials; no second Gateway,
   Session, scheduler, agent loop, database, or approval system.
4. Self-discovery means discovering reusable patterns in DSH-owned experience. It does not mean runtime marketplace search,
   download, import, or external Skill acquisition. External research informs design only.
5. Evolution has three separated authorities: execution, Candidate authoring, and immutable evaluation governance. The
   proposer cannot judge itself. Active Sessions stay pinned; promotion changes future Sessions only.
6. A control surface is one native DSH conversation.view with child slots. It is model-free, lifecycle-owned, and never a
   second website or state authority.

## Required work sequence

Before code or tests:

1. Read CONTEXT.md, docs/requirements.zh.md, docs/plugin-contract.zh.md, applicable ADRs, and
   skills/build-dsh-plugin/SKILL.md before designing or changing a plugin.
2. Fetch and audit the canonical DSH checkout. Record revision, tag/version, dependency state, clean status, install result,
   and build classification. If latest DSH has an upstream build defect, record it and use only the most recent audited
   buildable support revision; never patch DSH or silently call the fallback latest.
3. State the user result, non-goals, authority boundary, cache/composition impact, permission surface, persistence, dispose,
   uninstall, and rollback behavior before implementation.

During implementation:

- Prefer the smallest complete vertical slice through official DSH seams.
- Use Cordis lifecycle effects for every listener, timer, watcher, transport, and subscription.
- Keep secrets in the native DSH CredentialProvider; never write values to profile YAML, Git, logs, Session content, or
  public evidence.
- Use content-addressed Candidate/Generation storage, not Git branches. A Candidate is inactive until independent gates pass.
- Preserve abstain, quarantine, uncertain, crash recovery, idempotency, protected actions, and exact rollback semantics.
- Do not turn fixtures, mocks, model self-evaluation, retries, or one successful run into product claims.

## Git and evidence discipline

- Work only on main; do not create feature/release branches and do not force-push or discard commits.
- Every tested minimal increment is an atomic commit and must be pushed to origin/main. If push fails, record the exact
  failure and do not claim synchronization.
- Runtime Candidates never use Git branches. Create an annotated SemVer tag only after the declared release gates pass.
- Update only the authoritative document whose contract actually changed. Do not touch requirements, ADR, architecture,
  status, roadmap, evidence, and changelog mechanically for every commit. User-visible change goes to the changelog;
  a durable architecture decision goes to one ADR; a meaningful acceptance/release run gets one dated evidence record.
  Evidence states command, revision, scope, result, limitation, and whether it is local, assembled, real-channel, or paired.

## Documentation boundaries

- README.md/README.en.md: user product manual only—what it does, install, first use, channels, Web, upgrade, removal,
  limitations, troubleshooting. No V-number diary, benchmark commands, internal state-machine notes, or maintainer debate.
- docs/getting-started.zh.md: detailed user setup; do not duplicate internal benchmark instructions.
- docs/architecture/, docs/requirements.zh.md, docs/adr/, docs/research/, docs/evidence/, docs/status.zh.md, docs/roadmap.zh.md:
  maintainer design, decisions, research, and proof. Keep one authoritative current statement. Remove superseded design
  from the working tree and rely on Git history; retain only immutable acceptance evidence and explicitly frozen research.
- examples/ and benchmarks/: maintainer-only fixtures and acceptance harnesses. They are not installable examples and must be
  explained by their local README. Delete or rename a fixture only after updating every script, test, hash, and evidence
  reference and regenerating the affected epoch.

## Completion gate

Before reporting completion, run the narrow tests plus pnpm run check:docs, relevant suite/contract checks, and the clean
profile lifecycle appropriate to the change. For release claims also require DSH add/dump/boot/reload/dispose/remove/readback,
single-page browser verification, real channel/provider paths, and same-task/model/permission/budget Hermes paired evidence.
Missing or contradictory evidence is a blocker, not a green result.

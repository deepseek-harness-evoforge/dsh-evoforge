# dsh-evolve

Host-side, evidence-gated Skill evolution for DSH. It observes native interactions and results, records bounded signals,
and manages inactive content-addressed Candidates without creating a second Agent, Session, Goal, approval system,
scheduler, database, or runtime.

## User result

- Ordinary DSH conversation stays unchanged; a Goal is optional and only belongs to DSH long-running continuation.
- Corrections, failed checks, rework, measured outcomes, token/latency/cache facts, and uncertain effects can become
  evidence. A single failure, retry, preference, or model self-score cannot rewrite a Skill.
- Candidate authoring, execution, and evaluation governance are separate. Missing evidence yields `abstain`, `review`,
  or `quarantine`.
- Promotion changes only future Session selection. The active Session remains pinned; canary and rollback are exact
  Host decisions.

The current implementation accepts a model-declared Capability Gap for authoring only after its native Tool call and
completed conversation turn agree. Cancelled, conflicting, and incomplete turns remain ineligible. Ordinary no-Goal
Gap signals still stop at `abstained`; ordinary-chat inspection below records unverified hypotheses separately.
Complete Interaction-episode and improvement-effect proof remain release blockers. See
[current status](../../docs/status.zh.md).

## Install and use

Normal users install the complete product:

```sh
pnpm run dsh:install
```

Use the Evolution surface in the same DSH Web conversation view. The compatibility `core`/`evolution` suites exist only
for old deployments and isolated development. External Skill marketplaces, runtime downloads, and other Agents are not
evolution sources.

### Ordinary-chat correction inspection

A Host administrator may enable bounded post-turn inspection for one native Workspace:

```yaml
conversationCorrectionPolicies:
  - workspaceId: 11111111-1111-4111-8111-111111111111
    maxAttemptsPerUtcDay: 4
```

This is off by default and uses the existing DSH model route and credentials, not another API configuration. It checks
completed follow-ups in a native background Job; it never modifies the current conversation, runs tools, or activates a
Skill. The Evolution view shows **unverified correction hypotheses**, separately from explicit answer feedback.
Hypotheses still need independent evidence. Optional drafting below does not qualify them for Candidate promotion.

An optional `replaySessionIds` list explicitly authorizes inspecting the last two completed turns of those stored Sessions
on startup. Other history is not scanned. The maximum is 20 attempts per UTC day per Workspace, across its Sessions;
each request has a 24,000-byte conversation-input limit, an 800-output-token cap and a 60-second model deadline.
Interrupted/uncertain requests are retained and not automatically resent. Missing usage is not reported as zero cost.
Removing the policy stops new inspection and cancels its in-flight work; raw-free records remain in native Storage.
The intake stores source references and hashes, classifications and measured usage, not message bodies or model quotes.
Only complete, unambiguous v3 turn pairs with a logged model route are supported; unsupported inputs are skipped.
This does not prove the user's correction worked, that two retries are independent examples, or that a Skill improved.

### Inactive Skill drafts from corrections

For a Workspace already authorized for correction inspection, a separate policy can permit draft preparation:

```yaml
conversationLearningPolicies:
  - workspaceId: 11111111-1111-4111-8111-111111111111
    maxModelCallsPerUtcDay: 2
```

One run reserves two auxiliary model calls: prepare four proposed holdout/retention cases, then ask a separate native-model
request for a self-contained Skill draft. The proposer receives the correction, not test inputs, expected answers or
evaluator feedback. Adjacent correction chains use their latest correction; repeated attempts are not independent samples.
The policy is default-off and does not ask the operator to select a Skill, author a test pack, or supply another API key.

The Evolution view lets you inspect inactive draft text. Test material has only schema and positive/negative calibration
checks; it has **not** been run on a real baseline/candidate pair. Drafts have no install, promotion or current-Session
mutation authority and do not enter the old Goal-qualified Candidate pipeline. Generalization and factual correctness of
the proposed checks still need independent verification before any activation path can consume them.

Each run uses at most 4,000 governance output tokens and 2,000 proposer output tokens, with a 60-second deadline per request.
The shared daily reservation limit is 2–20 calls per Workspace; interrupted runs keep their reservation and are not
automatically resumed. The native draft Domain retains up to 100 records and stops rather than deleting idempotency history.
It contains private model-generated drafts/test material and source digests, not copies of conversation messages. Generated
content can still reflect source meaning and should be treated as private and untrusted. Removing the policy cancels owned
work without deleting native history or drafts. It does not remove already spent provider usage.

A Host administrator can authorize one diagnostic retry of a specific uncertain request using the optional
`retryFailedDrafts: [{ draftId, expiresAt }]` field on its learning policy. `expiresAt` is a Unix-millisecond deadline,
at most 24 hours after policy load; expired grants do nothing. The shared daily budget must still have two free slots.
Only a failed original attempt with at most one dispatch and no sealed test material is eligible. Successful drafts,
author-stage failures and retry attempts cannot be selected. Invalid targets fail policy loading.
The new attempt preserves the original record and its budget reservation, and cannot repeat on restart or a new day.
Do not edit/delete the native ledger to retry. The page counts authorized retries separately from independent samples.
Removing the retry grant prevents future dispatch; removing the whole learning policy also cancels owned in-flight work.
Rollback must use a package that understands the persisted retry schema; older readers may reject these records.

Generation receipts are not retained by default. A Host administrator can authorize bounded raw-free retention for an
exact native Workspace in the plugin config:

```yaml
interactionEvidencePolicies:
  - workspaceId: 11111111-1111-4111-8111-111111111111
    retention:
      generationMaxRecords: 1000
```

The maximum is 10,000 resolved records per Workspace, 100 configured Workspaces, and 100,000 records in aggregate.
Removing a policy immediately blocks new writes and positive reads without automatically purging stored evidence. This
setting is Host-admin authorization, not user consent or Session/Episode access permission. It starts a private
historical ledger for a future trusted-Host evidence composer; the current plugin does not automatically consume that
ledger or close any runtime Episode evidence dimension. See the
[plugin contract](../../docs/plugin-contract.zh.md#21-interaction-generation-证据保留策略).

Routing retention is a separate, independently default-denied authority and quota:

```yaml
interactionRoutingEvidencePolicies:
  - workspaceId: 11111111-1111-4111-8111-111111111111
    retention:
      routingMaxRecords: 1000
```

The same 10,000-per-Workspace, 100-policy, and 100,000-record caps apply to this independent ledger. Its only eligible
source is an exactly witnessed successful `report_capability_gap` execution in a matching completed turn. A failed native
`skill` Tool call can also mean policy, loading, cancellation, or execution failure, so it does not create evolution
evidence. Gap authoring eligibility remains independent of this optional retention setting: a Routing-ledger outage cannot
grant or revoke it. The running plugin retains the ledger but does not yet assemble complete Interaction Episodes from it.
See the
[Routing contract](../../docs/plugin-contract.zh.md#22-interaction-routing-证据保留策略).

## Remove

```sh
dsh plugin --profile web remove dsh-evolve
```

Remove `dsh-evolve-web` first if that Client adapter is installed. Native Session/Goal/Workspace data and external effects
remain. Design and claim boundaries are in [evolution design](../../docs/architecture/evolution-design.zh.md) and the
[Hermes scorecard](../../docs/architecture/hermes-replacement-scorecard.zh.md).

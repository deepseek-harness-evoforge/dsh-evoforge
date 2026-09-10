# Acceptance harnesses (not plugins)

This directory contains maintainer-only runners. Nothing here is installed into DSH and no benchmark result is a product
claim by itself.

| Area | Scope | Network/effect |
| --- | --- | --- |
| hermes-v0.1/ev1-control-plane | Candidate isolation, evaluation governance, and rollback slice | deterministic; current EV-1 epoch 4 plus immutable historical epochs |
| hermes-v0.1/sd1-completion-control | Software-delivery completion gate | deterministic Hermes paired slice |
| hermes-v0.1/lc1-crash-recovery | Session/Goal cold recovery | deterministic Hermes paired slice |
| hermes-v0.1/as1-telegram-approval | Telegram approval flow | deterministic local harness; external run requires explicit authorization |
| provider-v0.1/rp1-internal-skill-evolution | Frozen epoch-2 manifest and deterministic qualified Gap-to-Opportunity fixture; immutable historical epoch 1 | current paid runtime hard-blocked before provider configuration |
| feishu-v0.1/as2-real-channel | Real Feishu pairing and delivery contract | external; credentials never stored here |
| telegram-v0.1/as1-real-channel | Real Telegram pairing and delivery contract | external; credentials never stored here |

Manifest and result files are immutable epoch inputs for the scripts in the root package.json. A current file may only be
replaced by a newly named epoch after all references and evidence are updated. Do not delete an old epoch just to make the
directory look smaller; move it to an explicit archive only after the runner and release-gate references have been migrated.

`pnpm benchmark:provider:rp1` targets the explicitly named RP-1 epoch-2 runner. Its deterministic check pins the full
manifest and proves only that five qualified model-declared Gap fixtures yield one Opportunity. The manifest describes a
planned two-provider scenario; neither it nor the fixtures prove live AgentLoop/routing-ledger provenance or paid execution.
The current runner has no `ready`/`passed` path: without approval it exits 2 as `not-run`, and exact approval exits 1 with
`paid-provider-execution-blocked:runtime-attestation-incomplete` before reading provider configuration or private paths.
The original RP-1 `manifest.json`, contract, execution, and runner remain immutable historical epoch-1 evidence and are not
called or silently relabeled as proof of the current contract.

Run a harness only with the exact DSH and Hermes revisions recorded in its manifest. A deterministic pass is not evidence of
real provider quality, real channel delivery, or an overall Hermes replacement.

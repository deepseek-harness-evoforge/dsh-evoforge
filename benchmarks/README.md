# Acceptance harnesses (not plugins)

This directory contains maintainer-only runners. Nothing here is installed into DSH and no benchmark result is a product
claim by itself.

| Area | Scope | Network/effect |
| --- | --- | --- |
| hermes-v0.1/ev1-control-plane | Candidate isolation, evaluation governance, and rollback slice | deterministic; current EV-1 epoch 4 plus immutable historical epochs |
| hermes-v0.1/sd1-completion-control | Software-delivery completion gate | deterministic Hermes paired slice |
| hermes-v0.1/lc1-crash-recovery | Session/Goal cold recovery | deterministic Hermes paired slice |
| hermes-v0.1/as1-telegram-approval | Telegram approval flow | deterministic local harness; external run requires explicit authorization |
| provider-v0.1/rp1-internal-skill-evolution | Two-provider evolution acceptance | paid/external; default not-run |
| feishu-v0.1/as2-real-channel | Real Feishu pairing and delivery contract | external; credentials never stored here |
| telegram-v0.1/as1-real-channel | Real Telegram pairing and delivery contract | external; credentials never stored here |

Manifest and result files are immutable epoch inputs for the scripts in the root package.json. A current file may only be
replaced by a newly named epoch after all references and evidence are updated. Do not delete an old epoch just to make the
directory look smaller; move it to an explicit archive only after the runner and release-gate references have been migrated.

Run a harness only with the exact DSH and Hermes revisions recorded in its manifest. A deterministic pass is not evidence of
real provider quality, real channel delivery, or an overall Hermes replacement.

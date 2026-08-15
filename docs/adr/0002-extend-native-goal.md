# Extend the native DSH Goal instead of adding Mission

EvoForge keeps DSH Goal as the only user-visible long-running objective. Reliability features may validate completion, preserve a compact continuation checkpoint, or resume that same Goal after a local process failure, but they do not add Mission, a second goal identity, a task graph, or a parallel workflow database; this preserves DSH's user model and makes each enhancement independently removable.

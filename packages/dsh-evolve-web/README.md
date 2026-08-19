# dsh-evolve-web

`dsh-evolve-web` is the browser client adapter for `dsh-evolve`. It is loaded by the existing DSH Web Host through official `dsh.client` metadata. It does not start a server, bind a port, run an Agent, or store a second copy of control state.

Install both Bundles into the same profile:

```sh
dsh plugin --profile web add \
  /absolute/path/dsh-evolve-0.1.0-alpha.1.tgz \
  /absolute/path/dsh-evolve-web-0.1.0-alpha.1.tgz
dsh --profile web
```

The Host half only waits for `evoforge.evolutionControl`; the browser module renders the global sidebar and calls the generated DSH Remote. Reads and actions therefore reach the same Host authority used by `/evolve` Commands. It adds no Tool, Skill, system prompt, watcher, polling loop, or persistent state.

The beginner view points to DSH's native answer-feedback controls: mark an answer as bad, add a note explaining the error and correct result, then save. Feedback is counted separately from actionable reviews. The system attributes and clusters that internal evidence autonomously; it never asks the user to choose a Shadow, evaluator, Skill, Agent, or route. If independent evaluation governance is unavailable, the panel keeps the correction recorded and reports the missing governance instead of presenting false progress.

The panel derives its exact Workspace only from the currently selected native DSH Session through
the standard `useSessions` and `useWorkspaces` slot hooks. It passes that Workspace id on every
Remote read and action, clears state when selection moves between Workspaces, rejects mismatched
responses, and fails closed when the current Session has no registered Workspace. It never falls
back to the recent Workspace.

The advanced view also renders the Host-authoritative Delivery Outcome summary. It shows bounded
Workspace/current/baseline rollups plus at most 20 recent measured outcomes: measured versus
unmeasured counts, uncached input/output, cache read/write, LLM/tool/TTFT latency, active
wall time, attributed turns, and closed steps. Missing measurements stay explicitly unmeasured.
When DSH does not project provider prices, the UI reports monetary cost as unavailable instead of
estimating it. These observations are non-causal and do not affect Opportunity eligibility,
evaluation, promotion, or rollback. A failed refresh keeps the last successful snapshot visible,
shows the transport failure, and replaces it only after a later successful Host read.

Unload/remove the adapter before its provider:

```sh
dsh plugin --profile web remove dsh-evolve-web dsh-evolve
```

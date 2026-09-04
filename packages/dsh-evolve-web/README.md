# dsh-evolve-web

`dsh-evolve-web` is the browser client adapter for `dsh-evolve`. It is loaded by the existing DSH Web Host through official `dsh.client` metadata. It does not start a server, bind a port, run an Agent, or store a second copy of control state.

Install both Bundles into the same profile:

```sh
dsh plugin --profile web add \
  /absolute/path/dsh-evolve-0.1.0-alpha.1.tgz \
  /absolute/path/dsh-evolve-web-0.1.0-alpha.1.tgz
dsh --profile web --no-open
```

The Host half only waits for `evoforge.evolutionControl`; the browser module contributes an evolution Surface to the native `dsh-control-center` `conversation.view` and calls the generated DSH Remote. Reads and actions therefore reach the same Host authority used by `/evolve` Commands. It adds no Tool, Skill, system prompt, watcher, polling loop, or persistent state. The old sidebar wrapper remains only as an inline compatibility export; it is not an active registration path and no fixed overlay CSS is shipped.

The beginner view points to DSH's native answer-feedback controls: mark an answer as bad, add a note explaining the error and correct result, then save. Feedback is counted separately from actionable reviews. The system attributes and clusters that internal evidence autonomously; it never asks the user to choose a Shadow, evaluator, Skill, Agent, or route. If independent evaluation governance is unavailable, the Control Center Surface keeps the correction recorded and reports the missing governance instead of presenting false progress.

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

The Skills view also renders bounded existing-Skill baseline/Candidate diffs, protected
Admission/Holdout/Retention identities, inactive release decisions, future-Session activation,
and failed-Outcome Canary evidence. Approve, promote, and Canary rollback are separate confirmed
actions against the generated Host Remote. The browser never writes Generation state directly;
the rollback button appears only while the terminal Canary still names the exact active
Generation. After rollback, the historical Canary remains visible for audit while the action is
removed. The final packed pair has been verified through Host outage, recovery, full-page reload,
process restart, and official DSH uninstall with zero browser console errors.

The advanced view also renders the Host-authoritative Generation selection timeline. It shows the
bounded promotion/rollback counts, exact prior and selected Generation, and the authority/evidence
ids retained atomically with each pointer mutation. It explicitly makes no outcome claim and grants
no release authority. Final tarballs have been verified through real Web promotion, full-page reload,
Host cold restart, exact Canary rollback, another reload/restart, official uninstall, and native-Web
readback with zero console errors.

Each selection row also shows a Host-authoritative bounded post-selection Outcome window. Retained
Outcomes strictly inside the selection epoch are grouped by their Session-pinned selected, previous,
or other Generation, with Goal/result and token/cache/latency/active-wall rollups. Equal-boundary
facts remain ambiguous and non-monotonic event time abstains. The view explicitly has no causal claim
or mutation authority. Final tarballs have verified real Session Outcomes, outage snapshot retention,
two cold recoveries, full-page reload, official uninstall, and native-Web readback.

Unload/remove the adapter before its provider:

```sh
dsh plugin --profile web remove dsh-evolve-web dsh-evolve
```

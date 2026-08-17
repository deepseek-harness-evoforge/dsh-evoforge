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

The panel derives its exact Workspace only from the currently selected native DSH Session through
the standard `useSessions` and `useWorkspaces` slot hooks. It passes that Workspace id on every
Remote read and action, clears state when selection moves between Workspaces, rejects mismatched
responses, and fails closed when the current Session has no registered Workspace. It never falls
back to the recent Workspace.

Unload/remove the adapter before its provider:

```sh
dsh plugin --profile web remove dsh-evolve-web dsh-evolve
```

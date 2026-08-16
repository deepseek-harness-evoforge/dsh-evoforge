# dsh-software-delivery

`dsh-software-delivery` is a removable DeepSeek Harness extension for finishing a native DSH Goal as a reviewable Git artifact. It contributes one on-demand `software-delivery` Skill, one stable `complete_delivery` Tool when its native dependencies are present, and the standalone deterministic `dsh-delivery verify` command.

The intended path is:

```text
native DSH Goal → linked worktree → repository change and checks
                → clean commit → verification report → optional Draft PR
```

It does not add a second Goal, workflow database, daemon, policy engine, or system-prompt fragment.

## Install and compose

This package is a normal Cordis runtime plugin, not a profile-mutating Bundle. After installing it into a DSH profile, compose the native Skill registry and this plugin:

```yaml
- id: skill
  name: '@deepseek-ai/dsh-skill'
- id: dsh-software-delivery
  name: dsh-software-delivery
```

The stable Skill name and description appear in DSH's native catalog. Its body is loaded only when the user invokes it or the Agent calls the existing `skill` Tool.

When the composition also provides native Goal, `update_goal`, and `bash` (or `pwsh` on Windows), the plugin registers one fixed-schema `complete_delivery` Tool. It verifies the exact Goal id/revision and Git commit, delegates checks through the existing shell Tool, and calls native `update_goal complete` only after every check passes. Plugin order is irrelevant; the Tool follows dependency availability and is removed with the plugin.

## Verify a delivery

Create a trusted local JSON config outside the worktree, or use an already-reviewed tracked config:

```json
{
  "schemaVersion": 1,
  "baseRef": "main",
  "checks": [
    { "name": "test", "argv": ["pnpm", "test"] },
    { "name": "typecheck", "argv": ["pnpm", "typecheck"] }
  ]
}
```

Then run:

```bash
dsh-delivery verify \
  --worktree /absolute/path/to/linked-worktree \
  --config /absolute/path/to/delivery.json
```

Exit status `0` means `passed`, `1` means `failed`, and `2` means invalid or `unknown`. The JSON result contains only the three-state result, a concise reason, the exact commit artifact, repository evidence, and bounded/hash-addressed check output.

The verifier requires a named branch, a linked worktree rather than the primary checkout, an exact base ancestor, at least one committed change, and a clean tree before and after all checks. Standalone commands are exact argv arrays and never pass through a shell. Child processes receive a temporary HOME and an allowlisted environment, so ordinary credential environment variables are not inherited.

## Trust and authority

Verification configs are trusted local execution input, not untrusted repository data. The standalone CLI is not a sandbox. The integrated Tool delegates checks to DSH's native shell Tool, so its existing sandbox, approval, and Tool guards remain authoritative. Review checks and keep them repository-scoped. Merge, release, production deployment, secret access, paid calls, and irreversible external actions still require native DSH approval or an explicit deployment policy.

The plugin does not globally intercept native Goal completion: a human or another native path can still call `update_goal` directly. Instead it provides one atomic, evidence-gated completion path without monkey-patching GoalService or building a second state machine. It does not yet push a branch, call GitHub, or feed outcomes to Evolve. Those are later slices.

## Cache surface

The Skill body remains on demand. In a fully integrated composition, one stable Tool schema is added and tested at no more than 2 KiB serialized JSON; its name, schema, and order stay unchanged across repeated model calls. A successful invocation returns compact commit/check hashes. Failure previews are bounded to 4 KiB. Exact token counts depend on the active tokenizer, so the repository asserts bytes and full-request equality rather than claiming a tokenizer-independent number.

## Develop

```bash
pnpm --filter dsh-software-delivery typecheck
pnpm --filter dsh-software-delivery test
pnpm --filter dsh-software-delivery build
pnpm --filter dsh-software-delivery pack --pack-destination /tmp/dsh-pack
```

The macOS assembled lane boots pinned DSH Skill, Goal, native Bash, ToolGoal, and Agent runtime with a keyless scripted adapter, then tests the packed install/remove boundary and built CLI against a real Git worktree.

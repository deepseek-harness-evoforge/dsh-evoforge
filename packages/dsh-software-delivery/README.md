# dsh-software-delivery

`dsh-software-delivery` is a removable DeepSeek Harness extension for finishing a native DSH Goal as a reviewable Git artifact. It contributes one on-demand `software-delivery` Skill and the deterministic `dsh-delivery verify` command.

The intended path is:

```text
native DSH Goal → linked worktree → repository change and checks
                → clean commit → verification report → optional Draft PR
```

It does not add a second Goal, workflow database, daemon, model Tool, or system-prompt fragment.

## Install and compose

This package is a normal Cordis runtime plugin, not a profile-mutating Bundle. After installing it into a DSH profile, compose the native Skill registry and this plugin:

```yaml
- id: skill
  name: '@deepseek-ai/dsh-skill'
- id: dsh-software-delivery
  name: dsh-software-delivery
```

The stable Skill name and description appear in DSH's native catalog. Its body is loaded only when the user invokes it or the Agent calls the existing `skill` Tool.

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

The verifier requires a named branch, a linked worktree rather than the primary checkout, an exact base ancestor, at least one committed change, and a clean tree before and after all checks. Commands are exact argv arrays and never pass through a shell. Child processes receive a temporary HOME and an allowlisted environment, so ordinary credential environment variables are not inherited.

## Trust and authority

Verification configs are trusted local execution input, not untrusted repository data. The verifier is not a sandbox: configured programs retain the filesystem and network authority of the surrounding DSH Shell/Sandbox process. Review the config and keep it to repository checks. Merge, release, production deployment, secret access, paid calls, and irreversible external actions still require native DSH approval or an explicit deployment policy.

The first slice does not intercept native Goal completion, push a branch, or call GitHub itself. The Skill uses DSH's existing Shell and Goal behavior; `dsh-delivery` supplies objective commit/check evidence. Draft PR automation and an Evolve outcome adapter are later slices, after this minimal result contract has real usage evidence.

## Develop

```bash
pnpm --filter dsh-software-delivery typecheck
pnpm --filter dsh-software-delivery test
pnpm --filter dsh-software-delivery build
pnpm --filter dsh-software-delivery pack --pack-destination /tmp/dsh-pack
```

The macOS assembled lane boots the pinned DSH Skill, Goal, Tool, and Agent runtime with a keyless scripted adapter, then tests the packed install/remove boundary and built CLI against a real Git worktree.

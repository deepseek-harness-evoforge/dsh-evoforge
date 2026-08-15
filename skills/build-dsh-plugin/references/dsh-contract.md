# DSH Contract Reference

Load this reference only for runtime, Bundle, Tool, Client, or model-surface work. Verify all paths against the target DSH revision.

## Official anchors

| Question | DSH source/doc |
|---|---|
| Plugin form and `apply` | `docs/cordis-tutorial/01-first-plugin.md` |
| Effect ownership and dispose | `docs/cordis-tutorial/02-lifecycle-and-effects.md` |
| `Service`, `inject`, optional dependency | `docs/cordis-tutorial/03-services.md` |
| Events and waterfall semantics | `docs/cordis-tutorial/04-events.md`, `docs/cordis-primer.md` |
| Runtime `Config` schema | `docs/cordis-tutorial/05-config.md` |
| HMR and composition | `docs/cordis-tutorial/06-composition-and-hmr.md` |
| Tool registration and execution | `docs/cordis-tutorial/07-into-the-harness.md` |
| Profile, Bundle, install, dump | `apps/cli/reference/README.md`, `packages/boot/app-boot/README.md` |
| Available service/event seams | `docs/capability-seams.md`, `docs/subsystems/*` |
| Tool UI and tests | `docs/cookbook/adding-a-tool.md`, `docs/testing.md` |

## Runtime skeleton

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'evoforge-example'
export const inject = ['requiredService']

export interface Config {
  enabled: boolean
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
})

export function apply(ctx: Context, config: Config) {
  if (!config.enabled) return
  // DSH/Cordis registrations are already effects.
  // Wrap only resources not owned by a registration API.
  ctx.effect(() => {
    const resource = acquireOwnedResource()
    return () => resource.dispose()
  })
}
```

Use `.ts` on local relative ESM imports. Add declaration merging only for actual typed services/events. Use a function plugin until a public Service is justified.

## Bundle manifest slice

Only an install-and-activate Bundle declares `dsh.bundle`:

```json
{
  "type": "module",
  "exports": {
    ".": {
      "types": "./lib/types/index.d.ts",
      "default": "./lib/index.js"
    },
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "files": ["lib/**/*.js", "lib/types/**/*.d.ts", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

An installed dependency without `dsh.bundle` remains a library/plain plugin and is not added to the profile layer automatically.

## Model-surface audit

Capture these values before and after the plugin:

```text
system sections: names, order, rendered bytes/hash
tools: names, order, descriptions, JSON Schemas/hash
skills: catalog names, descriptions, order/hash
request: provider/model/parameters and complete stable-prefix hash
usage: input, cache-read, cache-write, output tokens
```

Host-only plugins should leave the normal request fingerprint unchanged. A Tool registration changes both schema and system composition in DSH; direct `ctx.tools.execute()` tests must go through the real registry pipeline.

## Review evidence template

```text
Outcome:
Non-goals:
DSH revision/range:
Plugin form and package:
Required/optional services:
Events and owned resources:
Model surface/cache delta:
Permissions/external effects:
Durable state/recovery:
UI/actions:
Tests run/results:
Install/uninstall result:
Known limitations:
```

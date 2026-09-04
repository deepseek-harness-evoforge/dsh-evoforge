# DeepSeek Harness EvoForge

EvoForge is a suite of native Cordis/Bundle/Client plugins for
[DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness). It adds a resident messaging Gateway,
Feishu and Telegram adapters, verifiable Skill evolution, software delivery, and one shared Web control surface.

It is not a Codex plugin and does not replace or fork DSH. DSH remains the authority for Agents, Sessions, Goals,
Skills, Tools, Approvals, Jobs, Workspaces, permissions, and storage.

## Current capabilities

- **Resident Gateway:** pairing, exact routing, durable delivery, rate limits, recovery, and uncertain external effects
  inside the existing DSH Host.
- **Feishu and Telegram:** independently disabled and removable adapters. An unknown direct message receives a pairing
  code; only the next message after approval enters an existing DSH Session.
- **Verifiable evolution:** corrections, failures, checks, and outcomes become evidence. Inactive Candidates are isolated
  from current Skills and must pass independent gates before future Sessions can use them.
- **One control surface:** Gateway, Channels, Evolution, Doctor, and other installed modules share one native DSH Web view.
- **Optional delivery and continuity:** isolated software delivery, Draft PR support, native Goal cold resume, and a
  user-level resident service are separate add-ons.

This project is **pre-alpha**. Local contracts and some assembled paths pass, but registry publishing, long-running real
channels, real-provider evolution, and the complete Hermes paired benchmark do not. EvoForge therefore makes no overall
replacement claim yet. See [current status](docs/status.zh.md).

## Install

Use Node.js 22, pnpm 11, a working DSH CLI, and a writable profile. Registry packages are not published yet. From this
repository root, run:

```sh
pnpm install --frozen-lockfile && pnpm run dsh:install
```

The default `product` suite installs Evolution, Doctor, Control Center, Gateway, Feishu, and Telegram together. Gateway
loads immediately; platform adapters remain disabled until credentials and routes are configured. The installer verifies
exact tarballs from its manifest and keeps DSH's local package dependencies in a persistent user data directory. It does
not use directory globs, print the effective profile, or approve and run dependency install scripts on the user's behalf.

The shell command changes the selected DSH profile and is not itself a DSH Agent Approval. When a DSH Agent invokes it
through Shell, that Agent's native Tool policy and Approval still apply. OS-service changes such as `/resident apply`
remain separate confirmed actions.

One-line request for an Agent:

> In the current dsh-evoforge repository, audit the latest DSH and the active profile, then run `pnpm install --frozen-lockfile && pnpm run dsh:install` to install the complete default product. Do not print credentials or the effective config; reuse the existing single Host/Web page, verify that Bundles are visible and the Host boots, and preserve recoverable install artifacts with an exact blocker if anything fails.

Until a public registry release exists, the Agent must run the repository installer rather than guessing package names.
Advanced suites and custom profiles are documented in the [installation guide](docs/getting-started.zh.md).

## Start and first use

Start one DSH Host:

```sh
dsh --profile web --no-open
```

Open the full URL printed by DSH, including `?token=...`; the bare port returns 401. Reload that same tab instead of
starting another Host. Open or create a native Session before expecting the Session-scoped control view to appear.

Use DSH normally: chat, attach supported material, or correct a result. There is no separate evolution workflow to start.
A native Goal is only needed when the user wants DSH's long-running continuation. Evolution runs beside the conversation;
one failure, retry, or model self-score cannot rewrite a Skill, and an active Session never switches Generation mid-run.

## Feishu pairing

Explicitly enable `evoforge-feishu` in the DSH profile with pairing mode, and save the App ID and App Secret through the
DSH CredentialProvider. Never put cleartext credentials in YAML, logs, or Git. Then:

1. The user sends any direct message. Gateway returns a one-time code and does not dispatch that first message.
2. An administrator selects an existing Workspace/Session in the same DSH Web **Channels** view and approves it.
3. The user's next message enters that native Session.

The exact profile fragment, platform permissions, Telegram setup, and recovery steps are in the
[installation guide](docs/getting-started.zh.md).

## Upgrade and removal

Run the same installer again for a local upgrade. Remove packages with DSH's official `plugin remove` using the names in
the persistent install manifest. Removal does not delete native Session/Goal/Workspace data or undo external effects.
If `dsh-resident` created an OS service, remove that service explicitly with `/resident remove` first.

For support, run `/doctor` inside a DSH Session. Never post a complete `--dump-config`, credential, token, real message,
or private evaluation sample in an issue.

- [Installation and configuration](docs/getting-started.zh.md)
- [Capability suites](docs/capability-suites.zh.md)
- [Product design](docs/architecture/product-target-and-design.zh.md)
- [Evolution design](docs/architecture/evolution-design.zh.md)
- [Current status](docs/status.zh.md)
- [Contributing](CONTRIBUTING.md)

License: MIT.

# dsh-evolve-attention

Optional bridge that sends a bounded Feishu or Telegram notice when an Evolution Candidate needs review or an inactive
promotion needs attention. A notice is never approval and contains no prompt, feedback, diff, credential, private path,
or model output.

## Install

Install the default product and configure at least one exact channel route, then add the optional bridge:

```sh
pnpm run dsh:install
pnpm run dsh:install -- --suite attention
```

The bridge has no recipient registry or second Gateway. It uses only routes already authorized by Feishu/Telegram and
deduplicates through the shared Gateway journal. Ambiguous sends remain `uncertain`.

Inspect and decide in the existing DSH control surface or `/evolve`; channel messages contain no inline approve/promote
button. The package registers no Tool, Skill, Prompt, or model call, and creates no polling worker.

Current real-channel soak is still a release gate.

## Remove

```sh
dsh plugin --profile web remove dsh-evolve-attention
```

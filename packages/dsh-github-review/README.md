# dsh-github-review

`dsh-github-review` closes one software-delivery loop: after `dsh-software-delivery` creates or updates a Draft PR, an allowlisted GitHub reviewer can request changes on that exact head and the originating DSH Session receives one bounded follow-up. The Agent may continue the same native Goal, verify the change, commit, and update the same Draft PR.

The plugin does not merge, mark a PR ready, release, deploy, read a secret by default, or create a second workflow. Review text is always framed as untrusted external data. Reviewer allowlisting permits attention; it does not grant Protected Action authority.

## Install

```bash
PACK_ROOT="$(mktemp -d)"
pnpm run pack:suite -- --suite delivery --out "$PACK_ROOT"
dsh plugin --profile web add "$PACK_ROOT/delivery"/*.tgz
dsh --profile web --no-open
```

The registry package is not published yet; the command above uses the repository's reproducible local tarballs. Once a
project-owned registry namespace is released, the install spec will be updated together with the release tag.

The Bundle installs disabled. Enable its exact Loader entry only after configuring one Agent, one repository, and at least one human reviewer:

```yaml
- id: evoforge-github-review
  disabled: false
  config:
    agentId: main
    owner: your-org
    repo: your-repo
    trustedReviewers:
      - maintainer-login
```

The public-repository path uses GitHub's read-only REST endpoints without a credential. A private repository requires an explicit deployment policy:

```yaml
    tokenEnv: DSH_GITHUB_REVIEW_TOKEN
```

Setting `tokenEnv` authorizes this plugin to read that environment variable. Use a fine-grained token with Pull requests: read and no write permission. The token is never copied into DSH Session, Storage, logs, follow-up text, or model input.

Remove the plugin with:

```bash
dsh plugin --profile web remove dsh-github-review
```

## Required composition

- the configured stable DSH Agent/Session;
- DSH Storage Domain;
- `dsh-software-delivery` on that Agent so its canonical `complete_delivery` result can register the current Draft PR;
- network policy permitting read-only access to `https://api.github.com`.

Only the configured Agent's most recent passed Draft PR delivery is polled. A later `complete_delivery` result atomically replaces the previous PR/head watch, so long-running use does not accumulate historical poll targets.

## Trigger contract

A follow-up is appended only when all gates pass:

- `complete_delivery` returned `passed`, completed the native Goal, and reported the same commit in the local artifact and Draft PR artifact;
- GitHub returned `CHANGES_REQUESTED` from an allowlisted human reviewer;
- the review `commit_id` is the exact watched head;
- the review and its inline comments fit the bounded, valid GitHub response contract;
- the configured Agent still owns the originating Session and current watch.

`APPROVED`, `COMMENTED`, Bot, untrusted reviewer, stale head, malformed, paginated-over-limit, rate-limited, or uncertain responses do not enter the Session. The next scan may recover a transient read failure; it never interprets missing data as approval.

## Durability

The DSH Storage Domain holds one current watch and content-addressed follow-up records. The order is:

```text
GitHub read
  -> durable prepared
  -> native Agent.followup
  -> durable delivered
  -> conditional-read ETag
```

If the process exits after `Agent.followup` but before settlement, restart checks the deterministic message id in the native Inbox/Session and settles without appending a duplicate. A newer Draft PR head marks an undelivered old-head record `superseded` rather than injecting stale review text.

Prepared records remain until delivery or supersession. Terminal `delivered`/`superseded` history is capped at 1,000 records, while one exact Agent + repository has only one current watch. Review and inline-comment links are reconstructed from validated identifiers instead of trusting API-provided URLs.

Polling defaults to 300 seconds, each request times out after 20 seconds, and responses use stable versioned URLs plus ETag conditional reads. The first release intentionally fails closed above 100 reviews or 100 inline comments per actionable review instead of building an unbounded review platform.

## Cache and token contract

The plugin registers 0 Tool, 0 Skill, 0 Prompt, and 0 System Message. With no actionable review, it performs 0 model calls and contributes 0 Session tokens. Real assembled-DSH tests compare the complete normal model request with and without the plugin and require byte-equivalent composition.

An actionable review adds one new bounded user message at the end of the existing Session. It does not rewrite the cached prefix or mutate the Session's Tool Schema. The only new model tokens are that review summary and the normal continuation turn it intentionally triggers.

## Configuration limits

| Field | Default | Limit |
|---|---:|---:|
| `pollIntervalSeconds` | `300` | `60..3600` |
| `requestTimeoutSeconds` | `20` | `1..60` |
| `maxTextChars` | `6000` | `1024..6000` |
| `maxComments` | `20` | `1..20` |
| `trustedReviewers` | required | `1..20`, unique GitHub logins |

`apiBase` accepts only official GitHub HTTPS or loopback HTTP(S) for local tests. GitHub Enterprise, webhooks, GitHub Apps, issue comments, CI diagnosis, automatic review trust, and automatic merge are not included in this slice.

See [P3.2 architecture](../../docs/architecture/p3-2-github-review-followup.zh.md), [ADR-0042](../../docs/adr/0042-github-review-reenters-the-originating-session-as-untrusted-data.md), and the [implementation evidence](../../docs/evidence/p3-2-github-review-followup.zh.md).

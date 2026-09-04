# dsh-gateway

Distribution name: `dsh-evoforge-gateway`.

The resident, transport-neutral Gateway inside the existing DSH Host. It owns pairing, exact Workspace/Session routing,
ingress deduplication, durable outbound intent, rate limits, uncertain effects, and recovery. Platform SDKs and credentials
remain in Feishu/Telegram adapters.

Gateway does not create an Agent Runtime, Session, Goal, Approval, scheduler, database, Web server, or separate process.

## Install

Normal users receive Gateway in the complete product:

```sh
pnpm run dsh:install
```

It loads with `routes: []`; that is resident and safe but sends nothing. The `gateway` suite is only for developing another
adapter against the seam.

## Pairing and routes

An unknown direct message is consumed before Agent dispatch and receives a one-time pairing code. An administrator approves
the exact principal in the same DSH Web Channels surface and binds an existing Workspace/Session. Only the next message is
dispatched. Expiry, replay, ownership mismatch, or missing live Session fails closed.

A static route must specify exact account, conversation/user, Workspace, Session, Agent preset, provider, and model. Wildcard
or model-selected routing is rejected.

## Reliability and Web

- Ingress identity and outbound intent are durable before effects; duplicate identity drift is rejected.
- Only an explicit rate-limit response permits bounded retry. Timeout, crash, or ambiguous send becomes `uncertain`.
- Cordis owns every listener, transport, and timer; disable/reload/remove releases them.
- The shared Control Center shows redacted transport, pairing, route, delivery, and failure state without message bodies,
  credentials, private paths, or another state store.

## Remove

Remove platform adapters first, then:

```sh
dsh plugin --profile web remove dsh-evoforge-gateway
```

Native DSH data and completed external effects remain.

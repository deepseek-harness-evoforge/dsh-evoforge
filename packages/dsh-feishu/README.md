# dsh-evoforge-feishu

Thin Feishu adapter for the resident `dsh-gateway`. It owns the official WebSocket SDK, platform payloads, credentials,
cards/attachments, and sends; Gateway owns pairing, routing, delivery journal, and DSH Session identity.

## Install and enable

Normal users install the complete product:

```sh
pnpm run dsh:install
```

The adapter is installed disabled. Enable it with a DSH profile override:

```yaml
- id: evoforge-feishu
  name: dsh-evoforge-feishu
  disabled: false
  config:
    mode: pairing
    routeIds: []
    appIdEnv: DSH_FEISHU_APP_ID
    appSecretEnv: DSH_FEISHU_APP_SECRET
```

The `Env` suffix is legacy naming: these values are DSH CredentialProvider reference names, not cleartext environment
values. After the Host loads, save App ID/Secret in the same Control Center. Never put credentials in YAML, Git, logs, or
Session content.

Enable the Feishu bot, long-connection `im.message.receive_v1`, and send permission, then publish the app version. Missing
credentials or permissions stay visible as waiting/attention rather than faking readiness.

## Pairing and content

The first unknown direct message returns a one-time code and does not enter the Agent. Approve it in DSH Web Channels by
binding an existing Workspace/Session; the next message enters that Session. No manual `chat_id`/`open_id` is needed.

Pairing grants only the minimal message path. Group chat, images, files, Docs, Wiki, Drive, and Bitable require an exact
route plus individually enabled `contentPermissions`, platform scopes, and the applicable DSH Attachment/Tool/Approval
contract. Unsupported content is rejected explicitly.

Ambiguous sends become `uncertain`; only explicit 429 evidence can trigger bounded retry. Disable/reload/remove closes the
WebSocket. Health, pairing, permission, and delivery state appear in the shared DSH page without secrets or message bodies.

Current real-channel limitations are in [status](../../docs/status.zh.md).

## Remove

```sh
dsh plugin --profile web remove dsh-evoforge-feishu
```

Removal stops Feishu transport; native Session/Workspace data and already-sent messages remain.

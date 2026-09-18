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

Binding does not subscribe Feishu to every Web reply. Ordinary Web/local turns stay local, including their approval
requests. If local input is inserted into an ongoing Feishu turn, that mixed turn is not automatically sent to Feishu;
read its result in Web. Native scheduled continuations on a unique bound route retain their existing delivery behavior.

Pairing grants only the minimal message path. Group chat, images, files, Docs, Wiki, Drive, and Bitable require an exact
route plus individually enabled `contentPermissions`, platform scopes, and the applicable DSH Attachment/Tool/Approval
contract. Unsupported content is rejected explicitly.

Table-bearing replies use Feishu's native Markdown rich text, keeping the original text and reply destination. Other
messages remain plain text. Replies over the SDK's 3,500-character single-message boundary, or containing literal
HTML/platform tags or Markdown image syntax, also stay plain text
so formatting cannot introduce mentions or media. A definite platform format rejection may fall back to plain text through
the official SDK; an uncertain send is not retried. This changes presentation only, not the stored Session or permissions.

### Output files

On the pinned DSH `0.1.6-alpha.1` Host, set `fileDeliveryEnabled: true` independently of content-reading permissions.
When a Feishu task calls native `present`, the adapter requests approval for one immutable file snapshot and its exact
recipient, then sends a downloadable attachment. Web-initiated `present` stays local. Each call accepts one nonempty
regular output file inside the Session workspace, up to 30 MB. Approve only the expected filename, size, hash, and recipient.

Existing Sessions keep their tool schemas; they can use their existing `present`. New Sessions may also use
`feishu_file_send`. A Web file card or a local path alone is not proof of Feishu delivery. Disabled, rejected, pending,
failed, and uncertain sends must not be reported as delivered. Do not automatically retry an uncertain send; inspect the
destination first. Disabling/removing the adapter cannot withdraw an attachment already sent.

Ambiguous sends become `uncertain`; only explicit 429 evidence can trigger bounded retry. Disable/reload/remove closes the
WebSocket. Health, pairing, permission, and delivery state appear in the shared DSH page without secrets or message bodies.

Current real-channel limitations are in [status](../../docs/status.zh.md).

## Remove

```sh
dsh plugin --profile web remove dsh-evoforge-feishu
```

Removal stops Feishu transport; native Session/Workspace data and already-sent messages remain.

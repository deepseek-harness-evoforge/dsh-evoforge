# V5.7：Gateway 有界渠道投递与飞书取消传播

> 日期：2026-08-24；固定 DSH revision：`47f943859bef60e4160492346772ded9b24f765a`；状态：assembled implemented；真实 Bot/App effect pending

## 用户结果

对启用 Telegram 或飞书 Adapter 的 DSH 操作者，已经 durable 进入 `sending` 的一次平台发送不再能因 SDK 或
Adapter Promise 永久悬挂而阻塞 Bundle disable、reload 或 remove。Gateway 会在 Adapter 声明的 wall-clock
上限或 Cordis lifecycle cancellation 到达时，把结果保守终结为 `uncertain`，禁止自动重发；当前两个 Adapter
都声明 30 秒。

## 深模块与权限边界

- `dsh-gateway` 继续拥有 transport-neutral 的 durable intent、串行、限流、timeout、uncertain 与 dispose；
- Adapter 继续拥有 SDK、凭据、平台错误分类和实际 HTTP 调用，没有新增业务路由、动态工作流或第二 Runtime；
- `GatewayTextAdapterConfig.sendTimeoutMs` 是必填 policy，范围 1–120000 ms；
- Gateway 同时把组合 signal 交给 Adapter 并 race Adapter Promise，因此不合作实现也不能卡住 Host；
- 飞书普通文本和一次性 Approval 卡片把 signal 继续传入官方 SDK 使用的 Axios transport；
- timeout 不能证明平台未接受消息，因此只能是 `uncertain`，不能改写为 failed 或 safe-to-retry；
- 普通 Session 的 Tool、Skill、Prompt、Schema 与顺序没有变化，模型表面增量为 0。

## TDD 证据

第一条红测让 Adapter `send()` 永远不返回，再 dispose registration。旧实现虽然 abort signal，但 disposer 50 ms
后仍未完成：

```text
Gateway outbound text delivery
→ 1 failed / 7 passed
→ expected "disposed", received "timed-out"
```

第二条红测在真实 assembled DSH 飞书消息/429/回复链中检查 platform port 收到的 signal。旧实现完成了两次
send，却传入 0 个 signal：

```text
DSH assembled Feishu chat
→ 1 failed
→ expected 2 signals, received 0
```

修复后：

```text
pnpm --filter dsh-gateway typecheck
pnpm --filter dsh-gateway test
→ 7 files / 26 tests passed

pnpm --filter dsh-feishu typecheck
pnpm --filter dsh-feishu test
→ 17 files / 48 tests passed

pnpm --filter dsh-telegram typecheck
pnpm --filter dsh-telegram test
→ 7 files / 26 tests passed
```

飞书全包包含固定 DSH assembled Agent/Command/Approval/Goal continuation、双 Workspace 隔离、完整 composition
cache parity，以及 Gateway/飞书最终 tarball 的 clean-profile add、dump、boot、remove。Gateway Typert 生成物
使用上述固定 DSH checkout 重新生成并通过 freshness gate。

全仓门禁同样通过：

```text
pnpm check
→ documentation links and public-path checks passed
→ RP-1 real-provider acceptance contract 8/8 passed
→ 11 package typechecks passed
→ 544 tests passed / 3 skipped
→ 11 package builds、Gateway Typert freshness 与 Node artifacts passed
```

## 未证明

测试平台是 keyless deterministic Adapter，没有联系真实 Telegram Bot 或飞书 App，因此不证明真实平台接受、
真实 429、真实网络超时、飞书用户点击、多日重连或 duplicate-effect rate。exact 飞书用户消息、真实 App
内容权限、Hermes 同模型 paired 和生产 soak 仍是发布阻断项；本增量不支持打 tag 或宣布上位替代完成。

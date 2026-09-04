# V5.140 Telegram 常驻 Host 配对 assembled 证据

日期：2026-09-04  
EvoForge revision：工作树提交前验证（本证据对应 V5.140）  
Canonical DSH 最新审计：`76fda729799fe9b3848dbe2c211d4b231032b81e`，`0.1.2-rc.1`，`HEAD == origin/master`，clean。  
可运行 assembled 支持基线：`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`，`0.1.2-alpha.5`，clean。

## 目的

补齐 Telegram 与 Feishu 已有的 Gateway Host 配对语义。验证范围是本地 DSH assembled 纵切，不把 loopback
或 fake Bot 当作真实 Telegram 生产证据。

## 实现

- `dsh-telegram` 新增 `mode: pairing` 与 `accountId` 配置；不需要预先配置静态 `conversationId/userId`。
- 未授权 direct DM 先调用共享 Gateway `authorize`，得到一次性 code 后直接通过 Telegram Adapter 回复；首条消息不调用
  `dispatch`，不写入 DSH Agent/Session。
- Host 以共享 Gateway `approvePairing` 批准 code；下一条消息由动态 Gateway route 进入同一个原生 Session。
- 动态 route 在 `dispatch` 前解析并绑定 Agent，确保同步 inbox claim/turn 事件仍能关联回复。
- 已有静态 `routeId` 模式保持兼容；pairing 模式不生成未绑定 Workspace 的 attention 通知 route。
- Web `/telegram` 健康解析同时接受 static 与 pairing 文本，不创建第二页面或状态库。

## 实际命令与结果

开发/测试前先执行：

```sh
DSH_DIR=/path/to/deepseek-harness
git -C "$DSH_DIR" fetch origin --tags --prune
test "$(git -C "$DSH_DIR" rev-parse HEAD)" = "$(git -C "$DSH_DIR" rev-parse origin/master)"
test -z "$(git -C "$DSH_DIR" status --short)"
test "$(node -p "require('$DSH_DIR/package.json').version")" = "0.1.2-rc.1"
```

针对性回归：

```sh
DSH_EVOLVE_DSH_SOURCE_DIR=/private/tmp/evoforge-dsh-latest.qPqo1d \
  pnpm --filter dsh-telegram exec vitest run \
  test/protected-route.test.ts test/inbound.test.ts test/pairing-assembled.e2e.test.ts
```

结果：3 个测试文件、24 个测试全部通过（本轮 assembled pairing 用时约 1.4 秒；Darwin-only gate）。另执行
`pnpm --filter dsh-telegram typecheck` 与 `pnpm --filter dsh-telegram build`，均通过。

assembled 行为断言：

1. fake Telegram API 首条未知 direct DM 收到 `EvoForge pairing code` 和原消息 reply id；目标 Session 没有
   `channel:*` user message。
2. Host 用 code 和现有 Workspace/Session/Agent target 调用 Gateway approval，产生动态 paired route。
3. 第二条 direct DM 唯一进入原生 Session，并收到模型 turn 的 Telegram 回复。
4. Gateway health 中动态 route 标记 `paired: true`；没有创建第二 Agent 或第二 Gateway。

## 非结论与剩余门禁

这不是真实 Bot、真实网络、真实 Telegram 账号、生产权限或 Hermes paired benchmark 证据。真实外部 Telegram
陌生安装路径、重启后新消息、撤销重配、长期重连仍需独立执行；`web-control-plane`、`hermes-paired`、真实
Provider、长期效果和 npm 命名空间仍按 `release-gates.json` 阻断。普通媒体仍不 materialize 为 DSH 原生附件块。

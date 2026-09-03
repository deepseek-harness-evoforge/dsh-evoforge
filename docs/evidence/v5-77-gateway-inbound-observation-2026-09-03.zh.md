# V5.77：统一 Gateway 入站事件可观测性（2026-09-03）

## 变更

`GatewayTransportObservation`/`GatewayTransportHealthItem` 新增可选 `lastInboundAt`。它和
`lastActivityAt` 分离：前者只由 Adapter 收到真实平台事件时更新，后者还可由连接、出站投递或其他传输活动
更新。Feishu 消息/Approval 回调和 Telegram 长轮询收到 update 都写入该字段；统一 DSH Web `渠道与网关`
页面的技术详情现在显示“最近入站事件”。字段仍是脱敏时间戳，不暴露账号、对话、用户、消息或凭据。

该变更没有新增 Gateway、Router、Session、状态库、平台探测或模型调用，也没有改变配对、路由、限流、幂等
和持久投递语义。连接 `ready` 而没有任何入站事件时，页面会明确显示没有事件记录，避免将 WebSocket handshake
误认为平台事件链路已通。

## DSH 基线

测试前执行 `git -C deepseek-harness fetch origin --tags`，确认最新远端 master
`76fda729799fe9b3848dbe2c211d4b231032b81e` clean。由于该 master 的上游根级 tsdown 入口仍缺少
`lib/types/{index,invariant,startup}.js`，所有可执行运行时测试使用完整构建的
`dsh-v0.1.2-alpha.5` / `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。

## 验证结果

在当前 EvoForge `main` 执行：

```sh
DSH_SOURCE_ROOT=/path/to/dsh-v0.1.2-alpha.5 pnpm run generate:typert
DSH_EVOLVE_DSH_SOURCE_DIR=/path/to/dsh-v0.1.2-alpha.5 pnpm --filter dsh-gateway typecheck
DSH_EVOLVE_DSH_SOURCE_DIR=/path/to/dsh-v0.1.2-alpha.5 pnpm --filter dsh-gateway test
DSH_EVOLVE_DSH_SOURCE_DIR=/path/to/dsh-v0.1.2-alpha.5 pnpm --filter dsh-telegram typecheck
DSH_EVOLVE_DSH_SOURCE_DIR=/path/to/dsh-v0.1.2-alpha.5 pnpm --filter dsh-telegram test
```

结果：Gateway `8 test files / 36 tests` 全部通过；Telegram `8 test files / 29 tests` 全部通过。Gateway
Typert Host/Remote artifacts 已由固定 DSH generator 重新生成并通过 stale-source 检查。Feishu 的
`lastInboundAt` 健康契约此前已由 [V5.76](v5-76-feishu-inbound-observation-2026-09-03.zh.md) 3/3 验证，
其完整套件仍为 18 files / 45 tests。

## 门禁影响

这是可观测性增强，不提升真实 Feishu AS-2：最新隔离重试仍因没有 pending pairing 事件而失败，见
[V5.74](v5-74-feishu-as2-epoch5-no-event-2026-09-03.zh.md)。真实 Telegram Bot、Provider、Hermes paired
和长期效果门保持原状态，不创建发布 tag。

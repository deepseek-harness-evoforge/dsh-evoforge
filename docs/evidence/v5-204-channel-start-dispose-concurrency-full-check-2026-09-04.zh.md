# V5.204：渠道启动/销毁并发门与全量复验

> 日期：2026-09-04。范围：收口 Feishu、Telegram 静态及 Telegram pairing runtime 的并发启动和销毁边界。

## 修复

- 每个渠道 runtime 的并发 `start()` 共享一个 Promise，避免第二次调用在 transport、Agent 绑定或 WebSocket/轮询尚未就绪时提前返回。
- Feishu 在 Agent resolve、平台 connect 和只读 access probe 等异步边界检查已销毁状态；迟到的旧连接不会把 transport 健康写回 `ready`。
- 三个 runtime 的并发 `dispose()` 共享同一个 teardown Promise；重复卸载等待完整回收，而不是立即成功返回。
- 原有 Host 层凭据轮换串行队列保持不变；本增量补上 runtime 直接调用和故障清理的最后一道生命周期边界。

## 基线与验证

- canonical DSH `origin/master`: `d347e703908d0406b7a7ef80e3a0e594d86b2215`
- DSH 版本/tag：`0.1.3-alpha.1` / `dsh-v0.1.3-alpha.1`（同一 revision，clean，`HEAD == origin/master`）
- EvoForge 可构建支持组合：alpha.5 `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`
- DSH 官方安装通过；根构建缺失 `@deepseek-ai/dsh-root/lib/types/{index,invariant,startup}.js` 仍为上游缺陷

开发前重新 fetch DSH，随后执行：

```sh
pnpm --filter dsh-evoforge-feishu typecheck
pnpm --filter dsh-evoforge-telegram typecheck
pnpm --filter dsh-evoforge-feishu test -- --run
pnpm --filter dsh-evoforge-telegram test -- --run
DSH_EVOLVE_DSH_SOURCE_DIR=/path/to/buildable-dsh-support pnpm run check
```

结果：

- Feishu：`19` 个测试文件，`56/56` 通过；并发 start Promise、并发 dispose Promise 与平台断开阻塞均通过。
- Telegram：`11` 个测试文件，`38/38` 通过；pairing 并发 start/dispose 与静态生命周期回归通过。
- 根级全量检查：权威 `CHECK_RC=0`；Evolution `309/309`、Gateway `47/47`、Feishu `56/56`、Telegram `38/38`、Evolve Web `27/27`、Control Center `5/5`、Doctor `40/40`，Goal Continuity `12/12`、GitHub Review `27/27`；Resident `17` 通过/`1` 跳过，Software Delivery `34` 通过/`1` 跳过，clean-profile `1` 通过/`1` 跳过，其余合同与产物门通过。
- 未发送真实渠道消息、调用真实 Provider 或读写外部凭据。

## 解释边界

本证据证明渠道 Adapter 的本地并发生命周期语义和全量回归稳定，不证明真实 Feishu/Telegram、Provider、Hermes paired benchmark、长期负迁移/遗忘、npm ownership 或发布 tag 门禁已通过。

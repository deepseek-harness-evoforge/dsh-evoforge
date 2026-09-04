# V5.203：渠道 Adapter 并发 dispose 收口与全量复验

> 日期：2026-09-04。范围：修复 Feishu、Telegram 静态及 Telegram pairing Adapter 在 teardown 尚未完成时重复调用 `dispose()` 会提前返回的问题。

## 修复

每个渠道 runtime 现在保存唯一的 teardown Promise：第一个 `dispose()` 启动完整的 listener、approval、outbound、platform 和 transport 回收，后续并发调用等待同一个 Promise；已完成/已销毁实例仍保持幂等。这样 Host 凭据轮换、卸载和故障清理不会把“调用返回”误判成“旧 WebSocket 已断开”。

## 基线与验证

- canonical DSH `origin/master`: `d347e703908d0406b7a7ef80e3a0e594d86b2215`
- DSH 版本/tag：`0.1.3-alpha.1` / `dsh-v0.1.3-alpha.1`（同一 revision，clean，`HEAD == origin/master`）
- EvoForge 可构建支持组合：alpha.5 `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`
- DSH 官方安装通过；根构建缺失 `@deepseek-ai/dsh-root/lib/types/{index,invariant,startup}.js` 仍按上游缺陷分类

开发前重新 fetch DSH，随后执行：

```sh
pnpm --filter dsh-evoforge-feishu test -- --run
pnpm --filter dsh-evoforge-telegram test -- --run
DSH_EVOLVE_DSH_SOURCE_DIR=/path/to/buildable-dsh-support pnpm run check
```

结果：

- Feishu：`19` 个测试文件，`56/56` 通过；并发 dispose 测试在 platform disconnect 阻塞时确认 Promise identity 与单次 teardown。
- Telegram：`11` 个测试文件，`38/38` 通过；pairing runtime 并发 dispose 测试确认 Adapter dispose 只执行一次。
- 根级全量检查：权威 `CHECK_RC=0`；Evolution `309/309`、Gateway `47/47`、Feishu `56/56`、Telegram `38/38`、Evolve Web `27/27`、Control Center `5/5`、Doctor `40/40`，Goal Continuity `12/12`、GitHub Review `27/27`；Resident `17` 通过/`1` 跳过，Software Delivery `34` 通过/`1` 跳过，clean-profile `1` 通过/`1` 跳过，其余合同与产物门通过。
- 未发送真实渠道消息、调用真实 Provider 或读写外部凭据。

## 解释边界

该证据证明本地渠道 teardown 的并发语义和全量回归稳定，不证明真实 Feishu/Telegram、Provider、Hermes paired benchmark、长期负迁移/遗忘、npm ownership 或发布 tag 门禁已通过。

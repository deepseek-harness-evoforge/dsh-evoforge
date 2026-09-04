# V5.143 Gateway 通用 Adapter 首次连接旅程证据

日期：2026-09-04
EvoForge revision：本轮原子提交（对应 V5.143）
Canonical DSH 最新审计：`76fda729799fe9b3848dbe2c211d4b231032b81e`，`0.1.2-rc.1`，`HEAD == origin/master`，clean。
可运行 assembled 支持基线：`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`，`0.1.2-alpha.5`，clean。

## 目的

让 Gateway Control Surface 的“首次连接”可视化与配对码入口保持同一通用 Adapter 语义。此前旅程固定写成
“飞书首次连接进度”，Telegram-only 页面没有等价旅程，造成通用控制面的产品歧义。

## 实现与验证

- 旅程从当前选中的 Adapter transport、pending request 和 route projection 生成，展示连接、用户私聊和管理员批准
  三个阶段；Adapter 名称只作为脱敏显示，不跨越 Host 权威边界。
- 飞书与 Telegram 共享同一 `ControlCenter` 页面、同一 `GatewaySurface` 和同一 `Journey` primitive；没有第二网页、
  第二状态库或 Adapter 专属分支。
- 没有 pending request 时不显示空 pending 卡片；仅有 Telegram transport 时仍显示 Telegram 的首次连接旅程。

本轮先重新 fetch/核对 canonical DSH，再执行：

```sh
pnpm --filter dsh-gateway exec vitest run test/gateway-action.client.test.tsx
pnpm --filter dsh-gateway typecheck
pnpm --filter dsh-gateway build
pnpm run check:docs
DSH_EVOLVE_DSH_SOURCE_DIR=/private/tmp/evoforge-dsh-latest.qPqo1d pnpm run check
```

结果：Gateway Control Surface `9/9`；完整 alpha.5 `pnpm run check` 退出码 `0`，所有文档、CI/套件/发布合同、12 包
类型检查、测试和构建通过。

## 非结论

本轮验证的是 DSH Client Surface 的投影逻辑和单元交互，不是已安装最新包的真实外部渠道浏览器通过，也不提升
真实 Feishu/Telegram、Provider、Hermes paired、长期效果或 npm 发布门状态；这些仍由 `release-gates.json` 阻断。

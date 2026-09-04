# V5.141 Gateway 通用 Adapter 配对控件证据

日期：2026-09-04
EvoForge revision：本轮原子提交（对应 V5.141）
Canonical DSH 最新审计：`76fda729799fe9b3848dbe2c211d4b231032b81e`，`0.1.2-rc.1`，`HEAD == origin/master`，clean。
可运行 assembled 支持基线：`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`，`0.1.2-alpha.5`，clean。

## 目的

修复原生 Gateway Control Surface 把配对码审批写死为 `feishu` 的产品偏差，使 Telegram-only 和未来渠道能够
复用同一个单页 Host 配对入口，而不增加网页、Router 或状态库。

## 实现

- 从当前 Gateway transport 与 pending projection 生成去重、排序后的 Adapter 列表；配对码提交使用所选 Adapter
  调用既有 `approvePairing(code, adapter, workspace, session)`。
- “待批准请求”只在确有 pending request 时显示，避免 Telegram-only 或空状态出现误导性的空卡片。
- 保留 request-id 直接批准、脱敏账户指纹、当前 Session/Workspace ownership gate 和 Gateway 唯一状态权威。
- 控件使用已有 Control Center 原生 Surface；新增选择器沿用同一视觉、焦点和实例化 DOM id，不创建第二页面。

## 验证

开发/测试前重新 fetch 并核对 canonical DSH `HEAD == origin/master`、版本 `0.1.2-rc.1`、clean；使用已审计 alpha.5
支持 checkout 运行：

```sh
pnpm --filter dsh-gateway exec vitest run test/gateway-action.client.test.tsx
pnpm --filter dsh-gateway typecheck
pnpm --filter dsh-gateway build
pnpm run check:docs
DSH_EVOLVE_DSH_SOURCE_DIR=/private/tmp/evoforge-dsh-latest.qPqo1d pnpm run check
```

结果：Gateway Control Surface `9/9`，完整 alpha.5 `pnpm run check` 退出码 `0`；全部文档、CI/套件/发布合同、
12 包类型检查、测试和构建通过，工作树保持 clean。

组件行为断言：

1. Feishu + Telegram 双 Adapter 会显示选择器；切换到 Telegram 后提交 `ABCDEFGH23` 只把 `telegram` 传给 Host Remote。
2. Telegram-only Host 显示“渠道配对”和 Telegram 选择项，不显示飞书专属文案，也不显示没有 pending 的空请求卡片。
3. 两个同时挂载的 Gateway Surface 仍使用不同配对码 DOM id；Session 切换先清空旧快照，轮询失败保留最后权威 pending 列表。

## 非结论

本轮只验证本地 DSH Client Surface 和 Host Remote 合同，不宣称真实 Telegram/飞书外部配对、生产权限、Hermes
paired benchmark 或发布门通过。真实渠道、Provider、长期效果和 npm 命名仍由 `release-gates.json` 阻断。

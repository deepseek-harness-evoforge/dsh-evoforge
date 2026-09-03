# V5.88：Gateway 单页渠道入口按需显示（2026-09-04）

## 发现

DSH Gateway 原生 `conversation.view` 在 Telegram-only profile 中仍无条件显示“飞书配对”和空的 pending
request 区块。它不会造成第二个网页，但会把未安装能力塞进用户的主控制面，增加误操作与“插件互相交叉”的感知。

## 修复

- Gateway Surface 现在只在 Host 快照存在飞书 transport、飞书 route 或飞书 pending request 时显示飞书旅程。
- pending request 区块仅在存在飞书上下文或确有任意待处理请求时显示；Telegram-only 且无 pending 时不渲染。
- 配对帮助文案改为优先批准 Gateway 已持久化的 pending request；配对码输入保留为兼容入口，不再作为主流程。
- 所有判断只使用已有 Gateway 健康/配对投影，不读取凭据、不探测平台、不增加 Router、Session 或网页。

## 验证

开发前重新 fetch DSH 并确认 `HEAD == origin/master == 76fda729799fe9b3848dbe2c211d4b231032b81e`；运行时兼容仍锁定
已构建的 alpha.5 `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。

```sh
DSH_EVOLVE_DSH_SOURCE_DIR=/private/tmp/evoforge-dsh-latest.qPqo1d \
  pnpm --filter dsh-gateway typecheck
pnpm --filter dsh-gateway exec vitest run --maxWorkers 1 \
  test/gateway-action.client.test.tsx
pnpm run check:docs
```

结果：Gateway 类型检查通过；Control Surface 6/6 通过（新增 Telegram-only 无飞书控件回归）；文档检查通过。
此前单页 DSH Web 浏览器证据仍适用，本增量没有增加页面或路由。

## 发布边界

这是入口降噪和配对主流程表达修正，不是外部渠道通过证据。真实 Feishu AS-2、真实 Telegram Bot、双 Provider、
Hermes paired、长期效果与首个 release tag 仍按 `release-gates.json` 保持未通过状态。

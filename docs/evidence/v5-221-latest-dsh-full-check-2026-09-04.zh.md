# V5.221：最新 DSH 重审后的根级全量检查

## 目的

本轮先重新 fetch 并审计 DSH canonical `origin/master`，再在最近已公开、可构建且通过支持矩阵的 DSH alpha.5 checkout 上执行 EvoForge 根级全量门禁。该记录只证明当前 `main` 的本地安装、类型、测试、构建和合同没有回归，不把确定性 fixture 结果升级为真实渠道、真实 Provider 或 Hermes 上位替代。

## DSH 审计事实

- canonical `origin/master`：`d347e703908d0406b7a7ef80e3a0e594d86b2215`。
- 公开版本/tag：`0.1.3-alpha.1` / `dsh-v0.1.3-alpha.1`。
- `HEAD == origin/master`，DSH worktree clean，官方依赖安装通过。
- 官方根构建仍被 DSH 自身 `@deepseek-ai/dsh-root` 缺失 `lib/types/{index,invariant,startup}.js` 入口阻断；EvoForge 没有修改、覆盖或重新分类该上游错误。
- 本轮使用已审计可构建的 DSH alpha.5 支持 checkout（revision `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`）完成 EvoForge 验证。

## 执行与结果

```sh
git -C <deepseek-harness> fetch origin --prune
node scripts/audit-dsh-latest.mjs --source <deepseek-harness> --skip-build --json
DSH_EVOLVE_DSH_SOURCE_DIR=<audited-alpha5-checkout> pnpm run check
```

根级 `pnpm run check` 退出码为 `0`，包含：

- `dsh-evolve`：313/313；
- `dsh-gateway`：52/52；
- `dsh-evoforge-feishu`：57/57；
- `dsh-evoforge-telegram`：38/38；
- `dsh-evolve-web`：27/27；
- `dsh-control-center`：5/5；
- `dsh-evoforge-doctor`：40/40；
- `dsh-goal-continuity`：12/12；
- `dsh-github-review`：27/27；
- Resident：17 passed / 1 skipped；Software Delivery：34 passed / 1 skipped；
- 文档、CI 路径、套件打包、release manifest、Typert/Node artifact、兼容性、Hermes/Provider/Feishu/Telegram 合同、全包 typecheck、build 与 clean-profile 回归均通过。

## 边界与未决门禁

本轮没有读取或输出任何凭据，也没有发送 Feishu/Telegram 消息或调用付费 Provider。发布门禁仍保持 `blocked`：npm 所有权、真实 Feishu AS-2、真实 Telegram AS-1、真实 Provider RP-1、同任务同模型 Hermes paired 以及长期负迁移/遗忘/重复外部效果数据仍缺少合规证据。只有完成这些真实门禁后才允许创建 annotated SemVer tag。

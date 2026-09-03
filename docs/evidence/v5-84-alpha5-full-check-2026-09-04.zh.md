# V5.84：alpha.5 支持基线完整检查收口（2026-09-04）

## 目的

本记录冻结本轮代码变更后的可复现本地质量结果。它验证的是 EvoForge 在已审计、可构建的 DSH
`0.1.2-alpha.5` 支持基线上的完整 typecheck、测试与 build，不把 DSH 最新 `master` 的上游构建状态
或真实渠道/Provider/Hermes 门禁误写成通过。

## DSH 版本边界

- 检查前执行：`git -C "$DSH_ROOT" fetch origin --tags`（`DSH_ROOT` 指向本地 DSH checkout）。
- 最新远端 `master` 与本地 HEAD：`76fda729799fe9b3848dbe2c211d4b231032b81e`。
- 本轮实际执行支持基线：一个隔离的 alpha.5 checkout，对应已构建的 alpha.5
  `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。
- 最新 master/tag 仍单独记录为上游构建阻断，不通过修改 DSH 源码规避；支持声明继续锁定 alpha.5。

## 可复现命令

```sh
DSH_ROOT=/path/to/deepseek-harness
git -C "$DSH_ROOT" fetch origin --tags
test "$(git -C "$DSH_ROOT" rev-parse HEAD)" = "$(git -C "$DSH_ROOT" rev-parse origin/master)"
DSH_EVOLVE_DSH_SOURCE_DIR=/path/to/dsh-v0.1.2-alpha.5 pnpm run check
```

## 结果

命令退出码为 `0`。根级检查依次通过文档、CI 路径、套件与发布门结构测试、DSH 兼容性、RP-1/AS-2
合同门、全包 typecheck、全包测试和全包 build。关键计数如下：

- `dsh-evolve`：69 files，309 passed；
- `dsh-gateway`：8 files，37 passed；
- `dsh-feishu`：18 files，45 passed；
- `dsh-telegram`：8 files，29 passed；
- `dsh-evolve-web`：26 passed；`dsh-evolve-attention`：11 passed；
- `dsh-doctor`：40 passed；`dsh-goal-continuity`：12 passed；`dsh-github-review`：27 passed；
- `dsh-control-center`：4 passed；Software Delivery：34 passed、1 个明确 skip；Resident：15 passed、1 个明确 skip；
- 十二包最终 build、Typert/Node artifact 校验全部通过。

跳过项是已有平台/历史夹具的显式 skip，不计为失败，也没有被改成通过。根级 `check` 不会替代
`pnpm run check:release:gates`：真实 Feishu AS-2、真实双 Provider、完整 Hermes paired 和长期效果门
仍然阻断首个 release tag，详见根目录 `release-gates.json`。

## 结论

本轮实现与 alpha.5 的本地开源工程质量门已收口，可以继续在 `main` 上开发并作为可复现的开发基线；
它证明的是构建/回归质量，不是 Hermes 上位替代或可发布版本。任何 release 声明仍必须先完成真实
Feishu 新消息、重启/撤销/Approval/Schedule、双 Provider、同条件 Hermes paired 和长期负迁移/回滚
数据门禁。

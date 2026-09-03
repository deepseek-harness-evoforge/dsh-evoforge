# V5.69 DSH alpha.5 迁移证据（2026-09-03）

## 基线

- DSH 本地最新 `master`：`49a606bc5b5934603f22a26957a07dc799ab0291`，版本 `0.1.2-alpha.5`，clean。
- 本轮 assembled/clean-profile 使用的最新公开 tag：`dsh-v0.1.2-alpha.5`，revision `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。
- DSH master 的 `pnpm install --frozen-lockfile` 通过；其 `pnpm build` 暴露上游 `@deepseek-ai/dsh-root` Client bundle 缺少 `session-persistence` 导出（`DEFAULT_PREPARED_SESSION_CACHE_SIZE`、`DEFAULT_WRITE_BATCH_MAX_DELAY_MS`、`MAX_WRITE_BATCH_DELAY_MS`、`PersistenceCoordinator`），因此本项目没有修改上游或把 master build 失败包装成通过。
- 最新 tag 的 `pnpm install --frozen-lockfile` 与 `pnpm build` 通过。测试进程使用该 tag 的 canonical realpath，避免 `/tmp` 与 `/private/tmp` 别名造成重复 DSH 包身份。

## 本轮变更与结果

| 检查 | 结果 |
|---|---|
| EvoForge `pnpm typecheck` | 通过 |
| `dsh-control-center` 单元测试 | 4 passed |
| `dsh-gateway` 单元/集成测试 | 36 passed |
| `dsh-evolve` 测试 | 309 passed |
| `dsh-evolve-attention` 测试 | 11 passed |
| `dsh-evolve-web` 测试 | 26 passed |
| `dsh-doctor` 测试 | 40 passed |
| `dsh-github-review` 测试 | 27 passed |
| `dsh-goal-continuity` 测试 | 12 passed |
| `dsh-resident` 测试 | 15 passed，1 skipped |
| `dsh-feishu` 测试 | 45 passed |
| `dsh-telegram` 测试 | 29 passed |
| `dsh-software-delivery` 全套测试 | 35 passed，2 skipped |
| alpha.5 assembled Skill/Completion/Crash Recovery | 3 passed |
| alpha.5 clean-profile add/dump/boot/reload/dispose/remove/readback | 1 passed |
| pre-alpha.5 历史 suite-upgrade 夹具 | 明确 skipped；旧产物导入已从 alpha.5 移除的 API，不能作为当前兼容证据 |

本轮中途曾因 `dsh-goal-continuity` 夹具缺少 `dsh-session-projection`、软件交付夹具仍调用旧
`SessionPersistence.open()`/旧写入 seam 而失败；修复后均在同一最新 alpha.5 构建上重跑通过。该过程保留在
Git 提交和本文件，不把第一次失败隐藏成“从未发生”。

根测试第一次误以为 `DSH_SOURCE_ROOT` 会选择 E2E 运行时 checkout，导致 Shadow 夹具误加载本地
master（49a606…）而与 alpha.5 case pack（db6bdc…）不匹配，并出现 Typert 版本混用错误。检查脚本随后
明确区分两个变量：`DSH_SOURCE_ROOT` 只用于生成/校验构建产物，`DSH_EVOLVE_DSH_SOURCE_DIR` 才是
assembled/E2E 的运行时 DSH 根目录；使用 canonical realpath 重跑后，根测试 69 个文件、309 个测试全部通过。

## 仍未关闭的发布门

以下项目不是本轮测试覆盖范围，仍阻止首个 annotated tag：真实飞书 AS-2 完整 epoch（含重连、撤销/重新配对、Approval 卡片、Schedule、group policy 与故障注入）、两套独立真实 provider、同模型/同权限/同预算 Hermes paired benchmark、长期负迁移/遗忘数据，以及真实浏览器成功/失败/恢复的完整路径。`release-gates.json` 中任何 `partial`、`not-run`、`failed` 或 `blocked` 都必须在发布前变为 `passed`。

完整命令和原始输出应与本文件一同保存在 CI artifact；本文件只记录本轮已核实的摘要，避免 README 混入内部流水账。

# 发布与开源迭代门

EvoForge 以 DSH 官方 Bundle 作为交付单元，以能力套件作为用户安装入口。当前仍是 `pre-alpha`，没有 registry 发布声明；本地 tarball 只能用于开发和验收，不能被文档包装成稳定发行版。

## 版本和 Git 纪律

- 所有插件包在一次发布中使用同一 SemVer 版本；版本变更必须同时更新 `CHANGELOG.md`、套件清单和验证证据。
- 只在 `main` 开发。通过测试的最小增量原子提交并推送 `origin/main`，不使用功能分支或 Git 分支保存 Candidate。
- Candidate 由运行时内容寻址存储保存；发布版本用 annotated tag 标记，例如 `dsh-v0.1.0-alpha.1`。tag 只能指向已在 `main` 验证过的提交，不能用轻量 tag 或手工改包覆盖。
- `pnpm run check:release` 是 tag 前静态预检；它检查 clean worktree、统一版本、MIT/仓库/README/Bundle patch 公共包元数据、能力套件完整性和 Changelog 入口。`--allow-dirty` 只用于本地演练，不构成发布证据。
- `release-gates.json` 是 tag 的机器可读证据索引；`pnpm run check:release:gates` 会验证证据路径，并且只在所有 `requiredForTag` gate 都为 `passed` 时退出 0。`partial`、`not-run`、`failed` 和 `blocked` 都会阻止发布。
- `scripts/check-release-tag-version.mjs` 会把 annotated tag（例如 `dsh-v0.1.0-alpha.1`）与所有 Bundle 的统一版本逐一比对；tag 名称不匹配时不能进入发布流程。
- `scripts/check-release-workflow.mjs` 会把 tag-only、受保护 Environment、门禁先于 publish 和 Action commit pin 变成仓库检查，防止后续 CI 修改绕过发布安全链。
- `pnpm run release:tag -- --tag dsh-v0.1.0-alpha.1 --push` 只允许在 clean `main`、`HEAD == origin/main`、tag/包版本一致、静态预检和 release-gate 全部通过时创建 annotated tag；不提供绕过外部门禁的参数。

## GitHub 开源发布流程

推送 `dsh-v*` annotated tag 后，`.github/workflows/release.yml` 会先确认它确实是 annotated tag 且提交仍在 `main` 历史上，再在受保护的 `npm` Environment 中重新执行 tag/版本检查、完整 `pnpm check`、静态发布预检和全部 required release gates，然后才构建并发布十二个公开 Bundle。工作流固定使用审计过的 DSH revision，并设置 `id-token: write` 以支持 npm provenance。

维护者需要在 GitHub 为 `npm` Environment 配置人工批准规则，并配置 npm trusted publisher 或 `NPM_TOKEN`；Environment 未获批准、任一门禁失败或 tag/包版本不一致，都不会执行发布步骤。该工作流只发布已经由 `release:tag` 创建的 tag，不提供跳过门禁或直接从普通 `main` 推送发布的路径。

## 可复现的安装包

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm run check:suites
pnpm run pack:suite -- --suite core --out /tmp/evoforge-packs
pnpm run check:release
pnpm run check:release:gates
```

`pack:suite` 只调用 DSH 官方 `pnpm pack`，并产生包含文件名、版本和 SHA-256 的 `evoforge-suite.json`。部署者仍使用官方 `dsh plugin --profile <profile> add/remove`，不安装第二个 EvoForge Runtime。
省略 `--suite` 时默认打包 `core`；完整十二包仅能通过显式 `pnpm run pack:full`（或 `--suite full`）生成。
仅使用一个消息平台时，可在 `channels` 套件上增加 `--channel feishu` 或 `--channel telegram`，生成共享 Control Center、Gateway 与对应 Adapter；不会把它们合并成一个 Bundle。

## 不可跳过的发布门

静态检查通过不等于可以发布。首个 annotated tag 前必须从 clean profile 使用最终 tarball 完成：

1. 官方 `add`、`dump`、Host boot、真实 Session/Goal 路径、reload、Host 断连与恢复；
2. `dispose`、官方 `remove`、再次 boot/readback，确认原生 DSH 数据仍在且 EvoForge 表面消失；
3. 真实浏览器验证 Control Center 的成功、失败、刷新和恢复；
4. 已配置的真实飞书 Gateway/Adapter 配对、重连、幂等投递和最小权限路径；
5. 同任务、同模型、同权限、同预算的 Hermes paired benchmark，覆盖成功率、人工干预、误调用、负迁移、恢复、重复外部效果、成本、延迟、cache-read 和精确回滚。

越权、评测泄漏、当前 Session 漂移、不可卸载、不可精确回滚或只有模型自评/Mock/单测而无真实路径，均阻止 tag 和 registry 发布。后续迭代仍沿 `main → 验证 → annotated tag`，不以分支区分 Candidate。

当前 `check:release:gates` 必须失败，因为真实 Provider、完整飞书 AS-2、完整 Hermes paired 和长期效果证据尚未齐备；这是一项安全阻断，不是可忽略的 CI warning。详见仓库根目录 [release-gates.json](../release-gates.json)。

# V5.197：最新 DSH 审计与 EvoForge 全量门复验

> 日期：2026-09-04。范围：在开发前重新同步 canonical DSH，并在已审计、可构建的 alpha.5 支持实例上执行根级全量检查。此证据不扩大为真实外部渠道或 Hermes 上位替代通过。

## 结论

全量检查退出码为 `0`，当前 `main` 工作树保持干净。最新 DSH canonical `origin/master` 为
`d347e703908d0406b7a7ef80e3a0e594d86b2215`（`0.1.3-alpha.1`），官方安装成功且 HEAD 与远端一致；其根构建仍因上游
`@deepseek-ai/dsh-root` 缺失 `lib/types/{index,invariant,startup}.js` 被审计脚本分类为
`blocked-upstream-root-types-entry`，EvoForge 未修改该上游源码。

## 可复核命令与结果

```sh
DSH_SOURCE=/path/to/deepseek-harness
git -C "$DSH_SOURCE" fetch --prune origin
node scripts/audit-dsh-latest.mjs --source "$DSH_SOURCE" --json
DSH_EVOLVE_DSH_SOURCE_DIR=/path/to/buildable-dsh-support pnpm run check
```

- DSH latest audit：install `0`；build `1`，原因仅为上述已知上游缺陷；最新 checkout clean 且 HEAD=origin/master。
- EvoForge 根级 `pnpm run check`：`CHECK_RC=0`。
- dsh-evolve：`309/309`；dsh-gateway：`43/43`；dsh-feishu：`56/56`；dsh-telegram：`38/38`。
- dsh-evolve-web：`27/27`；dsh-control-center：`27/27`；dsh-doctor：`40/40`。
- dsh-software-delivery：`34 passed / 1 skipped`，clean-profile：`1 passed / 1 skipped`。
- 其余套件、文档、CI、打包、Typert、兼容性和发布脚本门均在同一根检查中通过；没有生成需要提交的工作树变化。

## 未通过门禁（保持原样）

`node scripts/check-release-gates.mjs --json` 仍为 `blocked`，且无 `errors` 或 `missingEvidence`：npm 所有权、真实飞书完整 AS-2、真实 Telegram AS-1、双真实 Provider RP-1、同条件 Hermes paired 以及长期负迁移/遗忘/恢复数据仍缺少授权或证据。通过本地全量检查不能替代这些门。

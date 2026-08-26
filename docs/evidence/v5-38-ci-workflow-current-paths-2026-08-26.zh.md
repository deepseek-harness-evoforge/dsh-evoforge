# V5.38：开源 CI 测试路径收口

日期：2026-08-26

## 问题

GitHub Actions 的 macOS assembled job 仍引用已经从活动源码删除的旧测试文件：旧 Feedback/Evaluator draft、旧
Shadow resume/CLI、旧 Canary/Retention 门，以及旧 Telegram delivery-store persistence。这样本地 `pnpm check`
即使通过，干净 GitHub runner 仍会在 Vitest 收集阶段因文件不存在而失败。

## 修复

- 删除 `.github/workflows/ci.yml` 中全部 7 个不存在的测试路径。
- 保留当前源码中仍存在且与当前 DSH assembled seam 对应的测试路径。
- 新增 `scripts/check-ci-test-paths.mjs`，扫描 CI 中的 `test/*.test.ts` 引用，并要求至少一个实际 Bundle 包含该文件。
- 将该检查接入根级 `pnpm check`，以后删除或重命名测试时会在提交前失败。

## 证据

```text
pnpm run check:ci
CI test path and DSH target checks passed for 25 referenced files.
```

同时通过 `git diff --check`。该证据修复的是开源 CI 可重复性，不改变运行时、模型表面、权限、外部效果或发布门状态；真实 Provider、真实渠道、Hermes paired 和长期效果仍由独立 release gates 约束。

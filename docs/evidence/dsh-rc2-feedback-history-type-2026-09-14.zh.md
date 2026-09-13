# 反馈历史读取的版本类型边界

- 日期：2026-09-14；EvoForge 起点 `5d9c893`。
- canonical DSH fetch 后 clean HEAD/origin/master 均为
  `c291e7961a515f6d7af9304e7fd1d257929aef26`；上游和用户 Host 未改动。
- 使用正式 alpha.5 依赖与[独立安装的 npm rc.2 副本](dsh-rc2-independent-install-2026-09-14.zh.md)，
  后者不等同于 c291 的逐字构建。

## 修正

`DurableFeedbackStoredSession.meta` 原来使用 live `SessionHeader`。新版把可创建版本约束为 literal 3，
导致两份保留 v0 的反馈历史夹具出现类型错误。该接口表示已经读回的历史，不表示新建 Session，
因此改用已有 `TranscriptHeader`，保留记录自身的数字版本，不改写历史数据。

本次只改类型与注释，没有改读取、校验、反馈归因、评测准入或权限逻辑，也没有扩大运行时接受范围。
TypeScript ES2022/ESNext、removeComments 的单文件输出前后逐字一致，SHA-256 均为：

```text
1e11780e47105e7612247f5171f1c74d383e380dece8718ba2bfd3f564bbefe4
```

## 验证

两套依赖下分别运行 Feedback Signal Monitor、Existing Skill Evaluation Evidence Vault、
Durable Feedback Attribution 三个测试文件，均 32/32 通过。

`feedback-signal-monitor.e2e.test.ts` 分别指定实际 source checkout：

- c291：3/3 通过，包括 current native feedback 的 live durability 失败恢复和 cold read。
- alpha.5：2/2 通过，明确跳过 1 项 current-only 用例。

命令为包目录下 `DSH_EVOLVE_DSH_SOURCE_DIR=<checkout> node_modules/.bin/vitest run
test/feedback-signal-monitor.e2e.test.ts`。隔离 Context 和临时存储不触碰用户历史；无真实模型调用。

正式 `pnpm --filter dsh-evolve run typecheck` 通过；两套依赖的 `pnpm --filter dsh-evolve run build`
均通过，含声明、Typert 和 Node artifact 检查。单文件 JS 等价不代表两版本完整 bundle 等价。
独立新版完整测试类型检查仍有 5 个文件、47 条错误，本次反馈相关类型错误已清零。
这不是完整新版支持或用户工作流验收；现用 Host 无须为纯类型变化重启。

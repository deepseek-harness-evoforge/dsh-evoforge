# 普通草稿的原生隔离执行底座

范围：内部执行模块，尚未接入自动评测策略、持久化对照账本或 Web。不是已部署的学习效果，也不是独立评测完成。
此前真实生成的草稿及四份封存材料不变；本次测试未读取这些材料，未增加真实 Provider 调用或启用 Skill。

## 目标与边界

让治理侧能够在唯一 DSH Host 中，用新建原生 Session 执行一个自包含测试任务。baseline 不挂草稿，另一组只在
测试 Agent 的 scoped Skill registry 中挂载内容 hash 验证后的草稿，使用官方 `skill` Tool 按需加载。原会话不变；
这里没有新 Agent Loop、数据库、评测服务、Generation 或发布权限。

调用者还必须先持久预留完整计划、实现每次 dispatch marker、管理原生 Job 的取消和 drain、保存结果及处理崩溃。
这些调用者功能尚未接入，不能直接把此模块当作安全可用的自动评测入口。

## 源码与权限

- 支持已审计 DSH `0.1.6-alpha.1` / `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`。本轮此前已完成
  canonical fetch、干净检出、frozen install 及原生构建；没有修改上游。
- 使用 `ctx.agents.create({ setup })`、owned handle、scoped `skills.register`、`tools.restrict/presentAs`、
  `agent/request`、`agent/request-error`、`tools/execute` 和精确 Session id 过滤的 `llm/stream`。
- 只开放原生 Skill 读取；工具 schema 或同名 definition 更换会拒绝继续调用。不扩大工具、凭据、文件或渠道权限。
- 每个 leg 最多三个 dispatch marker，每次输出最多 2000 token，90 秒后通知原生 Agent 取消并等待 owned dispose。
  取消不是对任意不响应 abort 的 Provider/存储提供物理释放时限保证。
- 禁用测试 Agent 的自动请求重试，普通 Agent 不受影响。当前上游重试会重新进入 `prepareRequest`，因此也经过
  `agent/request`；禁用重试是固定实验策略，不是修补一个“不经过请求钩子”的上游缺陷。
- marker 先于调用持久化；持久化失败不 dispatch。已写 marker 后取消仍保留预留，不能把它计为已测量 Provider 消耗。
- 记录原生事件及至多三份完整请求快照（移除 AbortSignal，每份上限 128000 字节）。这些是私有材料，不能直接返回 Web。
  暂未实现 baseline/candidate 完整组成比较，不能宣称 cache 中性或配对公平性已经证明。
- 定时器在函数作用域释放；Agent handle 在 finally 中 dispose，`llm/stream` 监听在所有退出路径撤销。
  该模块不删除原生历史，也不声称撤销已发生的付费调用。

## 验证

在 `packages/dsh-evolve` 执行（实际 checkout 路径以 `AUDITED_DSH_SOURCE` 脱敏）：

```sh
DSH_EVOLVE_DSH_SOURCE_DIR="$AUDITED_DSH_SOURCE" pnpm exec vitest run test/conversation-draft-trial-guard.test.ts
pnpm run build
pnpm exec tsc --noEmit -p tsconfig.test.json
```

根目录执行 `pnpm run check:docs` 和 `git diff --check`。

结果：九项测试通过。使用真实原生 Agent Registry/Agent Loop/Tools/Skills 及上游 `tool-skill`，但使用内存 Session
和无密钥模拟模型，不是 clean-profile 部署、持久化冷恢复或真实模型效果验证。

覆盖：原生按需 Skill 加载（首请求只有摘要、加载后正文才进入下一请求）、全局 Skill/Tool 隔离、owned disposal、
三调用循环上限、全局 retry 隔离、marker 写失败、同 schema 工具替换、输出参数漂移、调用前取消、缺少 Skill 依赖。

下一步是持久化一次性对照计划、真实原生结果校验及只读状态展示，再部署并运行已封存测试；结果相同、失败或退步均
必须保留。此记录不支持“已学会”、泛化、晋升或 Hermes 替代声明。

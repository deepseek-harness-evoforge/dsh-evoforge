# 新草稿的独立语义判分：实现与默认关闭部署

日期：2026-09-17。基于 `ba61a47`。这是无付费的机制验收，不是真实模型评分质量或学习效果实验。

## 用户结果与边界

新增 `conversationDraftTrialPolicies[].semanticEvaluation`，默认 false，启用要求日预算至少 44（仍不超过 72）。
仅作用于没有历史实验的新草稿；不能将旧字面试验切换模式后重新运行或改分。
一次完整预留包含 12 次裁判校准、八次答案判分和至多 24 次原生 Agent 执行请求，所有预留保守保留。

裁判复用来源的原生 provider/model，通过 DSH LLM 单独请求，只收到封存任务与单个答案；不提供草稿、组别标签、
参考答案、期望结论或竞争答案，不使用工具或 Agent Loop。它与 proposer 上下文分开，但仍使用同一模型；
答案自身也可能暴露风格，因此不能称为模型家族独立或完美匿名。

先以封存参考正例、替代正例、负例分别校准，每题期望 pass/pass/fail；任何不符或 uncertain 都在创建试验 Agent 前停止，
写入 `rejected/judge-calibration-failed`。校准通过才执行八个原生分支，按同一规则逐个判断最终答案。
裁判引用必须是任务或答案中的原文；Host 校验引用存在、结构完整和合法结论，不假装能够证明模型推理正确。
比较值采用语义判分，但 leg 原有 `passed` 继续保留字面断言结果；旧记录完全不变。
uncertain、执行不完整、组成不可比、改善分支没有加载草稿均不能形成可靠改善结论。

模型请求标记在调用前持久化，绑定任务/答案/route/prompt hash；版本为 `semantic-v1`。每次最多 1000 输出 token，
60 秒取消通知，无自动重试。错误或取消保留已知用量，未知不计为零；任何裁判标记也会阻止初始化恢复授权。
来源与原生 Workspace 在每次新请求前复核。卸载通过既有 Cordis-owned monitor 取消并等待工作；没有第二运行时或调度器。
普通 Session 的 prompt/工具/Skill 组成不变，新增模型表面只属于独立评测请求。

## 实际无付费验证

官方 checkout fetch 后 HEAD 与 `origin/master` 同为 `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`，干净；
继续使用已审计可构建的 `0.1.6-alpha.1`，本轮没有修改或重新全量构建 DSH。

```sh
DSH_SOURCE_ROOT=<audited-checkout> pnpm run generate:typert
pnpm run pack:suite -- --suite product --out <private-staging>
DSH_EVOLVE_DSH_SOURCE_DIR=<audited-checkout> DSH_EVOLVE_PACK_DIR=<pack> \
  pnpm --filter dsh-evolve exec vitest run \
  test/conversation-draft-judge.test.ts test/conversation-draft-trial-store.test.ts \
  test/conversation-draft-trial-guard.test.ts test/conversation-correction-native.e2e.test.ts \
  test/conversation-skill-draft.test.ts test/config-contract.test.ts test/packed-profile.e2e.test.ts
pnpm --filter dsh-evolve-web exec vitest run test/evolution-action.client.test.tsx test/package-contract.test.ts
pnpm --filter dsh-evolve exec tsc --noEmit -p tsconfig.test.json
pnpm --filter dsh-evolve-web exec tsc --noEmit -p tsconfig.test.json
pnpm run check:docs
git diff --check
```

- Host 七文件 63 项通过；Web 两文件 44 项通过；类型、文档和 diff 检查通过；七个 product 包构建打包通过。
- 原生无 Goal fixture 新增语义模式：12 次校准 + 八分支 + 八次判分完成，原用户 Session 内容不变，冷恢复不重复调用。
  模拟判分通过而字面断言失败时采用语义计数；裁判 uncertain 时比较为 inconclusive，不标为改善。
- 校准失败在第一个错误判断停止，零试验 Agent/执行请求；在途取消、部分 usage、冷重启与恢复授权拒绝覆盖。
- 独立请求不携带 Tools、角色答案标签或其他答案；无效引用、非 stop、非法 JSON 等不产生分数；公开 projection 不包含理由或原文引用。
- 干净配置从实际 tarball 安装演化 Host/Web/Control 三包，官方 dump、AppBoot、Loader 禁用/启用、原生模拟会话、
  dispose/remove、原生重启及完整 SessionPersistence 读回通过；测试不覆盖真实付费在途重载或全部产品套件。
- RED 测试先证明旧配置不接受语义选项；实现中发现状态返回的字段顺序与持久解析顺序不同会触发错误的 stale 检查，
  现统一返回实际解析并持久化的记录。原生端到端与校准拒绝测试覆盖该问题。

## 现用部署

只更新演化 Host/Web，持久 product pack：`f1de82a3cf346752bf6126e82244450c088aa70a026b32e98f6f1529ccd004ad`。
先停止旧 Host，官方 add/dump 成功后启动 PID 41806；仅其监听 `127.0.0.1:3000`。
现用配置未设置 semanticEvaluation=true，预算文件逐字节不变；没有新增真实模型调用。
42 个原生 Session 文件及十个 EvoForge 存储文件与部署前备份逐字节相同。

实际原生页面整页重载、点击刷新并检查窄屏截图：原会话仍 22 轮/47 步、原模型和权限不变；旧字面得分双方 0/4，
10 次任务执行请求、9357/1567 token、旧失败根及 48/24 保守预留均保留。新标签区分任务执行请求和裁判请求标记。
语义结果/拒绝界面当前仅有组件证据；没有往真实账本注入假结果来拍截图，也未声称现场触发过新语义流程。

## 未完成与下一步

已向用户请求全新真实试点的一次性额外预算（上限 60 请求），尚未收到授权；不能以默认选项已显示当作同意。
当前日试验预留 48、政策上限 24，不能清零历史或绕过 72 硬上限启动一组新的 44 槽实验。
获授权后仍须在预算允许的窗口执行新的纠正来源和新封存题，不复用已看过的旧八个答案当未见数据。

本次不证明真实模型能稳定判断等义表达、抵抗答案提示注入、正确检查视觉布局或外部副作用。
启用前仍需真实质量验证；语义判分本身也不授予 Skill 晋升、未来 Session 切换或精确回滚权限。
普通纠正的完整学习链路和同条件 Hermes 对比仍未完成。现有记录可回退前一代码包；产生语义新记录后，旧 schema
不保证读取，不能删除历史强行降级。

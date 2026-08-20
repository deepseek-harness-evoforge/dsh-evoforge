# V4.39 现有 Skill 精确成对 Holdout 评测

日期：2026-08-21
状态：`implemented`（自动化与最终 tarball 真实 DSH Web 验证通过；真实 provider Trial 尚未完成）

## 本增量回答的问题

V4.37 只证明 exact baseline/Candidate 双树结构合规，V4.38 只证明 Candidate 不可见的 protected holdout 已在 proposer 前独立形成。V4.39 首次把 exact Admission、baseline、Candidate 与 Holdout Envelope 放进同一 assembled DSH paired Trial，并将任务结果与完整性门分开记录；它仍不授予 Retention、晋升或发布资格。

## 实现事实

- 新 `ExistingSkillHoldoutEvaluation` 重新解析 `qualified-for-holdout` Admission、调用时封存的完整 baseline Bundle、exact Candidate 和 Candidate authorship/content identity 已绑定的 exact Candidate-blind Envelope；运行 id 内容寻址绑定所有上游 identity、三棵树和固定 DSH revision。Envelope 缺失或 id 错配在 Candidate 物化与 Trial 前失败关闭。
- baseline/Candidate 以两个完整 `skill-tree` 目录进入同一 `runPairedTrial`；Case Pack 固定 assembled、四次 Trial、Candidate limit 1，拒绝 capability-absent subject。
- Trial 前后分别重算 baseline、Candidate、Case Pack tree；known-bad/known-correction calibration、assembled execution、非目标 composition 与输入完整性任一失败都不能形成效果判决。
- 终态分类固定为 `fail/pass → improved`、`pass/pass → ambiguous`、`fail/fail → not-improved`、`pass/fail → regressed`；物化漂移为 `protected`，Trial/完整性失败为 `incomplete`。
- durable state 在付费执行前进入 `trial-pending`；若进程在观察到结果前中断，重启生成 `paired-trial-outcome-uncertain`，不盲重试。只清理本运行拥有、尚未付费的物化目录。
- `ExistingSkillHoldoutEvaluationScheduler` 只复用原生 DSH Jobs；实时 Admission 回调与启动扫描都从 durable qualified Admission 恢复，没有第二套 scheduler。
- Host control plane 与 `dsh-evolve-web` 展示 Candidate/Admission/Envelope、三棵树、双方结果、calibration/assembled/composition/integrity、model calls 和 input/output/cache-read tokens；不投影路径、保护正文、evaluator 或 provider identity。
- 所有终态固定 `releaseAuthority: none`。`improved` 只是这一 exact holdout 的效果证据，不创建 Generation、不晋升，也不影响当前 Session。

## 自动化证据

- `existing-skill-holdout-evaluation.test.ts` 覆盖 exact assembled `skill-tree ↔ skill-tree` 四象限 verdict、内容寻址幂等、脱敏扫描、已 dispatch Trial 中断不盲重试、Trial 前后 Candidate 漂移阻断、原生 Jobs 启动恢复及启动扫描/实时回调重复观察去重。
- `skill-candidate-repository.test.ts` 与 `existing-skill-candidate-authoring.test.ts` 证明新 Candidate 持久化 exact pre-Candidate Envelope，且 Envelope 改变会改变 Candidate 内容 id；非法 Envelope id 在入库前阻断。
- `existing-skill-holdout-governance.test.ts` 覆盖 Envelope 自校验、exact Candidate binding 与错误 Envelope id 拒绝；`existing-skill-holdout-evaluation.test.ts` 另证明错配及可读 legacy 无绑定 Candidate 都不会进入 Trial。
- `evolution-control-plane.test.ts` 覆盖三棵树、verdict、完整性、model/token/cache 和无发布权的 Host 权威投影。
- `evolution-action.client.test.tsx` 覆盖 DSH Web 独立 paired-holdout 分区和失败边界；浏览器 fixture 只种植权威结果用于 UI 验收，不冒充真实 provider Trial。
- 当前包级验证：`dsh-evolve` 247 passed / 1 skipped，`dsh-evolve-web` 20 passed；Typert generated Host/Remote 已按固定 DSH revision 更新。
- 根目录 `pnpm check` 以退出码 0 通过：文档链接/公共路径、11 包 typecheck、全仓测试与全部 build 均成功。

## 最终 tarball 真实 DSH Web 证据

- 从最终 `dsh-evolve`/`dsh-evolve-web` tarball 经 DSH 官方 `plugin --profile web add` 安装到隔离 profile，并由官方 Host 在 `127.0.0.1:3094` 启动。
- 真实浏览器读取到 exact Candidate/Admission/Envelope、baseline/Candidate/Case Pack tree、`fail/pass`、四项门禁、双方 model/token/cache 和“仅形成证据 · 无晋升或发布权限”。
- 整页 reload 后身份与判决不漂移；Host 停止后手动刷新明确显示 `Failed to fetch` 且保留最后成功快照；同 profile、同端口恢复后告警清零，exact evidence 不漂移；浏览器 error log 为空。
- 官方 `plugin --profile web remove dsh-evolve-web dsh-evolve` 后，profile package/lock 中不再含两个包；移除验收专用 overlay 后，`--dump-config` 中 `dsh-evolve|evoforge` 计数为 0。

## 证据边界

- 自动化成功路径使用注入的确定性 paired Trial executor；生产默认路径调用真实 `runPairedTrial`，但本增量没有使用两套独立真实 provider 跑出该 `improved` 样本。
- 真实浏览器验证的是最终 tarball 的 Host 投影、reload、断连、恢复与卸载，不是外部模型效果本身。
- existing-Skill Retention、Canary、future-Session promotion、精确 rollback、长期误晋升/负迁移/遗忘数据仍未完成。
- 真实飞书 exact route、同任务同模型同权限同预算的 Hermes paired benchmark 与首个发布 tag 仍被门禁阻止。

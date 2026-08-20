# V4.35 现有 Skill 纠正证据隔离封存

日期：2026-08-21
状态：`implemented`（自动化验证通过；尚未生成 existing-Skill Candidate）

## 本增量回答的问题

V4.34 只能回答“这些纠正是否针对同一个完整 Skill Bundle”，不能回答“用户到底纠正了什么”。`FeedbackSignal` 又必须保持 reference-only，不能变成 Transcript/Prompt 仓库。本增量把当前纠正文和精确 durable Goal/请求上下文封存在 Candidate 不可篡改的治理面，并在模型编写前完成 authoring/admission/holdout/retention 分区。

## 实现事实

- `ExistingSkillEvaluationEvidenceVault.prepare(opportunity)` 先重跑 exact baseline qualification，再通过官方 Message Feedback 和 Session Persistence 服务解析证据；没有私读 DSH storage table。
- message/version/updatedAt、assistant seq/turn、唯一 human request、唯一 successful Skill invocation、route/seq/content hash、Goal id/revision 全部精确匹配。
- 四个不同 Goal 分为 2 authoring、1 admission、1 holdout；第五个及以上增加 1 retention；最多选择 12 个不同 Goal，同 Goal 重复不增加独立样本。
- proposer 返回值只有 authoring cases。治理 manifest 才含 protected samples 及 Session/message/version 来源；Remote/Web 只投影 evidence/qualification/baseline id、分区计数和阻断原因。
- manifest 与 authoring input 分别内容寻址；写入使用原子 rename、文件 mode `0600`，读取时重验 exact real path、Schema、byte bound 和内容 identity。
- 少于四个 Goal 不读取纠正文；feedback 漂移、Session/Goal/Skill 归因漂移、服务不可用、内容超限和 sealed manifest 篡改均 abstain/invalid。
- 固定无 Candidate、安装、激活和发布权；当前 Session 不变。

## 自动化证据

- `existing-skill-evaluation-evidence-vault.test.ts` 使用真实 `InstalledSkillBaselineVault` 与 `ExistingSkillBaselineQualification`，构造四至五个 durable Session 前缀，验证分区、protected 不可见、Retention、少样本零读取、feedback 漂移、manifest 篡改和崩溃残留目录不覆盖。
- `evolution-control-plane.test.ts` 验证 Host 只投影有界 readiness。
- `dsh-evolve-web` 客户端测试验证 Web 展示 evidence 阻断，不显示纠正文。
- 固定 DSH revision `47f943859bef60e4160492346772ded9b24f765a` 重新生成 Typert，生成物 freshness gate 通过。

- 根目录 `pnpm check`：文档链接/公开路径、11 包 typecheck、452 tests passed/3 skipped 与全部 build 通过。

## 尚未证明

- protected whole-tree existing-Skill author；
- existing baseline/candidate admission、holdout、Retention、Canary 和回滚整链；
- 真实 provider、真实浏览器 sealed/invalid 恢复、真实飞书 exact route；
- Hermes 同任务/模型/权限/预算 paired benchmark。

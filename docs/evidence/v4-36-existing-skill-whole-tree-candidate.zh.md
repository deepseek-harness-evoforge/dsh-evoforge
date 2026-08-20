# V4.36 现有 Skill 受保护整包 Candidate

日期：2026-08-21
状态：`implemented`（自动化验证通过；尚未进入 existing-Skill paired evaluation）

## 本增量回答的问题

V4.35 已隔离真实纠正证据，但还没有生成任何现有 Skill 改进制品。本增量把同一精确 baseline、qualification 和 protected authoring evidence 变成一个完整、内容寻址、不可执行且无发布权的 existing-Skill Candidate。它不做能力获取，不要求用户选 Skill 或路径，也不复用 capability-absent 新 Skill 的评测语义。

## 实现事实

- `ExistingSkillCandidateAuthoring.reconcile()` 自主消费内部 existing-Skill opportunity，经 baseline/evidence 双重重验后由原生 DSH Job 执行；公开 policy 仍只有 Workspace、owned run root 和日预算。
- proposer 只见 baseline 文本、二进制资源的 path/mode/size/digest 和 authoring cases；admission/holdout/Retention、Session/message identity、Host path 不可见，也没有外部搜索/市场/安装入口。
- 作者只能修改 `SKILL.md` 和一层 `references/*.md`；Host 拒绝删除、rename、path/Skill identity 漂移、代码/二进制修改、no-op、超限和 permission/allowed-tools/license 漂移。
- `SkillCandidateRepository.quarantineExisting()` 从精确 baseline 重组完整 canonical tar.gz；所有未修改文件逐字继承，二进制资源不经过模型重写。
- Candidate archive/tree、baseline、qualification、evidence 和 author identity 共同进入内容地址；Host artifact vault 使用 exact real path、原子 rename、0600 文件和读取时 digest/tree/manifest 重验。
- existing-Skill Candidate 使用独立 DSH Storage domain，固定 inactive/quarantined/unevaluated/never-executed/no-release-authority；没有安装、激活、评测或发布接口。
- paid call 前先写 durable pending；未观察到响应或重启遇到 pending 时持久化 `uncertain` 并拒绝盲重试。
- Host/Remote/Web 展示 authoring phase、调用/token、baseline/qualification/evidence 短 identity、Candidate tree、changed/added/preserved 文件与二进制计数；浏览器不接收 model claim、正文、保护样本和 Host 路径。

## 自动化证据

- `existing-skill-candidate-authoring.test.ts`：验证自主调度、proposer 可见面、完整整包 Candidate、二进制保护、成本状态和 paid-call uncertain 重启拒绝盲重试。
- `skill-candidate-repository.test.ts`：验证 exact baseline 继承、完整 materialization、内容寻址、二进制逐字一致及 permission/license declaration 漂移拒绝。
- `evolution-control-plane.test.ts`：验证 Host 投影 authoring state 与 Candidate 谱系/diff，同时移除 model claim 和 Host 路径。
- `evolution-action.client.test.tsx`：验证 DSH Web 显示受保护编写状态与整包 Candidate 差异，不提供安装、激活或路线菜单。
- Typert 生成固定使用 DSH revision `47f943859bef60e4160492346772ded9b24f765a`；生成物 freshness gate 纳入根级检查。
- 根目录 `pnpm check`：文档链接、11 包 typecheck、455 tests passed/3 skipped 与全部 build 通过。

## 尚未证明

- existing baseline/candidate 的 deterministic admission、assembled holdout、Retention、Canary、回滚与晋升；
- 真实 provider authoring、真实浏览器断线/恢复和最终 tarball clean-profile 生命周期；
- 长期误晋升、负迁移、遗忘、复用、成本/cache/时延与精确回滚数据；
- 同任务、同模型、同权限、同预算的 Hermes paired benchmark。

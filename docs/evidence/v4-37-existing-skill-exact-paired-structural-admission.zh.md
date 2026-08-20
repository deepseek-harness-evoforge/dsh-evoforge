# V4.37 现有 Skill 精确双树结构准入

日期：2026-08-21
状态：`implemented`（自动化验证通过；尚未执行 assembled holdout）

## 本增量回答的问题

V4.36 的 existing-Skill Candidate 已是完整整包，但还没有一个独立门禁证明它仍精确继承声明的 installed baseline、只包含声明的 instruction diff，并绑定 Candidate 不可见的 admission 证据。本增量建立该 Host 结构准入，同时明确不把文件完整性检查冒充任务效果胜出。

## 实现事实

- 新 `ExistingSkillCandidateAdmission` 与 capability-absent `SkillCandidateAdmission` 分离；未给旧 Envelope 增加混合 subject 分支。
- `InstalledSkillBaselineVault.resolveBaseline()` 只按 Workspace/baseline 内容地址读取并重验 canonical archive；不从当前目录或 Skill 名重建旧版本。
- admission 读取 exact Candidate 的 opportunity/qualification/baseline/evidence identity，并从 governance vault 取得唯一 protected admission sample；authoring digest 或任一 identity 漂移立即 `protected`。
- Host 在隔离运行目录物化 baseline 与 Candidate 完整树，重新计算 artifact/tree，逐字比较所有路径和内容；实际 changed/added/preserved/binary 必须与 Candidate 声明一致，删除、未声明差异和越过 `SKILL.md`/一层 `references/*.md` 的修改均阻断。
- durable state/result 按 Candidate、Opportunity、Qualification、Baseline 和 Evidence 内容寻址并加锁；terminal 结果幂等，依赖未就绪的 incomplete 可恢复重试。
- Candidate repository 落整包后直接唤醒 `ExistingSkillCandidateAdmissionScheduler`；启动时从 DSH Storage Candidate 队列恢复，执行和取消进入原生 DSH Jobs。
- 通过态固定 `qualified-for-holdout`，只携带 exact 双树、protected sample digest 和 diff 计数；`candidateExecuted: false`、`evaluatorClass: host-structural`、`releaseAuthority: none`。
- Host/Remote/Web 新增独立 existing-Skill admission 投影，显示 status/reason、baseline→Candidate tree、diff 计数和 protected sample 摘要；不下发正文、样本、Host 路径或效果判决。

## 自动化证据

- `existing-skill-candidate-admission.test.ts`：验证 exact 双树/protected evidence 绑定、持久幂等读取、证据漂移阻断、未声明 diff 阻断和原生 Jobs 恢复。
- `installed-skill-baseline.test.ts`：验证按 exact baseline id 重读完整 Bundle，并继续在 archive 篡改时失败。
- `skill-candidate-repository.test.ts`：验证 existing-Skill Candidate 落盘后进入唯一 admission 调度缝隙。
- `evolution-control-plane.test.ts`：验证浏览器安全的 existing-Skill admission 权威投影。
- `evolution-action.client.test.tsx`：验证 DSH Web 分栏显示结构准入及“未执行、无发布权”边界。
- Typert 生成固定使用 DSH revision `47f943859bef60e4160492346772ded9b24f765a`；freshness gate 已更新。
- 根目录 `pnpm check`：文档链接、11 包 typecheck、457 tests passed/3 skipped 与全部 build 通过。

## 尚未证明

- protected holdout 的独立作者、校准 Case Pack 与真实 `skill-tree ↔ skill-tree` assembled DSH Trial；
- existing-Skill Retention、Canary、future-Session promotion 和精确 rollback；
- 真实 provider、最终 tarball clean-profile、真实浏览器失败恢复和长期误晋升/负迁移数据；
- 同任务、同模型、同权限、同预算的 Hermes paired benchmark。

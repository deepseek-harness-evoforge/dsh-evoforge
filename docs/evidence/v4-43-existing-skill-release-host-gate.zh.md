# V4.43 现有 Skill 独立发布门与 future-Session 同名替换

日期：2026-08-21
状态：`implemented`（Host/Storage/Command 与真实 DSH Session 自动化已验证；Control/Remote/Web 已由 [V4.44](v4-44-existing-skill-release-control-web.zh.md) 接入，最终 tarball 浏览器已由 [V4.45](v4-45-existing-skill-release-final-browser.zh.md) 验证，failed-Outcome Canary Host/Jobs 已由 [V4.46](v4-46-existing-skill-failed-outcome-canary.zh.md) 补齐）

## 本增量回答的问题

V4.41/V4.42 已证明现有 Skill Candidate 在独立 Holdout 与 Retention 上胜出，但所有评测都刻意没有发布权。V4.43 增加独立 `ExistingSkillRelease`：它不复用 capability-absent Shadow Review，不让 evaluator 自授权限，只在用户明确批准后发布 inactive Generation，再由另一动作选择未来 Session。

## 实现事实

- `existing-skill-candidate-lineage-v1` 逐项绑定 Candidate、Workspace、Skill、Opportunity、Qualification、baseline id/archive/tree、protected evidence、Admission、Envelope、Holdout/Retention 与两套 Case Pack；Generation 恢复时严格解析。
- Host gate 同时扫描唯一且无 warning 的 Admission、Holdout、Retention 权威 owner；只有 `qualified-for-holdout + improved + retained` 且 baseline/Candidate 双树、`fail/pass`、calibration、assembled、composition、input integrity、零 proposer 和固定 Trial 数全部一致时才 eligible。
- `approve` 先重新读取 Candidate vault 中的 canonical sealed archive，保留二进制及其余完整目录树，验证当前 active parent，同名 artifact 只能替换 exact baseline；发布后 active pointer 不变。`promote` 再次重验 durable 人工决定、lineage、Generation 与 active parent，才调用官方 EvolutionStore。
- approve/reject 进入独立 DSH Storage Domain；决定不可变、重启可恢复。拒绝不会创建 Generation，批准与晋升分离；评测结果继续固定 `releaseAuthority: none`。
- `/evolve existing ...` 提供人工查看、approve/reject 和 `promote-existing`，不增加模型 Tool、Session、Goal、Agent Runtime、scheduler 或第二审批体系。
- Generation bundle 验证器对 missing-Skill 继续使用受限 text bundle，对 existing-Skill 使用完整 sealed bundle；两条 lineage 显式判别，旧 Web/Promotion 投影不会误把现有 Skill 当作 missing-Skill。

## 自动化证据

- `existing-skill-release.test.ts`：eligible→人工批准→inactive Generation→独立 promote；Retention warning fail closed；终态 reject；active 同名 exact parent 替换且保留无关 artifact；候选含二进制文件。
- `generation-store.e2e.test.ts`：真实 DSH Storage 重启后决定仍可读取，重复记录幂等，冲突决定拒绝。
- `generation-binder.e2e.test.ts`：真实 DSH Agent/Session/SkillRegistry 中，晋升前原生同名 Skill 可见；晋升后只有新 Session 看见 Generation Candidate；旧 Session保持原生；回滚后新 Session恢复原生，而已固定 Candidate 的 Session不漂移；二进制资源仍逐字节可读。
- `evolve-command.test.ts`：人工批准只产生 inactive Generation，`promote-existing` 才影响未来 Session。
- 聚焦验证：4 files / 27 tests passed；`dsh-evolve` host/test TypeScript typecheck passed。

## 发布边界

- 后续 [V4.44](v4-44-existing-skill-release-control-web.zh.md) 已把同一 Host owner 接入 `EvolutionControl`、Typert Remote 与 DSH Web；[V4.45](v4-45-existing-skill-release-final-browser.zh.md) 又完成最终 tarball 浏览器的刷新/断连/恢复/卸载验证。
- failed-Outcome Canary、证据驱动回滚、两套独立真实 provider、真实飞书 exact route、Hermes paired benchmark 与长期负迁移/误晋升/误回滚数据仍阻止 tag 与完成声明。

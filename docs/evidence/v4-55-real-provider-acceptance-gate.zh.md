# V4.55：双真实 Provider 自进化验收入口

## 结论

仓库现在有一个阶段专用 RP-1 入口，用来回答此前一直没有被真实证据回答的问题：同一条内部
Goal→Gap→Opportunity→whole-Skill Candidate 链，能否由真实 proposer Provider 生成 Candidate，再由另一套真实
governance Provider 生成 Candidate 不可见的 admission、holdout 与 Retention 治理包，并通过现有生产 Admission、
assembled Shadow 和 Retention。

入口代码已实现；当前结果严格是 `NOT_RUN`。本次没有用户对付费请求的精确批准，环境也没有第二套独立
Provider，因此没有发起任何外部模型请求，不能把合同测试写成真实 Provider 通过。

## 产品边界

- RP-1 位于 `benchmarks/provider-v0.1/rp1-internal-skill-evolution`，不是 DSH/Codex 插件，也不打包安装；
- 不创建 Session、Goal、Agent Runtime、审批体系、市场、能力获取或通用 benchmark 平台；
- 输入是五条冻结的 DSH 内部 Capability Gap 事实，没有外部 Skill 搜索、下载或导入；
- 直接复用 `ExperienceDrivenSkillOpportunityDiscovery`、`SkillEvaluationEvidenceVault`、
  `SlowLoopSkillAuthoring`、`SkillEvaluationGovernance`、`SkillCandidateAdmission`、
  `SkillCandidateShadowLauncher`、`InternalSkillRetention` 与固定 DSH `jobs-local`；
- assembled evaluator 仍运行在现有 macOS Seatbelt 中，只获得净化环境且无网络，不继承 Provider 凭据；
- 通过也只证明真实作者/治理者与 assembled gate 的这一阶段，不是 Hermes paired 或长期用户效果。

## 付费和独立性门

入口必须先看到精确批准值 `I_APPROVE_PAID_REAL_PROVIDER_EVALUATION`，否则在读取 Provider 配置前输出
`status: not-run` 并退出 2。批准后仍会在 dispatch 前拒绝：

1. 缺失的 Provider、model、credential 或固定路径引用；
2. 相同 declared provider id；
3. 相同 HTTPS authority；
4. 相同 credential value；
5. 相同生产 model identity；
6. localhost、明文 endpoint、根路径、非 canonical path 或运行根重叠；
7. dirty EvoForge revision、DSH revision 漂移或缺少固定 DSH Jobs build。

stdout 与 durable result 只含 provider id、model、authority hash、model identity、revision、内容身份、usage、
stage、outcome 和 hard gates。API key、base URL、DSH/private run path 会在异常路径中继续脱敏；已有 terminal
result 也必须重新匹配 exact epoch/revision/provider identity，且不得含私有配置。

## 自进化 hard gates

- 五个不同 Goal 自主形成唯一 Opportunity；
- Candidate 在 Admission 前是 `inactive/quarantined/unevaluated/never`；
- Candidate id、content hash 和 tree hash 不出现在三套治理包；
- 治理包没有 runtime `search` key/目录，只引用 `evidence/rationale.md`；
- governance 完成 admission/holdout/Retention 三个受保护角色；
- deterministic Admission 只给出 `qualified-for-shadow`；
- assembled Shadow 只有 recommendation `promote` 且 composition stable 才通过；
- 独立 Retention 必须为 `retained`；评测结果自身没有发布或 pointer 写权。

## 已执行验证

```text
pnpm benchmark:provider:rp1:typecheck
→ passed

pnpm benchmark:provider:rp1:test
→ 8 tests passed
```

合同覆盖未批准、所有缺失引用、同 provider/authority/credential、localhost/明文 endpoint、secret-free ready
report，以及实际子进程 `NOT_RUN + exit 2`。

```text
pnpm check
→ documentation links/public paths passed
→ 11 个 workspace package typecheck passed
→ 540 tests passed / 3 skipped
→ 11 个 workspace package build 与 artifact verification passed
```

## 当前阻塞与下一步

要获得第一份真实结果，还需要：

1. 用户明确批准这一轮最多 1 次 proposer + 3 次 governance 的外部付费 authoring；
2. 提供第二套与当前配置不同 authority、credential 和 model identity 的真实 Provider；
3. 固定 checkout 的 DSH `jobs-local` build 和私有 run root；
4. 在干净 `main` commit 上运行 `pnpm benchmark:provider:rp1` 并审计 `result.json`；
5. 失败结果按真实阶段修正，不改写 epoch/holdout 来追分，不对未知付费结果盲重试。

即使 RP-1 首次通过，真实飞书 exact route、长期 transfer/negative-transfer/false-promotion/rollback、完整
clean-profile 发布门和同条件 Hermes paired benchmark 仍然 pending，因此仍不能打 tag 或宣布上位替代完成。

# V4-8 DSH 内部 Skill Opportunity 发现与隔离生成证据

> 声明等级：`implemented`，不是 `verified/released`。本文只证明内部经验纵切的代码、状态和自动化门；真实 provider 的独立评估与长期 outcome 尚未闭合。

## 用户结果

用户只提交自然语言 Goal。DSH 已有 Skill 继续由原生 catalog/`skill` Tool 自主路由；确无适用能力时，
稳定的 `report_capability_gap` Tool 只负责提交候选名称，Host 复核 active Goal、完整 settled catalog、
Workspace/Session 和 exact Skill 缺失后持久化 Gap。系统随后从自身跨 Goal 经验中推导 Skill Opportunity，
并在有界 policy 下生成隔离 whole-Skill Candidate；用户不选择路径、Agent、workflow、Skill 或来源。

## 精确数据流

```text
native Goal
  → Host-verified Capability Gap
  → ExperienceDrivenSkillOpportunityDiscovery
  → selfDiscoveryPolicy（Workspace/runRoot/day budget；无 Skill）
  → native DSH Job author
  → canonical instruction-only whole-Skill v1
  → private durable quarantine
  → DSH Web Gap → Opportunity → Candidate
```

`SkillOpportunity` 的资格同时要求：

- 同一 Workspace；
- 同一合法 Skill 名；
- 至少两个不同 Goal id；
- 每条 Gap 已持久化并绑定 Goal；
- 当前没有覆盖该机会的 Candidate。

同 Goal retry、无 Goal、跨 Workspace、证据不足或已有 Candidate 都 abstain。Opportunity 只有
`eligible-for-authoring` 资格，`releaseAuthority` 固定为 `none`。

## 模型与状态边界

- Session 模型面仍只有固定 `report_capability_gap` 增量；没有动态 source/search/research Tool。
- author 只收到有界 Goal/Gap identity、objective 和时间证据；Prompt 明确禁止外部搜索、引用、虚构来源、
  测试结果和 release 主张。
- 可能付费的 author 调用受 Workspace policy、UTC 日预算、原生 Job、取消和 durable journal 约束；
  `authoring-pending` 崩溃后转 `uncertain`，禁止盲重试。
- Candidate 只允许根 `SKILL.md` 与一层 `references/*.md`，拒绝脚本、非普通文件、路径逃逸、identity 不符、
  大小超限和 unchanged/invalid output。
- Candidate 固定为 inactive/quarantined/unevaluated/never-executed；本纵切没有安装、激活、晋升或发布接口。

## 已删除的偏差公共面

当前插件 Config 和 composition 已移除：

- 外部 trusted discovery sources；
- Agent Skills index sources；
- exact `slowLoopAuthorTargets` Skill 预配置；
- 运行时 DSH Web official/open-source/frontier research；
- `researchHoldoutTargets` / `researchRevisionTargets` 及对应 Job 编排；
- Web 外部发现 attempts、research Holdout 和 research revision 当前投影。

旧 candidate/attempt schema 不再由当前 Storage Domain 读取或迁移。当前 composition 改用独立
`evoforge_skill_candidates` Domain 和 `SkillCandidateRepository`，只允许 internal-experience v1
quarantine/materialization；旧 acquisition class、fetch loop、research Jobs、zip 获取依赖及 Web 投影已从
活动源码删除。本项目不预留未来外部包获取产品接口。

## 关键实现

- `packages/dsh-evolve/src/skill-opportunity-discovery.ts`
- `packages/dsh-evolve/src/slow-loop-skill-authoring.ts`
- `packages/dsh-evolve/src/skill-candidate-repository.ts`
- `packages/dsh-evolve/src/skill-bundle-archive.ts`
- `packages/dsh-evolve/src/skill-candidate-admission.ts`
- `packages/dsh-evolve/src/skill-candidate-lineage.ts`
- `packages/dsh-evolve/src/skill-candidate-shadow.ts`
- `packages/dsh-evolve/src/index.ts`
- `packages/dsh-evolve/src/evolution-control-plane.ts`
- `packages/dsh-evolve-web/src/client/EvolutionAction.tsx`

## 已执行自动化证据

在固定 DSH 源码 `47f943859bef60e4160492346772ded9b24f765a`（`0.1.0-rc.5`）上：

- `pnpm --filter dsh-evolve typecheck`：通过；
- `pnpm typecheck`：11 个用户包全量通过；
- `pnpm check:docs`：链接与公开路径检查通过；
- `DSH_SOURCE_ROOT=<pinned-dsh-source> pnpm generate:typert`：通过；
- `pnpm --filter dsh-evolve-web typecheck`：通过；
- `pnpm --filter dsh-evolve-web test`：2 files、25 tests 通过；
- `pnpm --filter dsh-evolve exec vitest run --reporter=json`：重构后的当前全量为 55 files、247 tests 通过、2 skipped、0 failed；退出码 0；
- `slow-loop-skill-authoring.test.ts`：8 个内部经验生成、abstain、预算、取消、uncertain、证据边界和无 Skill policy 场景通过；
- `skill-opportunity-discovery.test.ts`：跨 Goal 资格、同 Goal retry、Workspace 隔离与证据不足场景通过；
- `skill-candidate-repository.test.ts` 与 `capability-gap-store.e2e.test.ts`：internal-experience v1 whole-Skill quarantine、独立持久化 Domain、旧 external/source/research shape 不进入记录；
- `skill-candidate-admission.test.ts`、`skill-candidate-lineage.test.ts`、`skill-candidate-shadow.test.ts`：确定性 admission、内部 lineage、独立 assembled holdout 与旧 lineage shape 拒绝。

## 未完成

- 内部 Candidate 的独立 final-test/Shadow/Retention 真实 provider 整链路；
- Goal outcome、用户 correction、复用收益和 Retention 信号共同参与 Opportunity 排序/抑制；
- 源码构建的新投影已通过真实浏览器复验；最终 tarball 安装进 clean-profile 后仍需复验同一路径；
- 同模型 Hermes paired discovery/evolution outcome 与长期负迁移数据；
- 用户配对短语触发的 exact 飞书消息闭环。

因此本证据不能支持“自进化已完成”或“全面上位 Hermes”的声明，也不能创建发布 tag。

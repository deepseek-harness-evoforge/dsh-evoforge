# V4.34 现有 Skill 精确基线资格门禁

## 本增量解决的问题

V4.33 已能在原生调用发生时封存完整已安装 Skill Bundle，但调查仍未证明多次纠正引用的是同一个包。本增量按 [ADR-0077](../adr/0077-existing-skill-authoring-requires-one-exact-baseline-bundle.md) 增加 Host 所有的 `ExistingSkillBaselineQualification`：

- 重新发现并逐字段核对当前 Opportunity，拒绝陈旧或被替换的证据快照；
- 对每个 exact correction 重新读取 `(Workspace, Session, invocation seq)` 不可变引用；
- 逐次重验 archive、manifest、route、Skill、Workspace 与 invocation-content hash；
- 只有全部调用指向同一个完整 baseline id 才形成内容寻址 qualification；
- 任一引用缺失时等待，archive 损坏、归因错配、证据漂移或不同 Bundle 时 fail closed；
- qualification 只给出 `eligible-for-existing-skill-authoring`，固定无 Candidate、安装和发布权。

插件生命周期复用同一个 `InstalledSkillBaselineVault` 同时完成调用封存和资格解析，Cordis `skills` capability reload/dispose 时资格 owner 同步替换或撤销。控制面异步读取资格并只投影有界摘要；生成的 Typert Remote 已按固定 DSH revision `47f943859bef60e4160492346772ded9b24f765a` 更新。DSH Web 展示 baseline provider/source、短内容地址、文件数和 exact invocation/Goal 计数，并分别显示 missing、over-limit、drift、corrupt、mismatch、Bundle conflict 与 governance unavailable。

## 自动化证据

- `existing-skill-baseline-qualification.test.ts`：真实 Cordis `Context`、DSH `SkillRegistry`、文件系统和 baseline vault；两个不同 Goal 的 exact 调用指向同一完整 Bundle 时通过；任一调用引用缺失时等待；渲染内容相同但 reference tree 改变时判 `baseline-bundle-conflict`。
- `evolution-control-plane.test.ts`：资格经 Host 权威 overview 投影，完整 Bundle 文件和路径不进入浏览器合同。
- `evolution-action.client.test.tsx`：Web 显示 qualified baseline 身份、provider/source、文件数和证据计数，且明确尚无 Candidate、安装或发布。
- `DSH_SOURCE_ROOT=/absolute/path/to/pinned-deepseek-harness pnpm generate:typert`：固定 revision 生成成功；`dsh-evolve` build freshness verifier 通过。
- `pnpm --filter dsh-evolve test`：55 files passed、1 skipped；217 tests passed、1 skipped。
- `pnpm --filter dsh-evolve-web test`：2 files、20 tests 全部通过。
- `pnpm --filter dsh-evolve typecheck`、`pnpm --filter dsh-evolve-web typecheck` 与两包 build：通过。
- 根目录 `pnpm check`：文档、11 包 typecheck、446 tests passed/3 skipped 与全部 build 通过。

## 尚未完成

本增量只把 existing-Skill 调查推进到可信的 authoring 输入资格，尚未实现修改完整树的 protected author、existing baseline/candidate Envelope、paired Shadow、Retention、Canary、晋升或精确回滚。Web 资格视图已由 client 自动化验证，但尚未完成最终 tarball 的真实浏览器刷新/失败/恢复验收。真实 provider、真实飞书 exact route、同条件 Hermes paired 和长期负迁移数据仍是发布门禁，不能宣称现有 Skill 自进化或 Hermes 上位替代已经完成。

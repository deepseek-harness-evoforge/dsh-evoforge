# V4.33 现有已安装 Skill 完整 Bundle 基线封存

## 本增量解决的问题

V4.21 已能把明确纠正归因到 exact Skill invocation content，但模型可见正文 hash 不是完整 Skill 包。若直接据此生成 Candidate，就会漏掉 references、图片或其他资源，也无法证明 paired baseline 是用户实际调用的版本。

本增量新增宿主所有的 `InstalledSkillBaselineVault` 和原生 Agent monitor：

- 同时识别 DSH 用户显式 Skill 注入和成功、source-linked 的模型 `skill` Tool 调用；
- 在 `agent/session-start` 固定高水位，只封存之后的新调用；冷恢复历史记录不以当前资源目录补造旧基线；
- 复用相同 Agent scope、Workspace cwd 和官方 `renderSkillContent()` 校验 exact model-visible content；
- 只接受独立目录型 `<resourceBase>/SKILL.md` 包，完整读取目录内所有 regular files；
- 拒绝 flat/URL/opaque、symlink、特殊文件、可执行文件、超预算内容和扫描漂移；
- 对 DSH definition 与目录各做两次读取，漂移即 abstain；
- 生成 canonical tar.gz、artifact digest、tree hash、definition digest 和内容寻址 baseline id；
- 将 `(Workspace, Session, invocation seq)` 不可变映射到 baseline，重读时重新验证 manifest、archive digest、tree、文件数和总字节；
- 固定 `releaseAuthority: none`，不改变当前 Session 或 active Generation。

`durable-feedback-attribution` 与基线 monitor 现在共用同一个 durable invocation extractor，避免纠正归因和 Bundle 封存对“哪一次调用成功、模型看到什么”产生两套判断。

## 自动化证据

- `installed-skill-baseline.test.ts`：真实 DSH `SkillRegistry` 注册目录型 Skill，封存 `SKILL.md`、reference 与 binary asset，验证内容寻址 manifest、调用映射、完整 archive 重读、flat Skill/symlink abstain 和持久 archive 篡改拒绝。
- `installed-skill-baseline-monitor.test.ts`：真实 Cordis `agent/session-start` + `agent/pre-step` waterfall、原生 Session event、Workspace 解析和 Skill scope 自动触发封存；恢复前历史 invocation 不产生基线，启动后的新 invocation 才封存；Workspace Registry 故障被包含，不阻断 Agent。
- `durable-feedback-attribution.test.ts`：共用 extractor 后，显式调用、模型 Tool、歧义与 source-link 失败合同保持通过。
- `skill-bundle-archive.test.ts`：既有 authored Candidate archive 的顺序、预算与可执行文件拒绝合同未回归。
- `pnpm --filter dsh-evolve typecheck`：通过。
- `pnpm --filter dsh-evolve test`：54 files passed、1 skipped；214 tests passed、1 skipped。

## 尚未完成

本增量只完成“调用时可信封存”，尚未把多个 correction reference 与同一个 baseline 汇合成可 author 的 existing-Skill Opportunity，也没有实现 skill-tree Candidate、existing baseline/candidate Envelope、paired Shadow、Retention、Canary 或晋升。因此状态仍是 `implemented`，不能宣称现有 Skill 自进化或 Hermes 上位替代已经完成。真实 provider、最终 tarball/浏览器投影、真实飞书 exact route 和同条件 Hermes paired 仍是发布门禁。

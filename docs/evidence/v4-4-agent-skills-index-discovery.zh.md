# V4-4 Agent Skills 外部索引发现证据

> 状态：implemented evidence  
> 日期：2026-08-18  
> 边界：证明已确认 Capability Gap 可从部署者显式授信的 Agent Skills Discovery v0.2 索引获取、校验并持久隔离一个单文件 `SKILL.md` 候选；不证明任意市场、归档 Skill、候选生成、自动安装或完整慢环。

## 用户结果

EvoForge 已不再局限于本机 Git 镜像。部署者可以在 `dsh-evolve` 配置中加入
`trustedAgentSkillIndexes: [{ id, indexUrl }]`；用户仍只提交自然语言 Goal，不需要在开场选择来源、Agent、
工作流或 Skill。DSH 原生 catalog 确认能力缺口后，后台 discovery 会 exact-first 查询显式授信索引；exact
不存在且 Gap 带 Goal 时，复用同一个有界、确定性的词法语义选择器。只有唯一强匹配才会下载制品。

下载成功不等于安装。候选固定索引摘要、制品摘要、Skill tree hash、来源域、许可证声明、包元数据与安全
状态，写入 DSH Storage Domain 后保持 `quarantined / inactive / never executed / unevaluated`。后续确定性
admission 从已持久化、摘要固定的原始 `SKILL.md` 物化，不再重新访问可漂移的网络内容。当前 Session、
原生 Skill registry 和模型可见 Skill catalog 均不改变。

## 供应链与失败边界

首个外部纵切只接受 Agent Skills Discovery draft v0.2 的 `skill-md`：

1. 索引地址必须是 `https://<origin>/.well-known/agent-skills/index.json`；仅真实 localhost 集成测试允许
   `http://127.0.0.1`、`localhost` 或 `[::1]`。URL 中的 credential、query 和 fragment 均拒绝。
2. 只处理精确 `$schema = https://schemas.agentskills.io/discovery/0.2.0/schema.json`；未知或缺失 schema
   fail closed，不猜 v0.1。
3. 索引最多 1 MiB、512 个 Skill；`SKILL.md` 最多 64 KiB。请求有 10 秒上限、最多三次 redirect，并校验
   HTTP 状态与媒体类型。
4. 相对 URL 按索引最终 URL 解析，但 artifact 与所有 redirect 必须留在部署者授信的同一 origin；跨域制品
   在发起下载前拒绝。
5. 下载原始字节的 SHA-256 必须与索引 `sha256:<hex>` 完全一致；文本必须是可逆的 UTF-8；frontmatter
   的 `name`、`description` 必须与索引项一致。
6. `archive` 明确返回 `unsupported-artifact-type`。在实现摘要校验后的 zip/tar 路径穿越、link、文件数、
   解压尺寸和 regular-file 门禁前，不以“支持 whole-Skill”为由冒险解包。
7. Verified body 只保留在 Host 私有 durable candidate 中；Typert/Web 投影不包含正文。Web 只显示来源域、
   v0.2、index/artifact/tree/content 摘要、许可证、包规模与隔离状态，且不存在 Install/Activate 动作。

## 可复核实现与测试

- 外部发现、下载策略、摘要校验和离线物化：
  `packages/dsh-evolve/src/trusted-skill-discovery.ts`
- DSH 原生配置与生命周期组合：`packages/dsh-evolve/src/index.ts`
- Host 安全投影：`packages/dsh-evolve/src/evolution-control-plane.ts`、
  `packages/dsh-evolve/src/control-types.ts`
- DSH Web：`packages/dsh-evolve-web/src/client/EvolutionAction.tsx`

`agent-skills-index-discovery.test.ts` 使用真实 localhost HTTP server，而不是 mock fetch，覆盖：语义命中、
index/artifact/tree 摘要、许可证、持久隔离正文、无二次联网物化、摘要不符、跨域 URL、未知 schema、
archive 拒绝与非 loopback HTTP 配置拒绝。`capability-gap-store.e2e.test.ts` 通过真实 DSH Storage Domain
重启证明 verified artifact 和 provenance 可恢复。既有本地 Git exact/semantic、admission、Shadow 与 cluster
测试继续通过，Git candidate identity 未改变。

真实 in-app Browser 已对实际 `EvolutionAction` fixture 完成验收：Agent Skills source、来源域、三个摘要、
MIT 许可证和隔离状态均可见；摘要行有非零布局矩形，Install/Activate 按钮为 0，fixture 捕获的
warning/error/unhandled rejection 为 0。该 Browser 门只证明真实 React 渲染，不替代 packed DSH Host/Client
Module 安装证据。

提交门结果：`dsh-evolve` 52 个 test file 通过、1 个跳过，248 个 test 通过、2 个跳过；
`dsh-evolve-web` 25 个 test 通过；完整 64 轮 Cache Contract 通过；根级 `pnpm check` 的文档、十一包
typecheck/test/build 全部通过。

## 尚未证明

- Agent Skills Discovery RFC 当前仍是 draft；本实现固定 v0.2，不把它表述为最终标准。
- 本证据冻结时不支持 archive；后续 [V4-5](v4-5-agent-skills-archive-quarantine.zh.md) 已补齐
  `.tar.gz`/`.zip` 的摘要先验与安全整包隔离。ClawHub 私有 API、任意搜索引擎、GitHub 自动克隆或凭
  popularity 自动选包仍不支持。
- 来源被部署者信任且摘要一致，只能证明 provenance/integrity，不能证明指令安全、任务效果或许可证适用性。
- 候选仍须经过确定性 admission、独立 assembled holdout、人工或明确策略晋升；当前实现没有 release authority。
- 找不到候选时的生成/组合、cluster-driven 调度、迁移/负迁移/成本门禁及 Hermes paired outcome 仍未完成。

因此 V4-4 完成的是“可信外部获取”这一段，不等于自主 Skill 发现或自我进化闭环已经完成。

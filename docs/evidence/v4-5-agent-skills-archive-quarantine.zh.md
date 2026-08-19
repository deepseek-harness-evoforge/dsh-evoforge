# V4-5 Agent Skills archive 安全整包隔离证据

> 历史撤销证据：本页记录已删除的 Agent Skills 获取方案，不代表当前产品能力。当前 Candidate 只来自 DSH 内部 Skill Opportunity，见 [V4-9](v4-9-internal-skill-candidate-boundary.zh.md)。

> 日期：2026-08-18
>
> 状态：implemented；真实 loopback HTTP、DSH Storage、无网络物化和 DSH Web 纵切已验证。它证明
> `archive` 供应链输入可安全进入 quarantine，不证明候选有效、可执行、可安装、可激活或已优于 Hermes。

## 用户结果

一个已确认 Capability Gap 命中部署者显式授信的 Agent Skills Discovery draft v0.2 index 后，
`dsh-evolve` 可以接收规范要求的 whole-Skill `.tar.gz` 或 `.zip`：

1. 先下载有界原始制品并验证 index 声明的 SHA-256；摘要不符时不尝试解包；
2. 只允许 archive 根目录的普通文件，并要求根 `SKILL.md`；
3. 拒绝 `..`、绝对路径、Windows drive/backslash、空段、非 NFC/control path、重复路径、
   file/directory 冲突和跨文件系统大小写折叠冲突；
4. 拒绝 symlink、hardlink、special file、加密 zip，以及不一致的声明/实际文件大小；
5. 上限固定为 256 个文件、单文件 8 MiB、解压总量 16 MiB，gzip 容器本身也有输出上限；
6. 校验 index 与 `SKILL.md` 的 name/description identity，并记录 license、permissions、scripts、
   references、可执行位、archive format、artifact/tree/content hash；
7. 把原始、已验摘要的 archive 只存进 DSH Host 私有 Storage。Web 只看到来源域、格式、摘要和整包
   元数据，拿不到 archive 正文；
8. 后续 materialize 只重放持久化制品，不重新访问网络；落盘权限固定为 `0600`，原始 mode 只作为
   admission 证据。含 `scripts/` 或执行位的候选被既有 admission 在物化和 evaluator 前保护；任何候选
   始终 `quarantined + inactive + never executed + unevaluated`。

## 与公开契约的关系

Agent Skills Discovery v0.2 要求 archive 表示 Skill 根目录、根部包含 `SKILL.md`，至少支持 `.tar.gz`
与 `.zip`，并要求原始 archive digest 校验、路径穿越/link/解压炸弹防护和脚本默认不执行。本实现选择
比 draft 更保守的规则：所有 symlink/hardlink 一律拒绝，而不是只判断其最终目标是否越界。

- [Agent Skills Discovery draft v0.2](https://github.com/cloudflare/agent-skills-discovery-rfc/blob/main/README.md)
- [Agent Skills specification](https://agentskills.io/specification)
- [tar-stream 官方仓库](https://github.com/mafintosh/tar-stream)
- [yauzl 官方仓库](https://github.com/thejoshwolfe/yauzl)

## 可复核实现

- `packages/dsh-evolve/src/agent-skill-archive.ts`：无文件系统写入的 `.tar.gz`/`.zip` 深模块，统一路径、
  entry type、解压预算与 tree hash 语义；
- `packages/dsh-evolve/src/trusted-skill-discovery.ts`：digest-first fetch、format 决定、root `SKILL.md`
  identity、private artifact persistence、offline exact materialization；
- `packages/dsh-evolve/src/evolution-control-plane.ts` 与 `packages/dsh-evolve-web/src/client/EvolutionAction.tsx`：
  只投影 `Archive · tar.gz|zip`、整包元数据和隔离状态，不投影 `contentBase64`；
- `packages/dsh-evolve/test/agent-skill-archive.test.ts`：tar.gz/zip 正向解码，以及 traversal、duplicate、
  path/portable collision、link、file-count 负向门；
- `packages/dsh-evolve/test/agent-skills-index-discovery.test.ts`：真实 loopback index/artifact 请求、两种格式、
  generic zip media-type fallback、摘要先于解码、不安全 archive abstain、离线物化；
- `packages/dsh-evolve/test/capability-gap-store.e2e.test.ts`：真实 DSH Storage Domain 重启后 raw archive
  base64 与 format 完整恢复；
- `packages/dsh-evolve-web/test/evolution-action.client.test.tsx`：格式可见、正文不可见且无 install/activate。

## 门禁结果

- `dsh-evolve`：53 个 test file 通过、1 个按平台跳过；255 tests 通过、2 个跳过；
- `dsh-evolve-web`：2 个 test file、25 tests 全通过；
- Cache Contract：通过，包括自主 Gap Tool 64 轮稳定、其余组合 surface parity；
- 真实 in-app Browser：实际 `EvolutionAction` 渲染 `Distribution · Archive · tar.gz`，非零布局
  `504 × 13`；Install/Activate 按钮为 0，raw artifact label 为 0，fixture 捕获的 warning/error/
  unhandled rejection 为 0；
- 根 `pnpm check`：单实例完整通过 11 个用户包的 docs/typecheck/test/build 链。

## 明确未证明

- index 只因部署者显式配置才可信；digest 证明字节身份，不证明作者信誉、license 适用性或任务效果；
- archive 被安全解包不等于内容安全，`SKILL.md` 仍可能包含 prompt injection，脚本仍可能恶意；
- 本片不包含 ClawHub 专有 API、任意市场/Web/GitHub 搜索、官方资料蒸馏、候选生成/组合或
  cluster-driven 慢环调度；
- 没有 release authority，没有修改 active Generation 或当前 Session，也没有创建发布 tag。

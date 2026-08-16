# ADR-0029：生成的 Evaluator 必须先作为私有 Draft，再由人工批准资格验证

- 状态：accepted
- 日期：2026-08-17

## 背景

P1.7 已提供显式 authoring Skill，但新型失败仍要求用户手工创建 Case Pack。让后台模型直接生成并
启用 evaluator 看似能补齐自动进化，实际上会让提出修正的同一证据同时定义“什么算正确”，产生
自评分、过拟合和权限扩大：`final-test/evaluator.mjs` 是可执行代码，一旦被当成可信裁判，就可能让
任意 Candidate 获得虚假 clear win。

用户需要的不是更多“自动修改”，而是把一个明确纠正快速变成可审查测试，同时让原会话继续工作。

## 决策

在 `dsh-evolve` 内增加一个深模块，而不是新增 `dsh-*` 插件或通用 Case 平台：

1. 操作者静态配置少量 `Evaluator Target`，绑定公开 id、exact Skill 与私有 owned root；Web/Command
   只能提交 current Feedback Signal id 与 target id，不能传 host path、Prompt、模型或预算。
2. 一次显式 Author 动作同时授权一次可能付费的模型请求，以及把 P1.4 已限定的用户文本、纠正和
   exact Skill body 发送给已配置 provider。调用先落 durable intent，再提交 native Job并立即返回。
3. 最终 Draft 只能包含固定五个 owned 文件：`manifest.json`、`search/evidence.md`、两份 calibration
   `SKILL.md` 与 `final-test/evaluator.mjs`。其中 host 固定生成 manifest，并把当前 exact Skill 复制为
   known-bad；模型只能提议 evidence、known-correction 与 evaluator。数量、路径、单文件和总字节
   均有硬上限。首片只接受恰好一个 `SKILL.md` 的纯指令 Skill，多文件 tree fail closed。
4. 结果首先是 private、content-addressed `Evaluator Draft`。它绝不在生成后自动执行，不进入现有
   Shadow Target，也不能触发 Candidate、Promotion 或外部动作。
5. Overview 只投影有界 id/status/cost；Detail 才返回有界文件内容和限制。host path、模型地址、
   API key、Session/message id 与完整 Transcript 不跨 Remote。
6. 第二个独立人工动作批准 exact draft hash，并授权在 sealed runner 中执行生成的 evaluator。
   只有 known-bad=`fail`、known-correction=`pass` 且文件 hash 未漂移时，才原子发布 immutable
   `Qualified Case Pack`；失败、矛盾或无法隔离均保持 inactive。
7. Qualified 仍不是 Promotion 证据。用它启动 Feedback-guided Shadow 是之后的另一次显式付费动作；
   Candidate 继续走现有 paired Trial、review/最窄 auto-policy 和 future-session rollback。

相同 Signal、Target、Skill tree 与模型 route 产生相同 launch id。`authoring-pending` 下崩溃属于
Uncertain External Effect，不自动重复付费请求；已落盘 Draft 和本地 qualification 可以幂等恢复。

## KV Cache 契约

Evaluator Target、journal、Draft、qualification 与 UI 全在 host/control plane。该能力不注册 Tool、
Prompt、Skill、System Message 或 Session Event；普通 Agent 完整 request composition 必须与未启用时
逐字段相等。后台 authoring 的独立模型成本只在用户触发时发生，不计入正常 Session token。

## 拒绝的方案

- **生成后直接执行并成为 evaluator**：同源证据自评分，且自动执行未审查代码。
- **只靠 calibration 自动批准**：生成器可把 known fixtures 写死；方向正确不代表语义可信。
- **把 Evaluator Draft 当 Evolution Candidate**：两者权限与判定语义不同，会让 Skill release inbox
  同时承担可执行裁判代码审批。
- **新建 evaluator 插件/服务/队列**：它只服务 `dsh-evolve` 的一个内部阶段；run journal 与 native
  Jobs 已拥有 durable authority 和进程观察。
- **Signal 出现即默认付费 authoring**：当前没有真实成本和误生成率。只有以后明确的部署策略和
  有界预算经过独立证据后，才考虑默认关闭的自动提交。

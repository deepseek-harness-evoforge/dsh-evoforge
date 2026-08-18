# V4-7：DSH 原生 Web 研究证据边界

> 状态：`implemented`。本文件记录独立研究采集深模块的原子提交；后续慢环接线见
> `v4-7-research-grounded-whole-skill-handoff.zh.md`。holdout 执行和 Retention 仍未完成，因此不打 tag，
> 也不声明核心目标完成。

## 本次交付

新增 `skill-research.ts`，只依赖 DSH 官方 `ctx.web` 的结构化 `search` / `fetch` seam，不绑定 Exa、
DeepSeek、Perplexity 或 HTTP fetch provider。它建立以下 Host 所有的约束：

1. Web 查询只包含配置中公开的 kebab-case Skill 名称，拒绝 Goal objective、用户原文和私有路径进入查询。
2. 固定检索 official、open-source、frontier 三条知识轨与一条 holdout 轨；至少取得两个知识轨和一个
   URL 独立的验证源才成功，否则 fail closed。
3. knowledge 与 verification 在返回结构中物理分栏。后续作者只能接收 knowledge；verification
   将保留给独立验证，不参与生成提示。
4. 只接受无凭据的 HTTPS URL，移除 fragment，并按请求 URL 与重定向后的最终 URL 双重去重。
5. 每条查询最多请求三个结果、每轨至多采纳一个成功抓取；正文 excerpt 最多 8 KiB，完整 corpus
   最多 48 KiB，并记录 query hash、请求/最终 URL、HTTP 状态、内容 digest、截断状态及总 corpus digest。
6. 整体操作受 45 秒默认超时及上游 `AbortSignal` 控制；取消会原样传播，不会伪装成“证据不足”。
7. 输出规范化为 LF、确定性排序并深冻结；相同 Web 输入产生相同 lineage digest。

## 官方兼容性依据

本仓锁定的 DeepSeek Harness `47f943859bef60e4160492346772ded9b24f765a` 中，
`packages/web/web/src/types.ts` 的 Web seam 与此结构子集一致：

- `search({ query, maxResults }, signal?)` 返回 `content? / sources / truncated`；
- `fetch({ url }, signal?)` 返回 `url / statusCode / body / truncated`。

因此 EvoForge 仍由 DSH 决定具体 provider、凭据和网络策略，不绕过宿主直接联网。

## 验证

- 红灯：新增测试首先因 `src/skill-research.ts` 不存在而失败；
- 绿灯：独立证据分离、来源不足 fail-closed、HTTPS/48 KiB 边界、私密 Goal 文本拒绝、取消传播均通过；
- 包级 typecheck 通过；完整仓库门禁以本次提交前最终执行结果为准。

## 后续接线

该模块已经在后续原子切片中通过可选 `ctx.web` 注入慢环：同一日预算内先生成私有
`research.json`，只把 knowledge 交给模型，并要求模型返回 Host schema 约束的 whole-Skill
manifest；verification 锚继续只供后续独立评估器使用。

# ADR-0019：反馈只引导候选搜索，不定义评测真相

## 状态

Accepted，2026-08-16。

## 背景

P1.4 可以把一条用户明确选择的纠正保存为私有 Feedback Case Draft，但草稿没有复现步骤、
expected checks 或 evaluator score。让模型同时根据纠正改写 Skill、发明测试并宣布自己通过，会把
“提议者”和“裁判”合并，极易产生迎合样本、自我确认和误晋升。为每类反馈预建通用 Case 编译
平台又会提前引入新的 Schema、Adapter 和生命周期，偏离简约、插件化与真实用户价值。

现有 Shadow 已有经过 known-bad/known-correction 校准的可信 Case Pack、隐藏 final-test、预算、
crash-resume 和 future-session 发布边界。最小有用闭环应复用它，而不是再造 evaluator runtime。

## 决策

`dsh-evolve shadow` 增加一个可选、显式的输入：

```text
--feedback-draft <private-draft.json>
```

使用此参数同时表示两件事：调用者允许本次离线 Shadow 发起可能付费的 proposer 请求，并允许把
草稿中的直接用户文本和 correction 发给所配置的模型提供方。后台观察、草稿创建和 resident
recovery 都不能自行获得这项授权。

Feedback Case Draft 只进入 proposer 的 user message，并明确标为 untrusted search evidence。
输入字段不直接进入 Case Pack、calibration、sealed evaluator、Trial report、proposal evidence 或 run
journal。proposer 的 claim 与 Candidate 必须为 crash-resume 持久化；模型若在输出中回显或转述草稿
内容，该输出仍会进入 Candidate/run evidence，因此调用者必须把整个草稿视为可能被派生输出保留。
最终 Decision 仍只接受原有可信 Case Pack 的校准配对结果：baseline fail、Candidate pass 才能建议
promote；证据不足继续返回 incomplete/review/reject。

运行前必须 fail closed：

- 草稿是权限不宽于 `0600` 的普通文件，使用 `O_NOFOLLOW` 文件句柄检查并读取；
- 严格校验大小、Schema 和内容寻址 id；
- 草稿目标 Skill 名与 active Skill 完全相同；
- 草稿记录的 whole-Skill `contentHash` 与本次 active Skill tree hash 完全相同；
- 草稿 id 和绝对路径进入 durable run identity/resume inputs；恢复时仍需通过同一验证。

草稿最多含 8 KiB 用户文本与 4 KiB correction。二者与 Skill、Case Pack search evidence 共同受
已有 `inputTokenLimit` 约束。正常 DSH Session 的 Tool、system prompt、Skill catalog 和 provider
不变；没有显式 Shadow 就没有额外 token。Candidate 持久化后恢复 sealed Trial 时不会重复 proposer
请求。

## 结果

- 用户纠正可以直接提高候选搜索相关性，不必等待通用 Case 编译框架；
- proposer 无法把自己生成的 evaluator 当成晋升证据，可信 Trial 仍是唯一裁判；
- 既有 Case Pack 可跨多个反馈复用，避免每条反馈都新增 Prompt/Schema，保护 KV Cache 与维护成本；
- 明文反馈不作为独立字段复制到长期运行证据；proposer 回显仍可能随 Candidate/claim 持久化，
  使用说明必须明确这项剩余隐私风险；
- 这只闭合“已有可信 Case Pack 覆盖该失败类型”的路径。全新失败仍需人为或专用插件提供一个可校准
  evaluator；项目不会谎称已经实现任意反馈的自动验证。

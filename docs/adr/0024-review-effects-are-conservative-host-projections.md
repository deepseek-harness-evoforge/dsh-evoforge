# ADR-0024：Review Effect 采用保守的 Host Projection

## 状态

Accepted，2026-08-16。

## 背景

P0C.4 已让人工在批准前看到 exact Git baseline 到 sealed Candidate 的可信 diff，但用户仍需逐行
寻找凭据、网络、部署或权限相关变化。P1.1 已有 protected-effect 词法门，然而它只在配置自动晋升
时运行；同一个 Candidate 在普通人工 review 中看不到这项提示。分别维护 review 和 auto policy
的规则会产生漂移，而引入模型 judge、capability graph 或新审批平台会增加成本、状态与错误权威。

## 决策

增加版本化的 `lexical-protected-effects-v1` host projection，并由 review 与 P1.1 auto policy 复用：

1. 输入只能是 publication 已验证的 exact baseline 和 sealed proposal；不读取当前 worktree；
2. 单一非空 `SKILL.md` append 只扫描 append；其他形态标为 `broader-change`，并提示 artifact scope
   或 rewritten instructions；
3. 固定类别为 artifact scope、credential、destructive action、messaging/calendar、network、payment、
   permission/sandbox、privileged tooling、production change、rewritten instructions；
4. 输出按固定顺序呈现；不保存新副本，不调用模型，不增加 DSH Tool/Prompt/Schema；
5. 规则只做保守 routing。否定句仍命中；无 indicator 不是安全证明。实际工具与外部效果继续由
   DSH Approval、Permission 与 Sandbox 强制。

普通的 token/KV Cache 说明不归类为凭据访问；只有 secret、credential、API key 等明确凭据词进入
该类别，避免 EvoForge 的 cache/cost 文档被系统性误报。

## 结果

- 人工在 exact diff 前即可看到稳定、可解释的关注类别；
- review 与最窄自动晋升不再维护两套 protected-effect 规则；
- 正常 Session 和原会话均不等待 review，也不承担新增 token 或 cache-prefix 变化；
- 该实现不声称解析真实 capability、数据流、参数或权限差异，存在词法误报与漏报；
- 若真实用户试验证明词法提示不足，应先扩展 DSH 可提供的结构化 capability facts；在没有可信
  权威输入前，不用模型推测取代 DSH Approval，也不预建通用 Policy/Control Center 平台。

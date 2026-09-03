# V5.105：运行时自我发现边界纠偏

日期：2026-09-04  
EvoForge：`main`  
范围：路线图、Goal 提示词与自我进化产品契约

## 发现

审计当前公开的 `docs/roadmap.zh.md` 和 `docs/goal-prompt.zh.md` 时发现两处措辞容易造成错误实现：路线图曾写成
“缺失时找到或生成候选”，Goal 提示词曾写成“外部资料作为缺口证据来源”。这会让实现者把外部搜索、市场、
下载或导入误当成“自我发现”，与已经冻结的产品边界冲突。

## 固定边界

- 运行时自我发现只消费 DSH 原生已安装能力、当前 Goal、真实成功/失败、纠正、返工、成本、时延、cache、外部
  结果和跨 Goal 内部证据；缺口候选只能从这些证据形成。
- 外部生态、论文、Hermes/OpenClaw/HanaAgent 和开源代码只用于开发期设计研究、实现对照和冻结 benchmark；运行时
  不搜索、下载、导入、安装或引用外部 Skill/能力。
- 候选仍必须经过隔离生成、Candidate-blind 治理、baseline/holdout/Retention、回归、安全、权限、成本、时延和
  KV-cache 门禁；证据不足时 `abstain`/`quarantine`。

## 修正

- 将路线图退出门改为“仅依据 DSH 内部真实证据生成候选”，并把“未授权获取”改为“未授权能力变更”；
- 将可直接复制的 Goal 提示词改为明确的“开发期外部调研、运行时完全禁止外部能力获取”；
- 未增加市场、网络获取器、第二 Runtime、Router、状态库或新的插件边界。

## 验证

```text
pnpm run check:docs  # passed
git diff --check     # passed
```

本轮是契约纠偏，不宣称自我进化效果、真实 Provider、真实飞书、Hermes paired 或发布门已完成。

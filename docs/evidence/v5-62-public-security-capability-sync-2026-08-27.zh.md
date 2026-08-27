# V5.62：公开能力与安全边界同步

## 问题

公开入口仍有两处历史漂移：英文 README 把已经实现的 existing-Skill paired evaluation、Retention、Canary、
Promotion 和浏览器恢复写成“未完成”；`SECURITY.md` 仍引用已经从活动源码删除的 P0A.1 Feedback Case Draft
和 `--feedback-draft` 参数。开源使用者据此无法判断真实能力和当前攻击面。

## 修正

- 英文 README 改为描述当前分离的 Candidate-blind admission、paired Holdout、独立 Retention、inactive
  release、future-Session promotion、failed-Outcome Canary 与 expected-active rollback，并明确真实双 Provider、
  完整 Hermes paired 和长期效果数据仍阻断发布。
- 中文 README 的飞书入口同步 V5.57/V5.61：陌生私聊进入同一 DSH Web pending 列表，可按 request-id
  直接批准或兼容粘贴 code，不依赖 Session Command。
- 安全策略删除已不存在的 Feedback Draft/CLI 表面，改为当前 DSH 单权威、内部证据、内容寻址 Candidate、
  proposer/evaluator/mutation 分离、future-Session 固定、凭据脱敏、Gateway 授权和发布门边界。

## 验证与边界

`pnpm check:docs` 与 `git diff --check` 通过。此增量只纠正公开合同，不把实现状态升级为 released；
`release-gates.json` 的真实飞书、Provider、Hermes paired 和长期效果阻断保持不变。

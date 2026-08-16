# ADR-0036：明确纠正可按静态策略生成一个不可执行 Evaluator Draft

- 状态：accepted
- 日期：2026-08-17

新失败已有私有 Feedback Case Draft、Evaluator Authoring、人工资格验证和 Qualified Shadow Handoff，但每条明确纠正仍要求操作者先复制 Signal id 并执行 author 动作。这个步骤不增加判断，只延迟闭环；原纠正会话也不应该等待它。另一方面，自动信任或执行模型生成的 evaluator 会把自进化退化为自我评分。

因此允许部署者为一个既有 Evaluator Target 增加默认关闭的 `automaticEvaluatorTargets` 引用。仍然当前的明确负反馈只有在 pinned Generation 恰好匹配一个静态 Skill 时，才可先消费 crash-safe UTC 日预留，再委托既有 `EvaluatorDraftInbox.author()`。结果只进入原有私有、不可执行 Draft inbox；人工批准、sealed qualification、Shadow、Promotion 和 rollback 权限完全不变。相同 Signal 内容寻址且重启复用；歧义、预算耗尽、状态损坏或不确定外部结果转入异步人工路径，原 Session 继续。

该策略明确授权一次 bounded correction/Skill 外发和可能付费的 evaluator author 请求，不授权执行生成代码。一个 Skill 不能同时配置 Automatic Feedback Shadow 与 Automatic Evaluator Draft：已有可信 Case Pack 时应直接走前者，不能对同一纠正触发两次外部调用。拒绝默认后台 author、自动 qualification、模型 judge、通用 Signal 路由器和 Session 内状态注入。

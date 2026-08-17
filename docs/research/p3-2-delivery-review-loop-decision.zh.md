# P3.2 产品决策：先闭合 Draft PR 返修，不建设 Review 平台

> 决策日期：2026-08-17
> 这是现有交付链的产品缺口判断，不声称代表全部 DSH 用户的市场频率。

## 痛点与选择

`dsh-software-delivery` 已能把原生 Goal 变成 verified commit、Draft PR 和可选 exact-head checks，
但 Goal 完成后，reviewer 的修改要求停留在 GitHub；原 Agent 不知道需要返修。用户仍要复制 review、重找
Session、解释 PR/head，再手工要求 Agent 继续。这是软件交付主路径中的确定断点，不是设想一个新平台。

P3.2 因此只提供一个结果：**allowlist 人类对当前 Draft PR exact head 请求修改后，原 Session 继续同一个
Goal。** 它优先于 Calendar、第二消息渠道、CI 日志诊断或通用 ReviewProvider，因为它直接连接仓库已
实现的两端，0 新模型常驻面，且能用 exact PR/head/Session 做窄而可证伪的验收。

## 一手接口事实

- GitHub 的 [Pull request reviews REST API](https://docs.github.com/en/rest/pulls/reviews) 提供 review
  `state`、`body`、`commit_id` 和 reviewer，可按 PR 读取；公开仓库可不认证读取，私有仓库可使用只读
  fine-grained 权限。
- [Review comments REST API](https://docs.github.com/en/rest/pulls/comments) 提供 exact review 下的
  inline comment、path 和 line。
- GitHub [REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)
  推荐条件请求；因此首版使用 API version、ETag、固定低频轮询和有界页，不需要 webhook/App。
- DSH 原生 Session/Agent/Goal 已是权威运行时；EvoForge 的 canonical `complete_delivery` 结果已经包含
  exact artifact、Draft PR 和 Goal completion 事实，因此没有理由新建 Mission 或第二工作流。

## 为什么不做更重的方案

| 方案 | 首版不选原因 |
|---|---|
| GitHub App + webhook | 需要公网 endpoint、签名 secret、安装权限、重放防护和部署运维；单机首片不需要 |
| 通用 ReviewProvider | 目前只有一个 forge 和一个消费者，没有第二个真实 adapter 来证明抽象形状 |
| 新 Mission/PR 工作流 | DSH Goal 和原 Session 已拥有任务语义；第二状态机会产生漂移、恢复和缓存问题 |
| 自动 merge/ready | 属于 Protected Action，且不是“收到修改要求并继续”的必要条件 |
| 把 review 直接送进 Evolve | code review 是当前任务输入，不天然是可泛化的学习证据；应先完成交付，再由真实 outcome/反馈进入现有学习链 |
| CI 日志诊断 | 是另一个用户结果和更大的不可信输入面；当前先验证 review 返修是否减少人工搬运 |

## 成功指标与停止条件

后续真实试用只看少量结果：review 被 Agent 正确接收的比例、从 changes requested 到下一次 verified
push 的时长、重复/陈旧注入数、人工复制 review 次数，以及新增 input/cache-read token。没有数据前不
声称“大部分用户需要”。

若真实使用几乎没有 changes-requested、review 内容经常含糊、或用户更愿意开新 Session，则保持插件
可选并停止扩张；只有第二个 forge/review source 出现并证明重复实现成本，才考虑抽取公共接口。

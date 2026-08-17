# P1.20 自动审阅窗口可见性

## 用户结果

P1.19 已能安全关闭长期无人处理的自动模糊 Candidate，但用户此前看不到窗口何时结束，也容易把它
误解成后台定时删除。P1.20 让 Commands 与 Web 在同一条审阅列表和详情中显示：

- 窗口仍开放时的 exact `eligibleAt`；
- 已达到处置条件时的 exact 起始时间；
- 只有**下一条同 Skill 自动 Signal**才会触发 durable rejection；没有后台 timer。

因此用户能判断“现在需要人工处理，还是可以等待下一次反馈”，而不用读取 journal 或猜测 resident
行为。它只解释已有 P1.19 policy，不新增动作或自动化权限。

## 最小契约

`ReviewInbox` 从已有 Candidate、automatic provenance、Shadow 完成时间与同 Skill
`maxPendingReviewAgeHours` 派生一个只读投影：

```ts
type AutomaticReviewExpiryProjection = {
  eligibleAt: string
  eligible: boolean
  trigger: 'next-same-skill-automatic-signal'
}
```

只有 P1.19 本来就允许处置的 `pending + review + automatic provenance + configured policy` Candidate
获得该字段。人工 Shadow、`promote`、旧版无来源证据和不可证明状态不显示窗口。时间不是浏览器估算；
Commands、Remote 与 Web 都读取 host 的同一派生事实。

Web 仍然只在打开、显式刷新或完成动作后读取。用户在详情页点击刷新时，overview 与当前详情一起重读；
若 Candidate 已被另一条 Signal 处置，陈旧详情被清除并显示权威错误。没有 polling、push 或第二份状态。

## 简洁性、缓存与权限

- 不新增 timer、watcher、queue、database、Command、Tool、Skill、Prompt、模型调用或 durable state；
- 不改变 P1.19 的处置条件、默认 168 小时窗口或 fail-closed 规则；
- 正常 Session 的请求、Tool Schema、Skill catalog 与顺序变化为 `0`，模型 token 增量为 `0`；
- Remote 只多投影一个有界、可选的三字段对象，不传路径、反馈正文或 Candidate 内容；
- 刷新是明确用户读取，不授权 reject、publish、promote、rollback 或任何外部效果；
- UI 消失或插件卸载不影响权威审阅事实。

## 非目标

- 不做通知中心、倒计时任务、实时推送或通用 TTL 平台；
- 不替用户判断模糊 Candidate 是否值得保留；
- 不把 `eligible` 描述成已经拒绝；真正处置仍只发生在下一条同 Skill 自动 Signal；
- 不宣称可见性已经改善真实 review rate；该结果仍需陌生用户和生产数据验证。

# P1.19 自动模糊审查过期处置实现证据

> 日期：2026-08-17；分支：`feat/p1-review-expiry`

## 结果

`dsh-evolve` 现在能在新自动反馈的预算预留之前，原子拒绝超过配置窗口的旧自动模糊 Candidate。旧
Candidate 的完整证据继续可读，新 Signal 才能进入既有 Shadow；人工、明确可晋升和未激活版本不被
自动处置。

## Red → Green

- Red：旧实现对 7 天前的 automatic `review` 返回 `busy`，同 Skill 永久无法继续；新增测试失败。
- Green：Review Inbox 读取 exact Signal/launch provenance 与完成时间，写入
  `auto-review-expiry-v1` terminal disposition 后重扫为 `clear`。
- 反例：recent automatic review、old automatic promote、old human review 全部保持 `busy`。
- 恢复：处置使用既有 durable atomic JSON write；新 Inbox/进程从同一事实恢复，不依赖内存 timer。

## 已执行验证

- `pnpm --dir packages/dsh-evolve typecheck`：通过。
- `vitest` 聚焦 Review/Launcher/Automatic Feedback：3 files / 26 tests 通过。
- 真实 DSH assembled 纵向测试：1 passed / 18 skipped；预置旧 automatic review，新反馈先产生
  durable automatic rejection，随后才进行一次 proposer 请求并完成既有 future-Session 路径。
- `dsh-evolve` 全套：40 files passed / 1 skipped；195 tests passed / 2 skipped。
- PA-1 聚合：150 passed / 1 skipped（Evolve 89、Delivery 29/1、Web 10、Telegram 22）。
- 完整 workspace：282 passed / 3 skipped（Doctor 5、Evolve 195/2、Delivery 34/1、Web 11、
  Telegram 37）。
- `pnpm check`：文档链接、五包类型检查、完整 workspace、五包 build 全部通过；Typert freshness
  gate 通过，Remote 方法集合未变化，只有 review actor 枚举增加一个值。
- packed `dsh-evolve`：1 passed；真实 profile `plugin add → boot → plugin remove → native boot`，
  安装前后 system composition 相等。
- 前端源码与交互未变化，因此不要求新的浏览器 E2E；本功能的真实用户路径是 host resident preflight。

- Draft PR #21 首轮远端 CI：Node 22.19.0（59 秒）、Node 24（1 分 4 秒）、macOS DSH
  Assembled Trial（2 分 51 秒）全部通过；run `31984599483` conclusion 为 `success`。

## Cache、权限与限制

- 新模型可见表面与正常 Session token：`0`；过期检查模型调用：`0`。
- 自动处置发生在日预算和 provider 边界之前；不 publish、activate、merge、release 或执行 Candidate。
- 默认窗口 168 小时只适用于显式配置 Automatic Feedback Target 的模糊 Candidate。
- 这是单 resident 的按需清理语义，不是通知系统、通用 TTL service 或跨进程锁。

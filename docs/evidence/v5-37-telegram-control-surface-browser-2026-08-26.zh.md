# V5.37：Telegram 原生控制面浏览器验证

日期：2026-08-26

## 目的

验证实际打包的 `dsh-gateway`/`dsh-telegram` 在 DSH Web 中进入公共 Control Center，而不是恢复页面外固定
面板；同时验证 Telegram Surface 的原生 Command 读取、刷新和整页 reload。该证据使用 loopback Bot API
隔离外部 Telegram 网络效果，不把它当成真实 Bot 通过。

## 真实 DSH 路径

- DSH revision：`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`（`dsh-v0.1.1-rc.2`）。
- 使用实际打包并由官方 DSH CLI 安装的 `core` 与 `channels` tarball。
- overlay 仅在测试 profile 中启用 `dsh-gateway` 和 `dsh-telegram`，绑定一个真实 DSH Workspace/Session、固定
  Telegram 私聊 route 和 `telegram-long-poll` Adapter。
- loopback Bot API 返回合法的 `getUpdates` 空结果和 `sendMessage`/callback 成功结果；没有伪造 DSH Gateway、
  Session、Command 或 Client slot。

## 浏览器结果

1. 原生 DSH `控制台` 显示统一导航：运行诊断、渠道、Telegram、Evolution；没有独立页面或悬浮面板。
2. Telegram Surface 显示 `连接正常`、固定私聊路由、长轮询 transport、Gateway 持久投递计数和“0 模型”说明。
3. 点击 `刷新状态` 后重新执行原生 `/telegram`，状态仍为 ready，读取时间更新。
4. 整页 reload 后默认回到 Doctor；再次点击 Telegram，Surface 仍显示 ready，route/transport 信息没有漂移。
5. 浏览器应用层 error 日志为 `0`。

## 自动化与复现

`dsh-telegram` Client manifest/export、Surface slot、`/telegram` Command 和报告解析由包级测试覆盖；本次
浏览器 overlay 由 `scripts/create-telegram-browser-overlay.mjs` 生成。测试夹具和 overlay 不进入发布 tarball。

## 边界

该证据证明“真实 DSH Bundle + 原生 Client Surface + loopback transport”可用，不证明真实 Telegram Bot 的
网络、账号、移动端时延、长期轮询、外部副作用或 Hermes paired benchmark。因此 `web-control-plane` 仍需真实
外部 Bot route 和陌生用户可用性数据，release tag 仍被其他真实飞书、Provider、Hermes 和长期效果门阻断。

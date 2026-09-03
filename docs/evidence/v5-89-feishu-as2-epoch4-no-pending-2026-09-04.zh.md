# V5.89：飞书 AS-2 epoch-4 最新隔离运行严格失败（2026-09-04）

## 运行范围

本轮从当前 `main` 的干净工作树启动全新隔离目录，使用真实飞书 App、最终打包的
`dsh-control-center`、`dsh-gateway` 和 `dsh-feishu`，并固定 DSH alpha.5 支持基线。运行目标是验证
常驻 Gateway 配对、原生 DSH 入站/回复、`/feishu`、官方 Schedule、一次性 Approval、持久通知、Host
重启、卸载和原生 Session readback 的完整 direct-message epoch。

## 结果

运行报告：`as2-feishu-resident-pairing-epoch-4`，状态 `failed`。

通过的前置观察：

- 三个最终 Bundle 在 clean profile 中完成安装；
- profile dump 包含控制面、Gateway、Feishu 和官方 Schedule 配置；
- 官方 Feishu WebSocket 达到 `ready`，没有启动第二个 Gateway 或临时 listener。

失败点：

- 15 分钟人工窗口内，Gateway 没有观察到与当前 App 身份匹配的陌生私聊；
- 因此没有产生 pending pairing request，运行停在 `awaiting-resident-pairing-request`；
- 没有批准 principal、没有进入 DSH Agent、没有发送回复、Approval、Schedule 或其他外部副作用。

固定身份（不含凭据）：

- EvoForge revision：`fe73a853130e4a0f720a670d438dce1cc4c9ed50`；
- DSH revision：`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`（alpha.5）；
- manifest hash：`6fa03b9bda7493c9233b8eaef870b8dab2c6e97438f19cd4488b3e782eaf6686`；
- app identity hash：`de91a76492ba38ca329d998c0245c7bbdd8b84ff9cc404fda8eb7f1138b349da`。

## 判定与后续

这次结果证明“Bundle 安装和官方 WebSocket ready”，不能证明“真实飞书配对和消息闭环”。
`real-feishu-as2` 继续保持 `failed`，不复用本次非终态目录，也不创建 release tag。下一次必须使用新的
隔离 run root，并在 Gateway 已进入 ready 后由真实用户向机器人发送一条新的私聊；收到 pending 后才可
继续 Host 批准和完整 epoch。与此同时，代码、文档、单页控制面和其他不依赖外部消息的工作继续推进。

## 可复核命令

```sh
node scripts/check-release-gates.mjs --json
```

结果仍明确列出 `real-feishu-as2: failed`，没有把本次失败改写为通过。

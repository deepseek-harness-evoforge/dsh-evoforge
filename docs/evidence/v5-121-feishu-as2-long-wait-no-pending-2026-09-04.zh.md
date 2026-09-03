# V5.121：真实飞书 AS-2 长等待仍无配对请求

## 结果

在 V5.114 overlay 修复、V5.116 全量回归后的干净 revision `a807970d125ee50541e5c8c533425560a6ff0252` 上，
使用全新隔离 run root 启动真实 Feishu AS-2，并将人工等待窗口设为规范允许的 900 秒。DSH 最终 Bundle 安装、
profile dump 和官方 WebSocket/HTTP transport 均保持 ready；窗口内没有陌生飞书私聊事件，Gateway 未暴露 pending
request，runner 在 `awaiting-resident-pairing-request` 阶段 fail closed。

没有配对、Session/Agent 入站、回复、Command、Schedule、Approval、notice、重启、卸载或读回，也没有重复或其他
外部副作用。该 run root 不能复用；这不是 Feishu 通过证据。

## 固定环境与观察

- assembled DSH 支持基线：alpha.5 `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`；
- canonical DSH 最新 `origin/master`：`76fda729799fe9b3848dbe2c211d4b231032b81e`，工作树 clean；
- `finalTarballsInstalled=true`、`profileDumped=true`、`officialTransportReady=true`；其余 AS-2 观察项均为 `false`；
- 公开结果只保留 App identity hash，不包含 App Secret、用户身份、chat id、配对码或临时 Web token。

## 判断

V5.115 的短窗口和本轮长窗口都在 transport ready 后观察不到入站，因此当前证据只能说明“等待外部测试账号私聊”
仍未完成，不能把问题归因给 Loader、凭据或 resident Gateway 启动。下一次真实运行仍须使用新的 run root，并让测试
账号在 runner 提示后实际发送陌生私聊；不得用静态 route、旧结果或本地 fixture 替代。

真实 Provider、Hermes paired、长期效果、Telegram 和 npm 命名空间门保持未通过。

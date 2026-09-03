# V5.115：真实飞书 AS-2 官方传输启动与无配对请求

## 结果

在 V5.114 的 Loader 行修复提交后，使用新的隔离 run root 启动 epoch-4 真实飞书 AS-2。最终 Bundle 安装与
profile dump 均通过，DSH 官方 WebSocket/HTTP 传输达到 `officialTransportReady=true`。runner 等待 resident
Gateway 暴露当前 App 的唯一陌生私聊 pending request 120 秒，但飞书端没有发来私聊，因此在
`awaiting-resident-pairing-request` 阶段按契约失败关闭。

该 run 没有配对、没有进入 DSH Agent、没有发送回复/Command/Schedule/Approval/notice，也没有重启、卸载或
Session 读回动作。不得把它算作真实 Feishu 通过；失败 run root 不复用、不删除、不篡改。

## 复核事实

- EvoForge revision：`6f8b35607b511dd2102cdbebccd15fe9041dc58b`；
- DSH assembled 支持基线：alpha.5 `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`；
- canonical DSH 最新 `origin/master`：`76fda729799fe9b3848dbe2c211d4b231032b81e`，工作树 clean；
- observations：`finalTarballsInstalled=true`、`profileDumped=true`、`officialTransportReady=true`，其余真实效果门
  均为 `false`；
- 终态 reason：`resident Gateway did not expose the exact pending Feishu request`；
- 过程未输出凭据、平台身份或配对码到公开结果。

## 解释与后续边界

这次结果证明上次本地 Loader 阻断已越过，并不能证明飞书入站链路。下一次真实验证必须使用新的隔离 run root，
且需要测试账号在 runner 提示后向机器人发送一条陌生私聊；不能通过静态 route、旧 terminal report 或模型自评
替代。真实 AS-2、真实 Provider、Hermes paired、长期效果、Telegram 和 npm 命名空间门仍保持未通过。

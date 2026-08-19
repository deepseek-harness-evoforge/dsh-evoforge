# V5.1 Gateway Transport Health 证据

## 结果

`dsh-gateway` 现可聚合 Telegram 与飞书 Adapter 的脱敏 transport observation，并按 exact route 子集投影。平台连接和协议仍归 Adapter，Gateway 没有新增 Session、Agent、Goal、Approval、网络进程、平台 SDK 或模型表面。

## 已验证路径

- Gateway 单测覆盖两个 Adapter 注册、route/account 所有权、重复/错误注册、route 子集过滤、状态计数、时间边界、dispose 与 account 脱敏；
- 飞书真实 assembled DSH Host 覆盖 WebSocket transport error → Gateway `degraded` → 后续平台 message → `ready`，`/feishu` 继续输出 0-model 的版本化健康快照；
- Telegram 真实 assembled DSH Host 覆盖 long-poll invalid response → Gateway `degraded` → 下一轮成功 poll → `ready`；
- `dsh-feishu` 健康聚合器拒绝不是 `feishu/official-feishu-websocket` 或不属于 exact route 集合的 transport facts；
- Gateway 快照不含 account/chat/user、消息正文、external message id、错误正文或凭据。

仓库级 `pnpm check` 全绿：11 包 typecheck/build，`dsh-gateway` 4 files/18 tests、`dsh-telegram`
7 files/26 tests、`dsh-feishu` 13 files/31 tests；`dsh-evolve` 保持 58 files passed/1 skipped、
283 tests passed/2 skipped。Cache Contract、Doctor 原生合同 22/22 与十一包 clean-profile
tarball add/dump/boot/真实 Session+Goal+Tool/dispose/remove/reboot/readback 1/1（28.67 秒）随后独立复验通过。

## 未覆盖

统一 Gateway DSH Web、真实 Telegram Bot、真实飞书用户消息、移动端、多日断线重连和 Hermes 同条件消息 paired benchmark 仍未完成。本证据只支持“transport 聚合 implemented”，不支持发布或上位替代声明。

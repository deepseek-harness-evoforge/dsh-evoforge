# V5.149：真实飞书 AS-2 有效凭据连接成功但无新人 pending

日期：2026-09-04  
EvoForge revision：`53c320f39abf3cb74167216d5d586a758abc3f4e`  
Canonical DSH：`76fda729799fe9b3848dbe2c211d4b231032b81e`，`0.1.2-rc.1`，`HEAD == origin/master`，clean。  
可运行 assembled 支持基线：`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`，`0.1.2-alpha.5`，clean。  
Run root：`/private/tmp/evoforge-feishu-as2-20260904-r2`（仓库外、独立、物理路径）。

## 执行

使用用户已提供的精确 Feishu App 凭据和明确的真实渠道授权短语，设置人工等待窗口为 60 秒：

```sh
DSH_FEISHU_REAL_CHANNEL_APPROVED=I_APPROVE_REAL_FEISHU_CHANNEL_EFFECTS \
DSH_FEISHU_DSH_SOURCE_DIR=/private/tmp/evoforge-dsh-latest.qPqo1d \
DSH_FEISHU_REAL_CHANNEL_RUN_ROOT=/private/tmp/evoforge-feishu-as2-20260904-r2 \
DSH_FEISHU_REAL_CHANNEL_TIMEOUT_MS=60000 \
pnpm benchmark:feishu:as2
```

App ID 和 Secret 只通过进程环境传入，未写入仓库、stdout 或终态报告。执行器成功完成最终 tarball 安装、clean
profile dump 和官方 Feishu WebSocket handshake；DSH Gateway lifecycle 为 `ready`，官方 transport 为 `ready`。

## 结果

执行器随后提示向机器人发送陌生私聊，并在完整 60 秒窗口轮询 Host pending projection。没有观察到当前 App 的任何
陌生 direct-message pending，故在 `awaiting-resident-pairing-request` 阶段退出，报告中仅有：

- `finalTarballsInstalled: true`
- `profileDumped: true`
- `officialTransportReady: true`
- `residentPairingGranted` 及之后全部为 `false`
- 退出码 `1`，原因 `resident Gateway did not expose the exact pending Feishu request`

没有进入 Agent、没有创建 Gateway grant、没有发送 DSH 回复、Approval 卡片、Schedule 或 Host notice，也没有执行
重启、卸载或 Session readback；这是一条真实的 fail-closed 失败记录，不能复用为通过。

## 结论与后续诊断边界

本轮排除了 App Secret 无效、DSH Loader、最终 Bundle、profile overlay 和 WebSocket handshake 这几类原因，但没有
证明飞书事件已抵达 Adapter。下一次真实重试必须使用新的物理 run root，并在 runner 输出“Gateway ready”后由测试账号
主动向该 App 发送一条新的陌生私聊；若仍无 pending，应继续检查飞书后台机器人启用、事件订阅
`im.message.receive_v1`、长连接模式、测试账号与 App 的关系及平台策略拒绝投影。`real-feishu-as2` 仍为 `failed`，
首个 release tag 继续阻断。

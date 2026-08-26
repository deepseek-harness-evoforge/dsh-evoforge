# V5.33 真实飞书 AS-2 配对等待失败记录

日期：2026-08-26

## 结果

本次运行使用阶段专用 AS-2 runner、当前 DSH `0.1.1-rc.2` revision，并从最终 tarball 安装到隔离 profile。Runner 在常驻 Gateway 已就绪后等待真实私聊产生的配对码；在规定超时内没有收到输入，因此安全退出为 `failed`，不是 `passed`，也不是可以忽略的 `not-run`。

| 阶段 | 结果 |
|---|---|
| 最终 tarball 安装 | `true` |
| profile dump | `true` |
| 官方飞书 transport ready | `true` |
| resident pairing grant | `false` |
| exact 入站 challenge | `false` |
| 原生回复 / Command / Schedule / Approval / notice | 未执行 |
| Host 重启后消息 / 卸载 / Session readback | 未执行 |
| 终态 | `failed` |

安全原因：`resident Gateway pairing code was not entered before timeout`。报告只保存 revision、manifest hash 和脱敏观测，不保存 App Secret、消息正文或凭据。

## 影响

该结果证明安装、配置和官方 WebSocket readiness 已到达等待人工配对的阶段，但不证明真实飞书消息、回复、Approval、Schedule、重启恢复或卸载闭环。AS-2 仍阻止真实渠道发布声明和首个 release tag；下次运行必须重新建立独立 run，不得重放本次外部效果。

## 复核来源

- 隔离 run 的 `result.json`：`status=failed`、`stage=awaiting-resident-pairing-code`；
- EvoForge revision：`70b6d4b2b315215e4a54ccde44704149e297f63f`；
- DSH revision：`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`；
- 本记录不把失败转换成通过，也不改变 V5.22 已有的 direct 主路径历史证据。

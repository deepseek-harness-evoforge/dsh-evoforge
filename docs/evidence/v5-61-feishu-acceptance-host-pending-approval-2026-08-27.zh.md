# V5.61：真实飞书验收改用 Host pending request 审批

## 偏差

产品路径在 V5.57 已提供常驻 Gateway pending request 和 DSH Web 直接批准，但 AS-2 真实验收仍停在终端
`Pairing code:` 输入，要求操作者从机器人复制十位 code。该脚本既没有验证新 Host 控制链，也给真实复验
增加了一次不必要、容易超时的人工转录。

## 修正

- AS-2 等待陌生私聊进入 Gateway 后，只读取 `pendingPairings()` 的脱敏投影。
- 只允许一个 `adapter=feishu` 且 `accountIdHash` 等于当前授权 App hash 的 request；多个匹配项视为歧义并
  fail closed。
- 通过生产 `approvePairingRequestForSession({ requestId, workspaceId, sessionId })` 审批，继续复用 live
  Workspace/Session/cwd/Agent/provider/model 与 route collision 门。
- 审批后立即验证 request 已被原子消费；首条陌生私聊仍不得进入原生 Session。
- 删除 stdin/readline 配对码读取。机器人继续返回 code，作为面向用户的兼容路径，但验收器不再接触它。

## 验证

- `pnpm benchmark:feishu:as2:typecheck` 通过。
- AS-2 合同测试 10/10 通过；新增源合同要求 pending request + request-id 审批存在，并拒绝恢复
  `approvePairingForSession`、`process.stdin`、readline 或 `Pairing code:` 路径。
- 未授权执行仍只输出 `status: not-run`，不读取 App 凭据或产生平台效果。

## 边界

本增量修正真实验收的审批路径，不把合同测试算作真实 Feishu 通过。完整 AS-2 仍需新的隔离 run，完成真实
私聊、原生回复、`/feishu`、Schedule、Approval、notice、Host 重启、无需重配、卸载和 Session readback。

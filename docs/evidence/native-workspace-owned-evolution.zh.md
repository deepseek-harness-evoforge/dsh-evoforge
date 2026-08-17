# 原生 Workspace-owned evolution 证据

> 状态：implemented；对应 `packages/dsh-evolve/test/native-workspace-evolution.e2e.test.ts`

该纵切从真实 DSH Host 启动，不注入固定 Workspace id：fixture 先调用原生
`WorkspaceRegistry.create()` 注册两个真实目录，再组合 `dsh-evolve`。两个 Agent 的 Session cwd
分别解析到两个原生 Workspace UUID。

验证结果：

- A Workspace 晋升一个 Git-backed Generation 后，A 的已启动 Session 保持 native pin；
- A 的未来 Session 固定该 Generation，B 的已启动和未来 Session 都保持 native；
- 用 B 的 Workspace id 晋升 A 的 Generation 会 fail closed；
- `/evolve status` 在 A 显示 A 的 active Generation，在 B 显示 `native DSH`；
- Host 重启后两个原生 Workspace UUID 不变，A 的 active pointer 恢复，B 仍无 active Generation；
- 测试使用真实 DSH Agent、Session、Commands、Workspace Registry、Session Persistence 和
  Storage Domain，不创建第二 Runtime 或产品 daemon。

自动晋升授权另由 `auto-promotion-policy.test.ts` 证明：allowlist 键是 exact
`Workspace UUID + Skill`，授权 A 不会授权 B。

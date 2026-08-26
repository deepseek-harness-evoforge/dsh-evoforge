# V5.56：Resident Web Host 的单页保活参数

日期：2026-08-27

## 背景

Hermes 式常驻要求 Gateway 连接与 DSH Host 一起由用户级服务保活。此前 `dsh-resident` 生成的 unit 只能传
`--profile`，目标为 Web profile 时会触发默认浏览器交接，造成额外页面；手工把参数拼入 shell 又会破坏
exact ProgramArguments 和审计边界。

## 实现

- `dsh-resident` Config 增加可选 `noOpen`（默认 `false`），不接受任意 shell 文本或路径。
- `createPlan()` 将 `noOpen: true` 精确转换为目标命令末尾的 `--no-open`；launchd 的 `ProgramArguments` 与
  systemd 的 `ExecStart` 都直接从同一个 immutable command 生成，仍不经过 shell 或 `PATH`。
- 该参数只控制 DSH Web 应用的浏览器 handoff，不改变 profile、Session、Gateway route、凭据或权限。
- unit 仍只携带 `DSH_HOME`；飞书凭据继续由 DSH 标准启动环境层提供，不写入 unit。

## 验证

```text
pnpm --filter dsh-resident typecheck                         # passed
pnpm --filter dsh-resident exec vitest run test/plan.test.ts # 3 passed
pnpm --filter dsh-resident exec vitest run test/launchd.e2e.test.ts # 1 passed
pnpm --filter dsh-resident exec vitest run test --maxWorkers 1    # 15 passed, 1 skipped
```

launchd 真实生命周期 fixture 使用 `--no-open` 应用参数启动，读取到的 resident argv 精确为：

```text
--profile <fixture> --no-open
```

fixture 随后经历 SIGKILL 自动重启、status、remove 和无残留检查；unit 文件权限仍为 `0600`。

## 边界

这条证据证明单一 DSH Web/Gateway Host 具备不打开第二页面的 OS service 参数契约，不等于当前用户 Web
profile 已部署 launchd，也不等于真实 Feishu 新消息、Provider/Hermes paired 或长期效果门已通过。部署仍需
操作员查看 `/resident plan` 后以 exact hash 执行 `/resident apply`。

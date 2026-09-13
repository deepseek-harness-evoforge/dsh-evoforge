# rc.2 冷恢复与进程中断夹具适配

- 日期：2026-09-14；EvoForge 起点 `e85597e`。
- 本轮 fetch 后 canonical HEAD / origin/master 仍为 clean `c291e7961a515f6d7af9304e7fd1d257929aef26`。
  复用此前 install/build exit 0 产物；未重新安装上游或切换正式 Host。
- 只修改两份测试夹具：通过两版共有的 `systemPrompt.section()` 注册原有提示文字，移除新版不再支持的
  `persona` 配置。没有修改 Continuity 插件、自动续跑授权、原生轮次上限或模型请求比较断言。

## 类型与执行

隔离 current 类型映射下，修改前两个 `persona` 字段产生 TS2353；修改后
`tsc --noEmit -p packages/dsh-goal-continuity/tsconfig.json` exit 0。原工作树的包 typecheck 同样通过。

```text
# alpha.5 开发依赖与原生 persistence
DSH_EVOLVE_DSH_SOURCE_DIR=<alpha5-checkout> pnpm --filter dsh-goal-continuity exec vitest run test/cold-resume.e2e.test.ts test/process-crash.e2e.test.ts --maxWorkers 1 --reporter=dot

# 隔离副本，current runtime aliases
DSH_EVOLVE_DSH_SOURCE_DIR=<c291-checkout> vitest run test/cold-resume.e2e.test.ts --config ../../vitest.rc2.config.mjs --maxWorkers 1 --reporter=dot
```

旧版 2/2；current cold-resume 1/1。后者执行真实原生 Agent/Goal/Session 与临时 JSONL 持久化，
比较手动/授权自动恢复的模型请求，保留未授权不续跑检查。模型为 keyless fixture，无真实费用或质量声明。

## current SIGKILL 必须验证子进程依赖

Vitest aliases 不会自动进入测试创建的独立 Node 子进程。因此仅在隔离副本将 crash-resume 夹具的 10 个
native runtime import 改为对应 c291 构建入口的绝对路径，依赖自己的内部 import 继续由该 checkout 解析。
仓库文件未保留这些机器路径。首次运行被扫描用 tsconfig 的 `.d.ts` alias 干扰，在 seed READY 之前退出；
这是审计配置冲突，不是产品崩溃恢复失败。

随后通过 `TSX_TSCONFIG_PATH=<原工作树>/tsconfig.base.json` 让子进程不使用类型扫描 alias，执行：

```text
TSX_TSCONFIG_PATH=<original-tsconfig> DSH_EVOLVE_DSH_SOURCE_DIR=<c291-checkout> vitest run test/process-crash.e2e.test.ts --config ../../vitest.rc2.config.mjs --maxWorkers 1 --reporter=dot
```

1/1 通过：seed 到 READY 后实际 SIGKILL 该测试进程；新进程恢复同一临时 Session，只请求模型一次，
原生 Goal 为 blocked / disarmed / roundsStarted=1 / maxGoalRounds=1。只终止专用测试子进程，未触碰正式 Host。
完成后恢复隔离夹具的正常 import，再跑 current 类型检查通过。

## 限制

本次关闭 Continuity 的两个首轮类型阻断，不是完整 rc.2 套件、真实 provider 或飞书恢复验收。
没有改变生产提示词、权限、凭据、用户历史、peer/dev/lockfile 或支持矩阵。其余包和完整升级门禁仍待完成。

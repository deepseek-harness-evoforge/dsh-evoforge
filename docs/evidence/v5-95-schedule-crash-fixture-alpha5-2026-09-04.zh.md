# V5.95：Schedule 崩溃恢复夹具对齐 alpha.5

## 发现

`native-schedule-restart.e2e.test.ts` 的 dispatch-durability 场景在 alpha.5 下曾经在 `READY` 前超时。审计夹具
发现两处契约漂移：当前 DSH JSONL 持久化服务暴露的是 `persistBatch`，夹具虽然读取了该函数，却无条件把
包装器赋值给未使用的 `appendBatch` 属性；同时 `after_seconds: 1` 在 Host 启动和初始 flush 期间就可能到期，
使故障注入还未安装时 dispatch 已完成。

## 修复

- 根据实际服务对象选择并替换 `persistBatch`（兼容保留 `appendBatch` 形状），不修改 DSH 上游实现。
- 将一次性 Schedule 延迟设为五秒，先安装阻断再等待到期。
- 保留真实跨进程流程：平台 effect 先落盘、dispatch 持久化被阻断、seed 进程 SIGKILL、recovery Host 只恢复
  一次外部 effect，并验证 create/dispatch/message 日志各一条。
- 移除临时 stderr 诊断，不改变生产包。

## 验证

开发和测试前重新 fetch DSH，确认官方最新远端 `origin/master` 为
`76fda729799fe9b3848dbe2c211d4b231032b81e`，工作树 clean；运行时支持基线仍为可构建 alpha.5
`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。

```sh
DSH_DIR=<path-to-deepseek-harness>
git -C "$DSH_DIR" fetch origin --tags --prune
test "$(git -C "$DSH_DIR" rev-parse HEAD)" = "$(git -C "$DSH_DIR" rev-parse origin/master)"
test -z "$(git -C "$DSH_DIR" status --short)"
pnpm --filter dsh-feishu typecheck
pnpm --filter dsh-feishu exec vitest run test/native-schedule-restart.e2e.test.ts -t 'does not repeat' --maxWorkers 1
pnpm --filter dsh-feishu exec vitest run --maxWorkers 1
pnpm --filter dsh-feishu build
git diff --check
```

结果：定向崩溃恢复测试通过；完整 `dsh-feishu` 套件 18/18 文件、46/46 测试通过；类型检查和产物构建通过。

## 发布边界

这是测试契约与故障注入有效性修复，不是生产发布门通过证据。真实 Feishu AS-2、两个独立 Provider、Hermes
paired、长期效果、真实浏览器恢复和首个 release tag 仍按根目录 `release-gates.json` 保持原状态。

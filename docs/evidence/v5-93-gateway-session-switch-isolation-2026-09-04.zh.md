# V5.93：Gateway 会话切换清空旧快照

## 发现

Gateway Surface 的初始刷新 effect 只依赖 `remote`。DSH 切换 Session 或 Workspace 时，如果 React 复用同一
Surface，旧 Session 的 transport、route、pending pairing 和操作回执会在新 Host 状态返回前继续留在页面；
这既误导用户，也可能让配对操作看起来属于错误的 Session。

## 修复

- effect 现在以 `remote`、`sessionId` 和解析出的 `workspaceId` 为边界；边界变化会使旧请求序号失效。
- 新 Session 读取开始前清空旧 snapshot、pending pairing、配对/撤销回执、输入值和错误状态；新 Host 返回前
  只展示加载态。
- 轮询计时器随 Session 边界重建，旧轮询不能写入新 Session；没有新增页面、Router、Session、状态库或
  第二个 Gateway。
- 新增 rerender 回归：旧快照在切换后立即消失，延迟的新快照返回后才出现。

## 验证

开发和测试前重新 fetch DSH，确认官方最新 `origin/master` 为
`76fda729799fe9b3848dbe2c211d4b231032b81e`，工作树 clean；运行时支持基线仍为可构建 alpha.5
`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。

```sh
DSH_DIR=<path-to-deepseek-harness>
git -C "$DSH_DIR" fetch origin --tags --prune
test "$(git -C "$DSH_DIR" rev-parse HEAD)" = "$(git -C "$DSH_DIR" rev-parse origin/master)"
test -z "$(git -C "$DSH_DIR" status --short)"
pnpm --filter dsh-gateway typecheck
pnpm --filter dsh-gateway exec vitest run test/gateway-action.client.test.tsx --maxWorkers 1
pnpm --filter dsh-gateway build
git diff --check
```

结果：类型检查通过；Gateway Client Surface 定向测试 8/8 通过；产物构建、Typert 和 Node artifact 校验通过。

## 发布边界

这是 Session/Workspace 隔离和旧状态泄漏修复，不是外部渠道、Provider、Hermes paired、长期效果或 release tag
通过证据；这些门仍按根目录 `release-gates.json` 保持原状态。

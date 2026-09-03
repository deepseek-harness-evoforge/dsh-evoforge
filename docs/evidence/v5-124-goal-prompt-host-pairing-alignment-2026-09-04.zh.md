# V5.124：Goal 提示词与 Host 配对权威对齐

## 发现

可复制的 `docs/goal-prompt.zh.md` 曾把“宿主 CLI 或 DSH Web”并列写成当前配对入口，但本仓库实际只提供
Gateway Host Remote 与原生 DSH Web pending 列表；没有独立宿主 CLI。这会让新 Goal 误以为可以执行不存在的命令，
也会模糊“配对不在 Session Command 中完成”的架构边界。

## 修正

- Goal 提示词现在把 DSH Web pending 列表写成当前管理员入口；
- 保留未来宿主管理命令的扩展位，但要求它复用同一 Host authority，不得把配对退回 Session Command；
- 没有新增 CLI、Session、Approval、Gateway 或第二套状态存储，也没有改变运行时行为。

## 验证

在 canonical DSH 最新 `origin/master` fetch/clean preflight 后执行：

```text
pnpm run check:docs
pnpm run check:release:gates:test
git diff --check
```

三项均通过；当前 `release-gates.json` 的真实渠道、Provider、Hermes paired 和长期效果阻断保持不变。

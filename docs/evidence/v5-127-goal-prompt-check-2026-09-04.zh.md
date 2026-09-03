# V5.127：Goal 提示词预算与边界自动检查

## 变更

`docs/goal-prompt.zh.md` 是可直接粘贴到 `codex goal` 的用户入口。本轮把三个容易回归的约束加入
`scripts/check-docs.mjs`：必须有最终 `text` 提示词块、文件总长度不超过 2000 字符、要求自主规划并继续；同时
禁止重新写入当前实现不支持的“宿主 CLI”入口承诺。

## 验证

在 canonical DSH 最新 `origin/master` fetch/clean preflight 后执行：

```text
pnpm run check:docs
git diff --check
```

均通过；当前提示词文件长度为 2000 字符。此守护不改变 DSH、Gateway、Session、Approval 或任何运行时行为。

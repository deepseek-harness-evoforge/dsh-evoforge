# V5.137：DSH preflight 拒绝未跟踪工作树文件

## 问题

`scripts/run-dsh-compatibility-matrix.mjs` 的 `inspectDshTarget()` 原先调用
`git status --porcelain --untracked-files=no`，只会发现 tracked 修改。一个含有 `??` 调试文件或临时生成物的
DSH checkout 仍可能被当作 clean，违反每次开发/测试必须使用可复核 clean revision 的发布纪律。

## 修复

preflight 现在读取完整的 `git status --porcelain`，tracked、untracked、删除和重命名都会进入同一 fail-closed
错误 `DSH compatibility target has working tree changes`。没有修改 DSH 仓库或放宽支持 revision。

## 验证

在 canonical DSH 最新 `origin/master` `76fda729799fe9b3848dbe2c211d4b231032b81e`、版本 `0.1.2-rc.1`、
工作树 clean 的前置审计后执行：

```text
node --test scripts/run-dsh-compatibility-matrix.test.mjs scripts/check-dsh-preflight.test.mjs
pnpm run check:docs
git diff --check
```

结果为 `4/4` 测试通过，覆盖当前 allowlist、未知 revision、版本错配、tracked 修改和 `?? local-debug.log`；
文档检查与差异检查通过。

## 边界

这只收紧 DSH 来源的完整性检查，不扩大 rc.1 支持声明，也不替代 assembled、真实渠道、Provider、Hermes paired
或长期效果门禁。

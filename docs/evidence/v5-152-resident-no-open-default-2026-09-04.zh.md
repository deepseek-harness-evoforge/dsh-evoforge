# V5.152：常驻服务默认不重复打开 DSH Web

日期：2026-09-04  
EvoForge 测试源码 revision：`4630a5ded236f9d09c5f019e49f1ca031f3f86f2`  
Canonical DSH：`76fda729799fe9b3848dbe2c211d4b231032b81e`，`0.1.2-rc.1`，clean。

## 问题

`dsh-resident` 会在 DSH Web profile 每次启动或崩溃恢复时执行浏览器 handoff。旧默认值为
`noOpen: false`，用户省略配置时，常驻服务重启就可能再打开一个网页，和“一个原生 DSH Web 控制面”
的产品约束冲突。

## 修正

- `noOpen` 的 Bundle 默认值改为 `true`；常驻 unit 默认追加 DSH 官方 `--no-open`。
- 只有显式 `noOpen: false` 才允许该 OS service 在每次启动时请求浏览器交接。
- `dsh-resident` 仍只生成并管理一个 exact launchd/systemd unit，不创建网页、Router、Session 或状态库。
- 测试 driver 增加 `--open` 显式反向选择，验证默认关闭和显式打开两条路径。

## 验证

开发前重新 fetch 并核对 canonical DSH 为 `76fda729…`、`0.1.2-rc.1`、clean。随后执行：

```sh
pnpm --filter dsh-resident test
pnpm --filter dsh-resident typecheck
pnpm --filter dsh-resident build
```

结果：测试 `17 passed / 1 skipped`，类型检查和构建均通过。该修正没有读取凭据、启动真实外部渠道、
发送消息或改变 Gateway 路由；它只阻止常驻恢复创建重复浏览器页面。真实渠道、Provider、Hermes paired、
长期效果和 registry 发布门状态不变。

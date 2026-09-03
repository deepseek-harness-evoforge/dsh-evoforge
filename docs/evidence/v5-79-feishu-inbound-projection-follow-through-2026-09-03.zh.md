# V5.79：飞书入站时间转发收口（2026-09-03）

## 发现

V5.78 已让 Feishu Adapter 在真实 message/cardAction 回调中维护 `lastInboundAt`，但复核代码发现
`FeishuRuntime.reportTransport()` 只转发 connected/activity/error，未把该字段交给公共 Gateway registry。
结果是 Feishu 专属健康命令有事实，统一 Gateway/Channels 页面却可能仍显示“尚未收到”。

## 修复

- `reportTransport()` 现在在同一次 observation 中转发可选 `lastInboundAt`；未收到事件时仍保持缺省；
- 字段仍是 Adapter 观察事实，不主动探测 Feishu、不读凭据、不改变配对或路由；
- assembled-chat 回归断言在真实入站后要求公共 Gateway transport item 的 `lastInboundAt` 为数值；
- 复用现有 `dsh-control-center` 原生单页，没有新增 surface、网页或状态权威。

## DSH 基线与验证

测试前重新 fetch 最新 DSH 远端 `master` `76fda729799fe9b3848dbe2c211d4b231032b81e`，保持 clean；可执行
插件验证继续使用完整构建的 alpha.5 `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`，没有修改 DSH。

```sh
DSH_EVOLVE_DSH_SOURCE_DIR=<dsh-v0.1.2-alpha.5> \
  pnpm --filter dsh-feishu exec vitest run \
  test/dsh-assembled-chat.e2e.test.ts test/runtime-dispose.test.ts --maxWorkers 1
```

结果：目标 assembled/runtime 测试通过；V5.78 后的完整 Feishu 套件仍为 18 个测试文件、45 个测试通过。

## 发布影响

这是公共健康投影的完整性修复。真实 Feishu AS-2 仍因没有匹配的 pending pairing event 而未通过；真实
Provider、Hermes paired、长期负迁移/遗忘与完整浏览器恢复门不变，因此不创建 tag。

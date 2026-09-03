# V5.76：飞书健康页区分连接与入站事件（2026-09-03）

## 变更

`dsh-feishu` 的 Host 健康投影新增可选 `transport.lastInboundAt`。它只在 Adapter 收到飞书消息或 Approval
回调时更新，和已有的 `lastActivityAt`（连接、入站或出站的任意活动）分开。Control Center 的飞书技术详情
显示最近入站时间；没有入站时明确显示“尚未收到平台事件（仅连接已建立）”。字段可选且保持健康 payload
schema version 2，旧快照仍可解析。

该字段不执行平台探测、不读取凭据、不改变配对/路由、不调用模型，也不把 WebSocket `ready` 误报为事件订阅
已验证。它直接覆盖真实 AS-2 最容易误诊的状态：连接 ready 但 pending pairing 未出现。

## 验证

每次测试前先执行 `git -C deepseek-harness fetch origin --tags`，确认最新远端 master
`76fda729799fe9b3848dbe2c211d4b231032b81e` clean；因其上游根级构建缺陷，运行时证据锁定完整构建的
`dsh-v0.1.2-alpha.5` / `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。

```sh
DSH_EVOLVE_DSH_SOURCE_DIR=/path/to/dsh-v0.1.2-alpha.5 \
  pnpm --filter dsh-feishu exec vitest run test/health.test.ts
```

结果：`1 file passed; 3 tests passed`。同一 alpha.5 环境下此前完整 Feishu 套件结果为 `18 test files
passed; 45 tests passed`。新增测试覆盖 `lastInboundAt` 的 Host 汇总、JSONL/文本渲染和浏览器解析；没有把
任意 endpoint、用户身份、消息正文或 secret 放入投影。

## 影响范围

- 真实 Feishu AS-2 仍为失败：epoch-4 最新隔离重试只有安装、dump 和 WebSocket ready，通过不了 pending
  pairing 事件到达；见 [V5.74](v5-74-feishu-as2-epoch5-no-event-2026-09-03.zh.md)。
- 该增量不提升真实 Provider、Hermes paired、Telegram 外部路由或长期效果门，也不允许创建 release tag。

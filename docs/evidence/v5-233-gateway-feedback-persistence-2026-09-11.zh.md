# V5.233：Gateway 与反馈 persistence consumer 兼容

日期：2026-09-11。范围是 Gateway 恢复/配对校验和 Evolve 反馈投影；不是 rc.2 产品支持声明、发布门或 Hermes paired 结果。

## 固定对象与用户结果

- EvoForge：`f93bc5722a72ff88f84bbdf0bc771cccadb4e048` 加本轮 diff。
- alpha.5：独立 clean `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5` / `dsh-v0.1.2-alpha.5`。
- current：独立 clean `c291e7961a515f6d7af9304e7fd1d257929aef26` / CLI `0.1.5-rc.2`；本轮再次 fetch 后仍等于
  `origin/master`。两个源码树都已完成 frozen install 与官方根 build；详见[审计](../research/dsh-latest-audit-2026-09-11.zh.md)。

用户结果：已有渠道 Session 能通过明确的 persistence dialect 校验后恢复；用户在 current DSH 写入或删除反馈后，
插件只从可验证的持久 Session 前缀建立可归因投影，并可在重启或 provider 重挂后重建。

非目标：不替换 DSH Session、反馈、Agent、Storage 或审批权威；不修改上游；不增加 Tool/Skill/prompt、模型调用、
平台发送或凭据权限；不改 Candidate/evaluator/Generation 发布门。没有测量新的付费 token/cache 指标，也没有 better 声明。

## Gateway 合同

- 显式选择 alpha.5 snapshot/readFrom 或 current list/open/read/close，拒绝双 capability、缺失 capability、错误 handle
  identity/access/header、超长 read 和 malformed `{ eventState, events }`。不把 current envelope 当数组。
- 校验 header 与 event 内的有效 preset；后续 preset change 优先于旧 header。配置和 pairing grant 共享的 Session 必须有
  一致 Workspace、preset、provider、model 与 maxTokens owner tuple；公开 resolve 只接受当前 canonical route。
- Session resolution 保持 singleflight；一个 waiter 取消不取消其他 waiter，最后一个 waiter 退出会取消共享读取并允许
  新一轮解析。迟到 native Agent acquisition 仍被 join/dispose。并发 pairing target 校验和 grant 写入串行化。
- stop 先公布 stopping，再同步 abort startup/read；current read handle exactly-once close。已获得 handle 的 shutdown
  cleanup 使用独立 30 秒宽限，超时明确失败，不把 timeout 当成功释放；主读取错误不被附带 close 错误覆盖。
- apply 在异步 acquisition 前登记 rollback；启动失败或并发卸载会收回已取得及迟到的 domain/store，重复 close 不重放。

## 反馈合同

- alpha.5 保留原 message_feedback domain 事件语义；current 使用原生 `session/event`、`session/disposed` 和
  `feedback/committed`。冷提交 observer 的 borrowed prefix 在同步调用内 clone，不把借用对象留到队列。
- current 先经过 `messageFeedback.list` 队列屏障；live/recovery 路径要求参与的 `sessions.flush() === true`，再读取物理
  Session prefix。列出的反馈必须与持久 put/delete replay 精确一致；失败不把未落盘 live 反馈当作证据。
- Durable attribution 与 ExistingSkill evidence reader 均消费相同严格物理 reader；current 不再依赖旧 `inspect` 返回形状。
  Session/Message id 对齐上游非空字符串契约，不以旧插件局部长度上限误拒绝合法记录。
- monitor 属于提供上述服务的 injected fiber，捕获不可变 provider 引用；旧代被停用后不再投影或触发后续 callback。
  生产 store 在自身写队列内部复核 active guard；新代 readiness 不受旧代清理影响。
- activation catalog 每次只排入一个 Session，使 live 更新可插入；失败的 Session 保留待修复集合并重试，不重复扫描已成功
  项。恢复完成且 pending 集合为空之前，生产 feedback facade 不返回旧 positive projection。
- store 相同内容 replay 为 no-op；`observedAt` 保留 Session 投影首次观察值。容量按最新 sourceUpdatedAt 淘汰整 Session，
  不按重启扫描顺序或 replay 时间。卸载仅停用并关闭插件资源，不删除 DSH 原生 Session 或持久反馈。

## 验证命令与结果

命令均在 EvoForge 根执行，`<alpha5>` 与 `<current>` 指上述 clean、已构建源码树。所有 Vitest 命令一个 worker。

```text
DSH_EVOLVE_DSH_SOURCE_DIR=<current> pnpm --filter dsh-evoforge-gateway exec vitest run --maxWorkers 1
DSH_EVOLVE_DSH_SOURCE_DIR=<alpha5> pnpm --filter dsh-evolve exec vitest run --maxWorkers 1
DSH_EVOLVE_DSH_SOURCE_DIR=<current> pnpm --filter dsh-evolve exec vitest run --maxWorkers 1
DSH_EVOLVE_DSH_SOURCE_DIR=<current> pnpm --filter dsh-evolve exec vitest run \
  test/feedback-signal-monitor.test.ts test/feedback-signal-monitor.e2e.test.ts \
  test/durable-feedback-attribution.test.ts test/existing-skill-evaluation-evidence-vault.test.ts --maxWorkers 1
DSH_SOURCE_ROOT=<alpha5> pnpm run generate:typert
pnpm run typecheck
pnpm run build
pnpm run check:suites
pnpm run check:docs
git diff --check
```

- current Gateway：11 files / 133 passed，包括真实 current JSONL persistence read 与 reader/stop/rollback 故障注入。
- current 反馈四文件最终聚焦：4 files / 35 passed。真实 current Session/MessageFeedback/JSONL 路径证明 failed live flush
  后修复、live delete、cold put/delete、重启取证；真实 DSH Storage 路径证明乱序恢复容量、no-op replay、retired queued-write
  guard 与重开 readback。monitor/provider-scope 竞态主要为局部注入测试，不是完整产品 HMR 验收。
- current Evolve 全量（15:58 的运行，早于最后一个 monitor interleaving 回归）：969 passed / 6 failed。六项均为现有
  Case Pack 固定 revision 门：capability-absent-baseline 两项，cache-safe-status、dispose-owned-watcher、dsh-assembled、
  profile-install-remove 各一项。未绕过、重写或将这些门计作通过。
- alpha.5 Evolve 最终全量：81 files / 974 passed / 1 current-only skipped；包含现有 alpha clean-profile lifecycle 合同。
  根 typecheck/build 均 exit 0；套件检查 15/15、文档及 whitespace 检查通过。
- Typert 通过官方生成脚本重建；同时补齐此前源接口已有、生成元数据遗漏的 optional `getSessionGenerationPin` 声明，
  不手写生成内容或 source hash。

## 局限与后续门

物理读 deadline、message-feedback barrier 和 live flush 各有边界，不是一个原子、全 catalog、一致的恢复快照。
不服从 cancellation 的上游 open 可以在 stop 之后才返回；该 handle 仍会被观察并关闭，但不能宣称 stop 时已经物理释放
一个尚未返回的资源。已被 native domain 接收但永不 settle 的 acquisition/write/close 没有插件级强制撤销保证。
旧 alpha sidecar 与无反馈的 current Session 没有可证明的一一来源映射，不会凭猜测批量删除。

尚需 Session v3 retry/replacement/compaction/PTC cohort、依赖/lock/Case Pack/CI pin 迁移，以及 current 的完整
clean-profile add/dump/boot/reload/dispose/remove/readback、真实 Web/渠道/provider 矩阵。当前支持基线仍是 alpha.5；
本轮没有发布 tag、registry 上传、真实渠道发送、付费 Provider 或 Hermes paired 运行。

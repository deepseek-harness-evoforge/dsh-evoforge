# rc.2 全量测试剩余项与固定验收环境

- 日期：2026-09-14；EvoForge 起点 `f27e120`。
- canonical DSH fetch 后 clean HEAD/origin/master 均为
  `c291e7961a515f6d7af9304e7fd1d257929aef26`。
- 旧只读 checkout clean HEAD 为 `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。
  两者没有被修改；独立 rc.2 依赖仍沿用[安装记录](dsh-rc2-independent-install-2026-09-14.zh.md)。

## 修复三项测试失败

Request Control 的两个历史读取用例不再通过当前 native Session 重建 v0 日志，改为将完整历史 cut
交给生产 transcript reader，再使用它证明的 subject 测试 request-control projection。
保留原始物理时间、seed marker、继承计数和固定坐标；新增对 seq=2 的 session/end-seed 检查。
没有把 v0 伪装成当前 live Session，也没有改写 production reader 或删除原有反例。

Runtime surface 测试改为核对独立安装的 native Session/Goal/Tools 包版本，与 Goal/Tools 的精确 peer、dev
声明一致且非 optional；不再把 alpha.5 字符串写死在适用于多依赖环境的测试内。仍要求精确版本匹配，
不能用范围或缺失 peer 通过。正式依赖声明没有变化，测试本身不授予新版 release support。

两套依赖的两个测试文件各 39/39 通过，最终两套 Evolve 全类型检查通过。

## 查清六项 assembled 失败

仅在独立副本临时增强四项失败断言的诊断信息，然后复跑并恢复原断言。四项与先前的两项均确认同一原因：
case pack 锁定 db6bdc，当前提供 c291，revision guard 因此正确返回 incomplete。
没有改 revision guard、case pack、治理输入或期望结论。

独立副本 Evolve 包目录再次执行全量：

```text
DSH_EVOLVE_DSH_SOURCE_DIR=<c291-checkout> node_modules/.bin/vitest run
```

结果：85 文件中 80 通过、5 失败；1012 测试中 1006 通过、6 失败，exit 1。
剩余为 capability-absent-baseline 两项，以及 cache-safe-status、dispose-owned-watcher、
profile-install-remove、browser-e2e-guidance-assembled 各一项。

随后在同一独立依赖副本，只对这五个测试文件设置 `DSH_EVOLVE_DSH_SOURCE_DIR=<db6bdc-checkout>` 复跑，
5 文件、6/6 通过，exit 0。这证明旧固定验收在匹配环境仍可运行，不是 c291 的六项验收通过。
不能把两种环境的结果拼成“新版全量全绿”。下一步需为新版建立独立的可审计验收环境并执行同等门禁。

本轮没有生产代码、模型调用、profile、凭据、授权、历史或运行 Host 变更，尚不声明完成新版安装或真实渠道验收。

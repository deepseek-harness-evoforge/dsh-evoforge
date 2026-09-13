# rc.2 原生 Goal 统计夹具

- 日期：2026-09-14；EvoForge 起点 `ef4a1fa`。
- canonical DSH 再次 fetch 后 clean HEAD/origin/master 均为
  `c291e7961a515f6d7af9304e7fd1d257929aef26`。
- 独立 npm rc.2 依赖副本沿用[已完成的安装与构建](dsh-rc2-independent-install-2026-09-14.zh.md)，
  不代表该源码 commit 的逐字构建；不改动用户 Host 或正式支持版本。

## 变化

原 `goal-execution-metrics.test.ts` 在 rc.2 下 3/3 失败：旧夹具给 Assistant settlement 写顶层
sourceEventSeqs，而新版要求 embedded stream。该失败发生在原生 Session append，并非统计断言不一致。

现在按原生 Session 的实际 format 分开构造：v0 保留两个顶层 chunk 和原来的引用；v3 写含原始时间的
embedded stream，不写顶层 chunk/citation。旧 append 词汇仅在已确认 format=0 的分支动态调用，
不会重新声明为新版 native API。未知格式直接失败。两条分支都使用真实 SessionStore、SessionStats 和
TokenMeter，没有模拟统计值，也没有改动任何生产统计代码或原有期望。

v3 stream 保留相同首 token、usage、settlement 时间，并补全 block-start/end 与 finish；因此可以比较
相同工作边界下的原生统计，而不是把旧事件塞进新版 Session。

## 验证

在正式 alpha.5 和独立 rc.2 副本分别执行：

```text
cd packages/dsh-evolve
node_modules/.bin/vitest run test/goal-execution-metrics.test.ts
```

两边均 3/3 通过。指定两轮的 uncached input=30、output=9、cache read=70、cache write=5，
llm=180ms、tool=50ms、ttft=45ms、decode=135ms；其他 Goal 和普通用户轮次不混入。
未安装官方 projection、缺失 Goal 或归属歧义继续 abstain；Delivery Outcome 的 through-result 精确切点通过。
这些是确定性本地夹具数字，不是真实任务性能，monetaryCost 仍为 unavailable。

正式 `pnpm --filter dsh-evolve run typecheck` 通过。独立全量测试类型检查仍失败，本文件已无类型错误；
尚需处理其他 evidence 夹具，再做完整升级与真实工作流验收。无模型调用、凭据、授权、历史或发布物变更。

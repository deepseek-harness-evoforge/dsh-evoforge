# rc.2 transcript 源码类型边界迁移

- 日期：2026-09-14，EvoForge 起点 `5e67fad`。
- 本轮 fetch 后 DSH HEAD / origin/master 仍为 clean `c291e7961a515f6d7af9304e7fd1d257929aef26`。
  沿用此前 install/build exit 0 产物，本轮未重新安装或构建上游。
- 目的：为升级候选保留 v0/v3 历史证据校验，同时让 Evolve 源码在 rc.2 类型下编译。
  不扩大支持声明，不迁移实际用户数据，不改变当前单 Host。

## 边界

`TranscriptEvent` / `TranscriptHeader` 是私有只读历史输入类型，不是 native writable Session 类型。
它显式保留旧 chunk、旧 PTC dispatch、旧 surface 引用，以及 v0/v3 的 header version；没有向原生
SessionEventMap 注册已移除的事件，没有把历史 Assistant 强制断言成带 embedded stream 的新版 Assistant。
原有 runtime dialect、chunk、因果顺序、摘要、请求头与 surface 校验全部保留；类型本身不是 positive proof。

两个原生读取函数不能继续接受整个宽化后的历史事件 union：

- Goal 仍由原生 `foldGoal` 判断，只按原顺序提供它实际消费的 `goal/change` 和 User source 事实；
  不传递无关旧 Assistant/Tool 事件。输入中 Goal round 的缺失、跳号、重复与顺序错误仍被原生 fold 拒绝。
  detached 视图的 placement 不用于 Goal 判断，不写回、不进入摘要或模型输入。
- 中断恢复只生成用于 equality 检查的 expected witness，不执行修复或写 Session。
  两个已审计 revision 的官方 `repair.ts` 源码逐字相同；将该只读判断规则固定在 witness 模块并保留 MIT
  许可说明，避免伪造新版 stream 字段或删掉旧引用来满足 live API 类型。保留 started/unknown 与 not-started
  的区别、pending 顺序、准确的最后 seq/time、Tool/step/turn 完整结束后缀。

没有新增 ctx 服务、注册、资源、持久化、模型可见字节、权限、凭据读取或外部效果。卸载和回滚不产生新的
清理要求；历史源事件不被修改，DSH 仍是唯一 Session/Goal/恢复执行权威。

## 验证

使用[首轮扫描](dsh-rc2-type-migration-2026-09-14.zh.md)的隔离副本及 491 项 current 类型映射：

```text
tsc --noEmit -p packages/dsh-evolve/tsconfig.json
```

原先两份 reader 源文件的 106 项错误，在历史请求头/surface 修正和本次显式输入边界完成后为 **0**。
这里只声称该项目源码配置通过，不包括 current `tsconfig.test.json` 全量旧夹具迁移或完整 npm 安装构建。
原工作树 alpha.5 开发依赖下 `pnpm --filter dsh-evolve run typecheck`（含测试配置）及 `run build` 均 exit 0；
build 包含声明生成、打包和 Typert/Node artifact 校验。

隔离 current runtime aliases 下执行：

```text
vitest run test/interaction-goal-witness.test.ts test/interaction-repair-witness.test.ts test/interaction-v0-surface.test.ts test/interaction-request-header.test.ts test/interaction-episode-projector.test.ts test/interaction-episode-projector-session-v3.test.ts test/interaction-trigger-request-control.test.ts --config ../../vitest.rc2.config.mjs --maxWorkers 1 --reporter=dot
```

7 文件 **277/277**；v0 projector/request-control 仍仅在构造历史夹具时使用 alpha.5 Session 构造器，
reader 和其余 native imports 使用 current aliases。Goal 与 repair 新增 14 项差异对照在旧/新 native
纯读取函数下均通过；生产代码没有这些测试所需的历史 fixture cast。

原工作树以 `DSH_EVOLVE_DSH_SOURCE_DIR=<c291e796-checkout>` 跑 binder + evidence-resolver 为 **107/107**，
覆盖原生 Agent/Session、Gap/receipt、物理 readback 和 dispose；静态开发依赖仍为 alpha.5，不冒充完整
current cohort。旧依赖 projector v0/v3 204/204，源码与测试类型检查通过。

## 未完成

其他包的迁移、current 测试配置、peer/dev/lockfile、CI 支持矩阵、完整安装/卸载以及真实产品 profile
升级回归仍待完成。未重启正式 Host，未让新版读取或写入用户历史，未声明 Hermes 比较优势。

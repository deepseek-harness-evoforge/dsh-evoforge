# rc.2 下保留历史 Transcript 验收

- 日期：2026-09-14；EvoForge 起点 `76dd537`。
- canonical DSH fetch 后仍为 clean `c291e7961a515f6d7af9304e7fd1d257929aef26`；未修改上游。
- 独立 npm rc.2 安装及构建基线沿用[独立安装记录](dsh-rc2-independent-install-2026-09-14.zh.md)。
  npm 发布物不代表该源码 revision 的逐字构建；本轮不升级正式依赖或用户 Host。

## 失败原因与边界

`interaction-episode-projector.test.ts` 的 139 个用例在 rc.2 中全部先因 native Session 拒绝 v0 header
而失败，尚未执行目标读取器。将历史夹具改成 v3 会丢失原来的历史读取覆盖，因此没有这样处理。

新增仅限 test 的 `HistoricalV0TranscriptFixture`：它生成带 seq/time 的历史输入，不是 Session，
没有事件发布、运行、投影、持久化或恢复能力。类型采用生产读取器已有的历史读取词汇，不向 native
SessionEventMap 添加已删除的事件，不修改生产读取器或原有断言。负例仍保留故意错误、混合格式与旧引用。

初稿 JSON.stringify 在深层合法元数据用例中栈溢出；改用 DSH 自带的 stack-safe snapshotJsonValue/deepFreeze
后通过。新增依赖仅为开发依赖 `dsh-util-values`，没有生产依赖、模型表面或权限变化。
v3 夹具也改用历史输入 header 类型，避免用 native literal-version 类型伪装可变的非法格式测试数据；
Session id/offset 改为原生 brand 构造，无需 header 的双重强制转换。

## 一致性与验证

在正式 alpha.5 依赖下临时给 v0 writer 加入 native Session 对照：每次 append 同时送入原生 Session，
通过显式栈逐字段比较完整事件。只归一化两次调用的顶层 time，其他字段、数组顺序、seq、data、surface 与
citations 必须相同。全部 139 个测试通过；随后移除临时对照并重新运行，最终 helper 不依赖 v0 Session
构造器。原有固定时间、完整 proof 和 digest 断言保持不变。

正式 alpha.5 和独立 rc.2 副本分别执行：

```text
cd packages/dsh-evolve
node_modules/.bin/vitest run test/interaction-episode-projector.test.ts test/interaction-episode-projector-session-v3.test.ts
```

两边均 204/204 通过。正式 `pnpm --filter dsh-evolve run typecheck` 通过。
独立 rc.2 的完整 `tsconfig.test.json` 仍 exit 2：剩余 8 个文件、52 条错误，本轮三个测试文件无类型错误。
这是读取器的本地夹具验收，不是新版完整支持、真实模型效果、实际历史升级或用户重启恢复证明。
正式单 Host、用户凭据、授权和历史均未改动，后续仍需迁移 live evidence 与 metrics 夹具并完成升级验收。

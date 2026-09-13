# rc.2 原生观察器测试夹具迁移

- 日期：2026-09-14；EvoForge 起点 `2a91eeb`。
- canonical DSH 再次 fetch 后 HEAD/origin/master 均为 clean
  `c291e7961a515f6d7af9304e7fd1d257929aef26`，不修改上游或运行中的 Host。
- 本轮沿用[独立依赖安装记录](dsh-rc2-independent-install-2026-09-14.zh.md)中的 npm rc.2
  安装与构建结果；npm 发布物不等同于该源码 revision 的逐字构建。

## 问题与修复

独立 rc.2 安装下，Capability Map 与 Installed Skill Baseline Monitor 的 12 个测试中有 11 个失败：
旧夹具构造 format-v0 Session，新构造器拒绝；旧 Inbox 也已不再是 Agent 包的公开构造器。

删除两份手工 Agent/Inbox 夹具，改为由原生 AgentLoop、SessionStore 和其实际依赖创建 Agent。
测试 Context 通过 Cordis effect 持有并释放该原生环境；不配置模型 Provider、持久化后端或新 Host。
恢复边界测试先通过原生 append 放入历史 Skill invocation，再向观察器发送 resume 事件，
继续证明旧 invocation 不被追溯封存、新 invocation 才产生基线。这仍是模拟 resume 通知的观察器测试，
不是进程重启验收。原有目录变化、乱序、失效、错误与恢复断言不变。

新增依赖仅为 Evolve 的开发依赖 `dsh-agent-loop`；正式 runtime peer、Bundle、模型组成、权限、持久状态
均未变化。该辅助文件位于 test，不进入发布包；无需部署测试夹具或变更用户 profile。

## 验证

在正式 alpha.5 依赖和独立 rc.2 依赖副本分别执行：

```text
cd packages/dsh-evolve
node_modules/.bin/vitest run test/capability-map.test.ts test/installed-skill-baseline-monitor.test.ts
```

两边均 12/12 通过。正式工作树 `pnpm --filter dsh-evolve run typecheck` 通过。
独立副本全量 `tsconfig.test.json` 检查仍 exit 2，余下 10 个文件共 98 条类型错误；
本次两个文件及新增 helper 没有类型错误，不能将其报告为全套新版测试通过。
独立副本 `pnpm peers check` 无 peer 冲突。

一次未指定 registry 的 offline install 使用默认镜像缓存，因镜像版本元数据过旧失败；
改为 `pnpm install --offline --ignore-scripts --registry=https://registry.npmjs.org` 后通过，下载数为 0。
没有改动正式支持版本或重启现用 Host；完整迁移、真实渠道与升级验收仍待完成。

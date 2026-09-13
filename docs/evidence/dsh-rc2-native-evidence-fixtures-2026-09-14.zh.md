# 原生渠道与 Episode 证据夹具迁移

- 日期：2026-09-14；EvoForge 起点 `6ec4d96`。
- canonical DSH fetch 后 clean HEAD/origin/master 均为
  `c291e7961a515f6d7af9304e7fd1d257929aef26`，上游未修改。
- 对照正式 alpha.5 与[独立安装的 npm rc.2](dsh-rc2-independent-install-2026-09-14.zh.md)，
  不以 npm 版本号证明 c291 源码身份。本轮不改生产代码、依赖声明或用户 Host。

## 为什么不能只换成历史数据

Gateway-aware resolver、Gateway ingress contract、Episode evidence resolver 三组用例在 rc.2 下
174 失败、1 通过，主要被 v0 header 和旧 Assistant 写法挡在目标检查之前。
这些测试包括 native Session 的 identity、后注册监听器与真实 flush barrier，不能用无运行能力的历史
数据 writer 冒充 Session。

保留原生 Session/SessionStore，按实际 format 构造消息。共享测试 helper 在 v0 使用原生旧 chunk/citation，
在 v3 使用原生 embedded Assistant stream，并在用户输入前写固定来源的空 System head。
旧词汇只在实际 v0 分支动态调用，没有扩展当前 SessionEventMap；未知格式直接失败。
旧格式的 chunk 内容、顺序、时间与引用保持原样；新版用更少的物理事件记录相同消息。
已移除的 SessionEventSuffix 类型改用读取适配器已有的 normalized-cut 类型。

## 验证与限制

两套依赖分别在 Evolve 包目录执行：

```text
node_modules/.bin/vitest run test/gateway-aware-interaction-episode-evidence-resolver.test.ts test/gateway-ingress-evidence-resolution.contract.test.ts test/interaction-episode-evidence-resolver.test.ts
```

最终两边均 175/175 通过。首次 rc.2 迁移后有 1 个精确切点断言仍使用旧 dialect/seq；改为显式固定的
两套预期：v0 header/context/assistant/call/result 为 5/6/11/12/13，v3 为 6/7/8/9/10。
预期没有从被测读取器计算，其他安全与失败断言保持原样，没有删除或跳过用例。

包含错 Workspace/Session、证据冲突、未知效果、超时与 late settlement、dispose、读取失败、
精确 cut，以及后注册的真实 SessionStore listener 在 flush 前入队的路径。
Gateway 的实际 journal/source 在隔离存储中验证，不是 Telegram/飞书真实平台发送验收。

正式全量 Evolve 类型检查通过；独立 rc.2 测试类型错误从 47 降至 11，余下 2 个文件。
本次三个文件与 helper 无类型错误。无模型调用、生产表面、权限、凭据、历史或部署变化；
完整新版测试、升级安装生命周期、真实渠道与任务效果仍待验收。

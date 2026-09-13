# DSH rc.2 类型迁移：首轮扫描与交付测试适配

- 日期：2026-09-14。
- EvoForge 扫描起点：`104d9aa283fe8259ce0c59ead40e7c715229fc04` 的隔离源码副本。
- DSH：已审计、已构建的 `c291e7961a515f6d7af9304e7fd1d257929aef26`。
- 目的：推进已验证的原生重连修复进入可支持部署；不把 alpha.5 类型检查误称为 rc.2 类型检查。

## 扫描方法和范围

将上述 EvoForge commit 导出到独立目录，复用现有工具链和包间构建产物，不修改实际工作树的依赖。
从指定 DSH checkout 的 package.json 中读取 `types` / exports 类型入口，生成 491 项绝对路径映射，
覆盖副本的 tsconfig.base.json；逐包运行 `tsc --noEmit -p packages/<package>/tsconfig.json`。
这不是安装 rc.2 npm 依赖后的全量构建，也没有覆盖每个单独的 tsconfig.test.json。

首轮 12 个包中 5 个失败。完成本次交付测试适配后，8 个包的上述项目配置通过，剩余如下：

| 包 | 当前扫描错误数 | 位置 / 原因 |
| --- | ---: | --- |
| dsh-evolve | 106 | 两个 interaction episode reader 文件；当前 Session 类型不再包含旧版 chunk/PTC 事件和 v0 header |
| dsh-feishu | 2 | FeishuAction 的字符串 Session id 与新版 branded SessionId 不匹配 |
| dsh-github-review | 4 | 两个测试文件仍把新版 type-only Inbox 当作构造器 |
| dsh-goal-continuity | 2 | 两个测试夹具仍使用已移除的 SystemPrompt `persona` 配置字段 |

错误数不是独立缺陷数。尤其不能把历史事件分支强制断言为新版事件，或删除旧格式校验来清零错误。
通过包为 Control Center、Doctor、Attention、Evolution Web、Gateway、Resident、Software Delivery、Telegram；
结论仅限上面运行的项目配置，不是这些包的完整兼容或发布声明。

## 已完成的交付测试适配

`complete-delivery.test.ts` 的公共 setup 改为等待 `agentLoop.create()` 完成，再把真实 Agent 交给原生 Goal。
alpha.5 的同步返回同样可以 await；rc.2 的异步返回不再被误当成 Agent。
测试提示文字通过两版共有的 `systemPrompt.section()` 注册，不再使用新版已移除的 `persona` 配置。
这两处都仅影响测试夹具，不改变产品模型组成、权限、完成判定或外部效果。

为排除“只换了类型、运行仍是旧版”的假阳性，另从该 DSH checkout 的 runtime exports 生成 279 项
Vitest resolve aliases，在隔离副本中执行实际 rc.2 类。相同测试仍执行原生 Tool/Goal，Git 使用临时本地仓库，
GitHub 远端响应使用夹具；真实 GitHub 专用用例保持 skipped。

```text
# 原工作树，alpha.5 开发依赖
pnpm --filter dsh-software-delivery run typecheck
pnpm --filter dsh-software-delivery exec vitest run test/complete-delivery.test.ts --maxWorkers 1

# 隔离副本，rc.2 类型映射；随后在该包目录使用 rc.2 runtime aliases
tsc --noEmit -p packages/dsh-software-delivery/tsconfig.json
vitest run test/complete-delivery.test.ts --config <rc2-alias-config.mjs> --maxWorkers 1
```

两侧类型检查通过；两侧运行均为 **13 passed / 1 skipped**。rc.2 覆盖目标完成、失败保留 active、原生
shell policy 拒绝、参数边界、精确提交与远端状态绑定、未知创建结果复用等现有检查。
只在隔离副本去掉 `await`，运行首个完整交付用例，立即出现原生 rc.2
`GoalError: agent "undefined" is not live in this registry`；恢复后再次全文件通过。
该反向对照证明本次适配处理了实际新版调用路径，而不是放宽测试断言。

## 仍待完成

本轮未改变 peer/dev 版本、lockfile、CI 支持白名单或真实部署。原 alpha.5 Host 保持不变。
剩余历史事件类型、其余夹具、完整依赖安装/构建和真实产品 profile 的权限与渠道回归仍需完成；
原生 Web 的 rc.2 修复验收见[重连记录](dsh-rc2-web-reconnect-2026-09-14.zh.md)。

后续：Evolve 的 106 项源码错误已通过显式历史输入边界迁移关闭，未删除历史分支或放宽 runtime 校验；
范围与剩余门禁见[transcript 类型边界](dsh-rc2-transcript-type-boundary-2026-09-14.zh.md)。上表保留首轮扫描结果。

Continuity 的两个测试配置错误也已关闭，并在 current 原生运行时验证冷恢复与独立进程 SIGKILL 恢复，
见[冷恢复夹具适配](dsh-rc2-continuity-fixtures-2026-09-14.zh.md)。

GitHub Review 的四项旧 Inbox 构造器错误已用真实 AgentLoop 队列夹具关闭，两版 assembled 与请求组成
检查通过，见[原生队列迁移](dsh-rc2-review-inbox-2026-09-14.zh.md)。

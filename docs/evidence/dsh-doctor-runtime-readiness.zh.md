# dsh-doctor Runtime Readiness 实现证据

> 日期：2026-08-24
> 状态：implemented；尚未发布

## 用户结果

用户执行一次 `/doctor`，即可得到当前 DSH composition 的三态结论、具体阻塞插件和下一步动作，无需理解 Fiber 数值状态或逐项比对 Plugin Inventory。插件只诊断，不修复、不重启、不扩大权限。

## 已实现行为

- exact required module 缺失、disabled、failed 的稳定分类；
- pending/loading/unloading/no-live-fiber 返回 `unknown`，不在重载窗口误报；
- 全部 enabled failed entry 的 module name 与 entry id 有界列举；
- 一次读取、无缓存、无轮询、无健康历史；
- active 的必需飞书/Telegram Adapter 会读取现有 Gateway 脱敏 health snapshot，并分别输出
  unavailable/connecting/ready/degraded/stopping 的三态归约；
- Gateway snapshot 抛错或结构损坏时 fail closed，不让诊断命令崩溃；
- 原生 `/doctor` Command 的注册、执行与卸载；
- `dsh.bundle` 自动 profile layer、tarball 安装、原生 `--dump-config`、真实 DSH Loader boot 与 remove 后清理。

## 验证

`packages/dsh-doctor/test` 当前覆盖 35 个测试，关键行为包括：

1. 必需插件全部 active 时返回 `READY`；
2. 缺失、禁用和失败插件返回 `NOT READY` 并命名阻塞项；
3. loading required plugin 返回 `UNKNOWN`；
4. 真实 Cordis Loader + Commands 中注册、执行和卸载；
5. active 飞书/Telegram Adapter 分别从 Gateway 当前 transport facts 得到 ready/degraded/connecting/unavailable；
6. Gateway snapshot 损坏时 fail closed 为 unavailable；
7. 打包 tarball 经原生 `dsh plugin add` 自动加入 Bundle，`--dump-config` 可见；最终 packed Doctor 在真实
   DSH Loader 中先观察测试 Adapter 的 degraded，再经 Cordis 原位 reload 观察 ready，最后 remove 后 manifest
   与 Bundle 列表恢复为空。

本地验证命令：

```bash
pnpm --filter dsh-doctor typecheck
pnpm --filter dsh-doctor test
pnpm --filter dsh-doctor build
```

## KV Cache 与权限

插件只依赖 Loader、Commands 与可选的现有 Gateway 只读服务。它不注册 Tool、Prompt、Skill、System Message
或模型调用，不读取 secret、不执行网络请求、不产生外部副作用，也没有后台 poller。正常 Session 的模型 token
增量为 `0`。

## 未完成

- 尚未发布 registry 版本；
- 尚无陌生用户安装和诊断成功率数据；
- 不能诊断“启动前即失败”的 profile；
- 不探测外部 provider、凭据、端口和文件系统，也不保留历史或自动修复；
- 真实飞书/Telegram 平台与多日断线恢复仍由各自真实渠道门禁验证，测试 Adapter 不构成平台通过证据。

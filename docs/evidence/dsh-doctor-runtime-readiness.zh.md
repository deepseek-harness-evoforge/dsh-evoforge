# dsh-doctor Runtime Readiness 实现证据

> 日期：2026-08-17
> 状态：implemented；尚未发布

## 用户结果

用户执行一次 `/doctor`，即可得到当前 DSH composition 的三态结论、具体阻塞插件和下一步动作，无需理解 Fiber 数值状态或逐项比对 Plugin Inventory。插件只诊断，不修复、不重启、不扩大权限。

## 已实现行为

- exact required module 缺失、disabled、failed 的稳定分类；
- pending/loading/unloading/no-live-fiber 返回 `unknown`，不在重载窗口误报；
- 全部 enabled failed entry 的 module name 与 entry id 有界列举；
- 一次读取、无缓存、无轮询、无健康历史；
- 原生 `/doctor` Command 的注册、执行与卸载；
- `dsh.bundle` 自动 profile layer、tarball 安装、原生 `--dump-config`、真实 DSH Loader boot 与 remove 后清理。

## 验证

`packages/dsh-doctor/test` 当前覆盖 5 个行为测试：

1. 必需插件全部 active 时返回 `READY`；
2. 缺失、禁用和失败插件返回 `NOT READY` 并命名阻塞项；
3. loading required plugin 返回 `UNKNOWN`；
4. 真实 Cordis Loader + Commands 中注册、执行和卸载；
5. 打包 tarball 经原生 `dsh plugin add` 自动加入 Bundle，`--dump-config` 可见，真实 DSH Loader 执行后再 remove，manifest 与 Bundle 列表恢复为空。

本地验证命令：

```bash
pnpm --filter dsh-doctor typecheck
pnpm --filter dsh-doctor test
pnpm --filter dsh-doctor build
```

## KV Cache 与权限

插件只依赖 Loader 与 Commands。它不注册 Tool、Prompt、Skill、System Message 或模型调用，不读取 secret、不执行网络请求、不产生外部副作用，也没有后台 poller。正常 Session 的模型 token 增量为 `0`。

## 未完成

- 尚未发布 registry 版本；
- 尚无陌生用户安装和诊断成功率数据；
- 不能诊断“启动前即失败”的 profile；
- 不探测外部 provider、凭据、端口和文件系统，也不保留历史或自动修复。

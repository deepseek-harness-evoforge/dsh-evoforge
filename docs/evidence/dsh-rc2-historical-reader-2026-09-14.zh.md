# rc.2 迁移：历史请求头语义与剩余 surface 边界

- 日期：2026-09-14；EvoForge 起点 `007126d`。
- 本轮 fetch 后 canonical DSH HEAD 与 origin/master 仍为 `c291e7961a515f6d7af9304e7fd1d257929aef26`，工作树 clean。
- 该 checkout 沿用此前 frozen-lockfile install / 官方根 build 的 exit 0 产物；本轮未重新安装或构建上游。
- 范围：只读历史 transcript reader。没有增加服务、监听、持久化、模型输入、权限、凭据读取或外部效果。
  不改变当前 Session，不迁移用户数据；回滚代码不会撤回任何历史外部效果。

## 区分夹具与实际读取失败

继续使用[类型迁移扫描](dsh-rc2-type-migration-2026-09-14.zh.md)的隔离副本和 rc.2 runtime aliases。
完整替换 native runtime 后，旧 projector 文件的 138 项测试全部在 `Session.create(version: 0)` 处失败：
新版构造器只接受 v3，读取器尚未运行。这不能当成 138 项产品读取缺陷。

仅在隔离副本让该文件的 **夹具 Session 构造器**直接导入已审计 alpha.5 的构建产物；projector、LLM 和其余
native imports 继续使用 rc.2 aliases。没有修改仓库测试的 native import，也没有创建第二 Host。
这样旧数据可以进入实际 current reader：原有 138 项变成 129 passed / 9 failed。
这一混合测试证明旧数据读取，不代表新版 Host 可以打开旧 Session 或完成数据升级。

## 请求头修正与反向对照

审计两个版本的 `packages/core/session/src/request-header.ts` 后确认：alpha.5 的 canonical/equality 包含
`system`，rc.2 不再保留或比较这个字段。新增一条使用非空历史 system prompt 的完整 transcript 测试，
在 current helper 下得到 abstained；换为历史读取适配后得到 proven，再恢复 current helper 又失败。

`interaction-request-header.ts` 只补回历史 system 字段的规范化和 equality，config/default/tools 继续交给
native helpers。调用点现有 dialect grammar 仍先拒绝 v3 的 `request/header.system`，不放宽混合格式准入。
空 system 仍规范化为缺席；不同非空 system 或有/无 system 仍不相等。测试数据不包含真实会话或凭据。

实际命令与结果：

```text
# 原工作树，alpha.5 开发依赖
pnpm --filter dsh-evolve run typecheck
pnpm --filter dsh-evolve exec vitest run test/interaction-request-header.test.ts test/interaction-episode-projector.test.ts test/interaction-episode-projector-session-v3.test.ts test/interaction-trigger-request-control.test.ts --maxWorkers 1 --reporter=dot

# 隔离副本的 package 目录，rc.2 runtime aliases
vitest run test/interaction-request-header.test.ts test/interaction-episode-projector-session-v3.test.ts --config ../../vitest.rc2.config.mjs --maxWorkers 1 --reporter=dot
vitest run test/interaction-episode-projector.test.ts --config ../../vitest.rc2.config.mjs --maxWorkers 1 -t 'retains a historical v0 system' --reporter=dot
```

旧依赖源码与测试类型检查通过，4 文件 244 tests passed；current header/v3 为 68 passed，新增历史
完整用例为 1 passed / 138 skipped。未把 narrow selection 中的 skipped 计入通过数。

另在原工作树执行 `DSH_EVOLVE_DSH_SOURCE_DIR=<c291e796-checkout> pnpm --filter dsh-evolve exec vitest run
test/generation-binder.e2e.test.ts --maxWorkers 1 --reporter=dot`，6/6 通过。该现有 assembled fixture 使用
current 原生 Agent/Session、临时 Storage、Gap/receipt/readback 与卸载路径；静态开发依赖仍为 alpha.5，
因此不替代全 rc.2 依赖安装或真实渠道验收。`pnpm run check:docs` 与 `git diff --check` 通过。

## 尚未解决，不能升级部署

其余 9 项失败不是此次 header 修正解决的。隔离诊断捕获到 current `foldSurface` 拒绝历史 Assistant 的
`sourceEventSeqs`，堆栈进入 `humanIngressRemainsVisibleAtRequest`。没有删掉 citation 或改写源事件来绕过
校验；需要显式、受测的历史 surface 读取边界。诊断 console 输出仅在隔离副本短暂使用，随后移除。

本轮不宣称 106 项类型迁移错误已全部解决，不更新依赖/pin/支持矩阵，不把部分兼容提交部署成新版产品。
原 alpha.5 单 Host PID 40511 继续监听 127.0.0.1:3000，未重启，用户历史与授权未被候选版本读取或改写。

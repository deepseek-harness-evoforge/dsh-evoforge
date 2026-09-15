# 原生文件交付所需核心升级：隔离候选验证

## 身份与范围

EvoForge 基于 `d80e96e7441553a5145634750ce95434d1161495` 的独立归档副本，安装真实 npm 依赖，不复用主工作树
的 node_modules。DSH 官方 fetch 后 master 仍为 `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`；该源码的独立
安装与构建结果见 [当日上游审计](../research/dsh-latest-audit-2026-09-15.zh.md)。本记录不把 npm 版本等同于 Git revision。

候选改动尚未并入支持基线或部署：DSH 开发/peer 依赖改为 `0.1.6-alpha.1`，schemastery 为 `3.18.2`，
cordis-plugin-loader 为 `1.0.3`；补齐当前声明的开发 peer closure，不添加生产运行时 Provider。
生产仍使用 alpha.5，文件外发开关没有启用。本次不读取凭据，不修改授权或用户历史。

## 已定位并在隔离候选修正的问题

1. 全量替换版本后，`pnpm install --ignore-scripts --registry=https://registry.npmjs.org` 失败于不存在的
   `@deepseek-ai/dsh-code-runtime@0.1.6-alpha.1`；单包 `pnpm view` 重现。上游 `7c9bb5914c` 将该包改名为
   `dsh-ptc-runtime`，新名称版本查询成功。候选中 Evolution、Delivery 的开发依赖使用新名称。
2. 当前 Tools 与 TokenMeter 增加 sandbox-policy、compaction-image-offload peer。补齐候选开发依赖后，
   `pnpm peers check` exit 0，报告无 peer 问题。
3. 当前 DSH 删除 `agent/session-start`，用可等待的 `agent/created` 合并初始化；源码依据 `9b7a8ccc9f`。
   候选中四个 Evolution observer 和 Continuity 使用当前事件，不修改上游、不伪造旧事件类型。
   Continuity 的合成事件测试改为等待原生 serial dispatch；Evolution 合成夹具尚未完成迁移。

## 实际命令和结果

下列命令在隔离候选执行。原生组合测试均设置 `DSH_EVOLVE_DSH_SOURCE_DIR` 指向上述 `0d1f5000` 源码；
文件测试另设 `DSH_FEISHU_TEST_NATIVE_FILES=1`。模型和渠道传输为测试实现，不代表真实平台送达。

- `pnpm install --ignore-scripts --registry=https://registry.npmjs.org`：修正依赖后成功。
- `pnpm peers check`：成功，无缺失或冲突。
- `DSH_SOURCE_ROOT=<原固定 alpha.5 源码> pnpm run generate:typert`：成功，继续使用仓库原来固定的官方生成器，
  没有修改其 revision 门禁。生成器通过不等于已经证明新版 Web Remote 合同。
- `pnpm run build`：成功，包含产物校验。随后 Continuity 的事件迁移另经下述类型与原生测试验证。
- `pnpm --filter dsh-evolve exec vitest run test/generation-binder.e2e.test.ts --maxWorkers 1`：6/6，
  包括未来会话 Skill 固定、同名 Skill 替换、精确回滚和原生 Gap 路径。
- `pnpm --filter dsh-goal-continuity exec vitest run test/cold-resume.e2e.test.ts --maxWorkers 1`：1/1。
- `pnpm --filter dsh-goal-continuity exec vitest run test/goal-continuity.test.ts --maxWorkers 1`：9/9；
  同包 `run typecheck` 成功。
- `pnpm --filter dsh-evoforge-feishu test`：27 个文件、105/105，99.42 秒；包含默认渠道路径与三条原生文件组合测试。
  完整渠道测试串行运行，避免打包过程清理共享 Gateway 产物导致错误。
- `pnpm run typecheck`：未通过。继续单独运行 Evolution typecheck，生产源码阶段通过，测试阶段仍拒绝旧
  `agent/session-start` 夹具；不得据此宣称完整新版支持。

## 尚未证明

Evolution 合成生命周期测试必须按新的 awaited creation、registry registration 和重复事件语义迁移，而不只是改字符串。
其余完整产品组合、当前格式的真实历史副本升级与回退、单 Host 生产切换、Web 恢复、真实飞书附件下载仍需完成。
不得用以上隔离成功替代这些验收，也不得将文件能力标为已部署。

本次结束前 `lsof -nP -iTCP:3000 -sTCP:LISTEN` 仍只有原 Node PID 40511 监听 `127.0.0.1:3000`。

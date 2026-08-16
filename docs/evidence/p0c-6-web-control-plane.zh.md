# P0C.6 真实 DSH Web 控制面证据

- 日期：2026-08-16
- DSH revision：`47f943859bef60e4160492346772ded9b24f765a`
- 状态：implemented，真实本地 DSH/Web/浏览器验收通过；尚无陌生用户可用性数据

## 验收对象

`dsh-evolve-web` 是一个可删除的 profile Bundle。Bundle 只插入 `dsh-evolve` host runtime 与 `dsh-evolve-web` Client Module；高级 source、resident 与 auto-promotion 配置保持显式。Client Module 把生成式 Remote 挂到 DSH 原生 API Gateway，并在 root-scoped `sidebar.footer.action` 注册入口，因此无 Session 时仍可使用。

## 真实装配

测试从 workspace 构建两个 npm tarball，使用隔离的临时 `DSH_HOME` 在**同一次** `dsh plugin --profile web add` 中安装到真实 `web` profile；没有手写或传入额外 patch。Profile 自动把 `dsh-evolve-web` 记录为 Bundle，配置 dump 出现 exact 两行，再由固定 revision DSH Loader 启动 OS 分配端口。启动页的 `window.__DSH_BOOT__` 出现 `dsh-evolve-web`；DSH 自己的 `/plugins/dsh-evolve-web/client.js` 返回 `200`，纯 Node 语法检查通过，并含 8 个生成 Remote 方法。

真实装配首先发现 host bundle 残留标准 decorator token，导致 plain Node `SyntaxError`。构建改为先消费 TypeScript 发出的 JavaScript，再由 tsdown 打包，并增加 npm artifact `node --check` 门；后续全仓 source-mode 回归又要求运行类通过标准 decorator protocol 显式登记 metadata，独立静态契约只供固定 Typert generator 分析，因此源码和 npm artifact 都能被各自的真实 Loader 接受。第二次浏览器装配发现 slot inject 工厂未显式等待 `remote.evoforgeEvolution`，DSH 正确拒绝访问；实现改为 generated Remote mount 完成后通过嵌套 `ctx.inject` 注册全局 slot。最终 Bundle 验收还发现普通 dependency 会让 pnpm 在同批本地 tarball 之外错误访问 registry；Web artifact 已内联浏览器 Remote，因此 host 契约改为相邻 plugin peer，并由 Bundle patch 保证运行时装配。各项都先保留失败证据，再以测试和真实 DSH 重跑转绿。

卸载测试只执行 `dsh plugin --profile web remove dsh-evolve-web`：Profile 的 Bundle 列表和配置 dump 均不再含 EvoForge 行；随后原生 Web 重新启动，启动页不含 EvoForge Client Module，原插件 URL 返回 `404`。本地验证显式安装的 plain `dsh-evolve` tarball 仍可作为 inert dependency 留在 profile，但不再进入 composition；发布后的 registry 安装由 Web 包的 peer 自动解析 host 包。

## 浏览器验收

使用真实 DSH 页面完成以下操作。该浏览器验收额外加载仓库内测试 patch，只覆盖 Bundle 已插入的
host 行，把 supervisor、私有 draft root 与一个静态 Shadow Target 指向隔离的测试目录；默认
Bundle 仍保持这些能力关闭。夹具不重复插入 Bundle 行：

1. 不创建 Workspace、Session 或 API key，确认侧栏出现“演化”；
2. 打开面板，读取 `原生 DSH / 运行中 / 0 待审查 / 自动晋升关闭`；
3. 点击暂停，确认 UI 显示“已暂停”和 durable action receipt；
4. 关闭并重启同一个隔离 DSH 进程；
5. 刷新页面并重新打开面板，确认仍为“已暂停”；
6. 点击恢复，确认权威状态重新显示“运行中”；
7. 当前页面控制台 error 数为 `0`。

这条验收没有创建 Session、没有发送用户消息、没有调用模型、没有读秘密，也没有触碰真实用户 profile。最终恢复为运行状态。

## KV Cache 与边界

Web Adapter 不注册 Tool、Prompt、Skill、System Message 或 Session Event，UI state 不写入 Session。Remote 只在打开、刷新和动作后读取，普通 Agent 请求的消息前缀与 Tool Schema 不变，因此模型 Token 增量为 `0`。一次 overview 最多返回 20 条可处理审查和 20 条已批准未激活 Generation；审查详情最多返回一个 bounded diff。后者直接从 durable review evidence 重建，保证 approve 与 promote 之间刷新或崩溃后仍能继续；`outputDir`、完整 proposal、反馈正文、Prompt、cwd 与消息正文均不跨浏览器边界。

## 回归门

最终 workspace 回归为 156 passed、3 skipped：`dsh-evolve` 125、`dsh-software-delivery` 26、`dsh-evolve-web` 5。文档链接、三包 typecheck、三包 build、Typert source digest、8 个 Remote 方法及其 wire 参数、纯 Node artifact 语法、peer 完整性和 `git diff --check` 同时通过。最终 tarball 重新执行无 overlay Bundle 安装/启动/Client Module 检查，再执行 Bundle 卸载、零 EvoForge 配置行、原生 Web 重启与插件 URL `404`。

## 未证明

本证据证明本机固定版本 DSH 的安装、启动、Client Module、RPC、持久 pause/resume 和浏览器交互，不证明陌生用户能无指导完成 approve/promote/rollback，也不证明生产多日稳定性、真实任务误晋升率或优于 Hermes。

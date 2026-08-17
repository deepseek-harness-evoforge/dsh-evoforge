# P0C.6 真实 DSH Web 控制面证据

- 日期：2026-08-17（v0.1 集成复验）
- DSH revision：`47f943859bef60e4160492346772ded9b24f765a`
- 状态：verified，真实本地 DSH/Web/浏览器验收通过；尚无陌生用户可用性数据

## 验收对象

`dsh-evolve-web` 是一个可删除的 profile Bundle。Bundle 只插入 `dsh-evolve` host runtime 与 `dsh-evolve-web` Client Module；高级 source、resident 与 auto-promotion 配置保持显式。Client Module 把生成式 Remote 挂到 DSH 原生 API Gateway，并在 root-scoped `sidebar.footer.action` 注册入口，因此无 Session 时仍可使用。

## 真实装配

测试从 workspace 构建两个 npm tarball，使用隔离的临时 `DSH_HOME` 在**同一次** `dsh plugin --profile web add` 中安装到真实 `web` profile；没有手写或传入额外 patch。Profile 自动把 `dsh-evolve-web` 记录为 Bundle，配置 dump 出现 exact 两行，再由固定 revision DSH Loader 启动 OS 分配端口。启动页的 `window.__DSH_BOOT__` 出现 `dsh-evolve-web`；DSH 自己的 `/plugins/dsh-evolve-web/client.js` 返回 `200`，纯 Node 语法检查通过，并含 8 个生成 Remote 方法。

真实装配首先发现 host bundle 残留标准 decorator token，导致 plain Node `SyntaxError`。构建改为先消费 TypeScript 发出的 JavaScript，再由 tsdown 打包，并增加 npm artifact `node --check` 门；后续全仓 source-mode 回归又要求运行类通过标准 decorator protocol 显式登记 metadata，独立静态契约只供固定 Typert generator 分析，因此源码和 npm artifact 都能被各自的真实 Loader 接受。第二次浏览器装配发现 slot inject 工厂未显式等待 `remote.evoforgeEvolution`，DSH 正确拒绝访问；实现改为 generated Remote mount 完成后通过嵌套 `ctx.inject` 注册全局 slot。最终 Bundle 验收还发现普通 dependency 会让 pnpm 在同批本地 tarball 之外错误访问 registry；Web artifact 已内联浏览器 Remote，因此 host 契约改为相邻 plugin peer，并由 Bundle patch 保证运行时装配。各项都先保留失败证据，再以测试和真实 DSH 重跑转绿。

卸载测试只执行 `dsh plugin --profile web remove dsh-evolve-web`：Profile 的 Bundle 列表和配置 dump 均不再含 EvoForge 行；随后原生 Web 重新启动，启动页不含 EvoForge Client Module，原插件 URL 返回 `404`。本地验证显式安装的 plain `dsh-evolve` tarball 仍可作为 inert dependency 留在 profile，但不再进入 composition；发布后的 registry 安装由 Web 包的 peer 自动解析 host 包。

## 浏览器验收

使用真实 DSH 页面完成以下操作。验收从重新打包的 `dsh-evolve`、`dsh-evolve-web` tarball 开始，
通过官方 `dsh plugin --profile web add` 安装到隔离 `DSH_HOME`。测试 patch 先禁用 Bundle 的普通
host row，再由一个**不发布**的 bootstrap fixture 调用 DSH `WorkspaceRegistry`、Agent preset 与
Session API 创建一个真实 Workspace/Agent/Session；fixture 随后从该 profile 的
`node_modules/dsh-evolve/dist/index.mjs` 动态加载已安装 artifact，把 Registry 返回的 exact
Workspace id 交给同一个 Cordis plugin。它不是产品入口，不进入 tarball，也不创建第二 Runtime。

这次 v0.1 复验同时暴露了旧浏览器 patch 仍把 `supervisor.runRoots` 写成 `string[]` 的历史漂移；
固定 DSH Loader fail loud。夹具已改成 Workspace-owned `{ workspaceId, path }`，并用合同测试锁定
“只加载已安装 artifact、fixture 不发布、Loader `name` 不接受表达式对象”三个事实。

零基础 Interface 复验又暴露了一个只存在于测试 overlay 的注册缺口：overlay 为了用动态取得的
Workspace id 装配 supervisor，会禁用普通 `dsh-evolve` Loader row；Typert Loader 因而无法自动发现
该包，Client Module 虽能加载，但 `overview` 被原生 Gateway 以 `404` 拒绝。测试 overlay 现在把
`dsh-evolve` 显式加入既有 `typert-loader.config.packages`；同一个 packed artifact、动态 bootstrap 与
Gateway 随即恢复，产品 Bundle 和运行时均未增加第二条注册路径。

1. 启动固定 revision 的真实 DSH Web Host，页面显示 `EvoForge Browser Acceptance` 原生 Workspace；
2. 打开由已安装 `dsh-evolve-web` Client Module 注册的侧栏入口，默认“概览”只显示当前无待办、
   纠正回答 → 后台验证 → 人工决定未来 Session 是否使用的三步说明，以及“无需额外命令/版本 ID”；
3. 切换独立 `Skills` 视图，空 Workspace 明确显示尚无进化 Skill，并声明原生 DSH Skill 目录仍归
   DSH 管理；单元验收另覆盖使用中、已验证待启用、等待审核三类 host projection；
4. 切换“高级”后读取 `原生 DSH / 运行中 / 0 待审查 / 自动晋升关闭`，原控制能力完整保留；
5. 点击暂停，UI 显示“已暂停”和“动作已持久完成，权威状态已刷新”；
6. 关闭并重启同一个隔离 DSH Host，重新打开面板后仍为“已暂停”；
7. 点击恢复和刷新，权威状态回到“运行中”；
8. 停止 Host 后点击刷新，面板原位保留最后状态并显示可见 alert：
   `演化动作失败：... Failed to fetch`，没有假成功；
9. 重启 Host 后再次刷新，错误消失并恢复“运行中”；此次零基础/Skills/高级视图复验的浏览器
   console error 为 `0`。

验收没有发送用户消息、没有调用模型、没有读取 API key，也没有触碰真实用户 profile。最终状态恢复为运行中。

## KV Cache 与边界

Web Adapter 不注册 Tool、Prompt、Skill、System Message 或 Session Event，UI state 不写入 Session。Remote 只在打开、刷新和动作后读取，普通 Agent 请求的消息前缀与 Tool Schema 不变，因此模型 Token 增量为 `0`。一次 overview 最多返回 20 条可处理审查和 20 条已批准未激活 Generation；审查详情最多返回一个 bounded diff。后者直接从 durable review evidence 重建，保证 approve 与 promote 之间刷新或崩溃后仍能继续；`outputDir`、完整 proposal、反馈正文、Prompt、cwd 与消息正文均不跨浏览器边界。

## 回归门

历史 P0C.6 回归为 156 passed、3 skipped：`dsh-evolve` 125、`dsh-software-delivery` 26、`dsh-evolve-web` 5。v0.1 复验在十一包 clean-profile gate 与完整 composition Cache Contract gate 已通过后执行，并把真实 Workspace 浏览器夹具合同加入 `dsh-evolve-web`。提交前再次运行全仓 `pnpm check`；最终结果以当前提交记录为准。

## 未证明

本证据证明本机固定版本 DSH 的安装、启动、Client Module、RPC、持久 pause/resume 和浏览器交互；
零基础首屏是确定性验收，不等同于真实陌生用户研究。它仍不证明陌生用户能无指导完成
approve/promote/rollback，也不证明生产多日稳定性、真实任务误晋升率或优于 Hermes。

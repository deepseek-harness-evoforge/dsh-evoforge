# V5.8：真实飞书 exact-route 验收入口

> 日期：2026-08-24；固定 DSH revision：`47f943859bef60e4160492346772ded9b24f765a`；
> 状态：验收入口 `implemented`；真实平台 `NOT_RUN`

## 用户结果

维护者现在有一条不能用 fake transport 冒充通过的真实飞书验收命令。显式授权后，它从当前 clean `main`
打包最终 `dsh-gateway`/`dsh-feishu` tarball，通过官方 DSH CLI 安装到隔离 `web` profile，检查 effective
config，再以生产 Cordis 插件和官方飞书 SDK 完成 exact 用户消息、原生 Session 回复、`/feishu` Command、
DSH Approval 卡片、持久 notice、dispose、官方卸载、原生 Host 重启和 Session readback。

本机没有真实飞书 App 凭据、chat/user 身份和人工卡片操作条件，因此本增量没有连接飞书或发送消息；真实结果
严格保持 `NOT_RUN`，不能写成已通过。

## 接缝与不可伪造门

- 入口位于阶段 benchmark，不是产品 CLI、插件、Runtime、Session、Goal 或审批替代面；
- 未提供精确批准短语时只读取批准变量，不读取 App/chat/user/Secret，也不加载执行模块；
- 授权后缺参或身份/路径非法会 fail closed；公开报告只保留 App/route 哈希；
- EvoForge 与 DSH worktree 必须 clean，DSH 必须是 manifest 固定 revision；
- 只安装当前源码打出的最终 tarball，真实渠道使用生产飞书 transport；keyless LLM fixture 只隔离模型成本；
- 首个外部效果前原子落盘私有状态；崩溃后的同一 run 不自动重放；
- challenge 必须只进入 Session 一次；Gateway `uncertain`/`failed`、非 `allowed-once` Approval、卸载或
  Session readback 失败均阻断 `passed`；
- 私聊与群聊是两个独立 epoch；生产 Adapter 从被准入的真实入站事件记录 `direct`/`group`，声明与观测不一致
  立即失败，不能用私聊冒充群聊或复用另一 route 的 terminal 结果。

## TDD 与本地验证

按 red→green 顺序先观察到：合同模块缺失 `ERR_MODULE_NOT_FOUND`、缺配置仍返回旧占位结果、合法 exact route
仍返回 `not-run`、runner 缺失导致 exit 1；最终审查又先观察到 assembled Host route 缺少真实 chat-kind
观测（`observedChatKind is not a function`），再补生产只读事实与 AS-2 gate。实现后：

- `pnpm benchmark:feishu:as2:typecheck`：通过；
- `pnpm benchmark:feishu:as2:test`：7/7 通过，覆盖未授权零敏感读取、缺参、非法身份/路径、哈希预检、
  timeout、exit 2 `NOT_RUN` 和失败脱敏；
- assembled Feishu chat test：1/1 通过，证明未入站时没有猜测值，exact group 入站后记录平台观测 `group`；
- `pnpm benchmark:feishu:as2`（无授权/凭据）：exit 2，唯一 JSON 报告为 `not-run`；没有加载执行模块；
- 根级 `pnpm check`：通过；文档、RP-1 8/8、AS-2 7/7、11 包 typecheck、544 passed/3 skipped
  workspace tests 和 11 包 build 全部通过。该结果不用于声称真实平台通过。

## 尚未证明

本增量没有真实 App 凭据与人工参与，因而没有证明飞书 WebSocket 建连、真实入站/回复/Command/Approval、群聊
`@` 语义、断线重连、内容资源权限、长期运行或 Hermes paired 胜出。直接私聊和群聊必须各自取得 exit 0 的
`passed` 报告；在此之前不创建 tag、不发布 v0.1、不宣称真实飞书闭环完成。

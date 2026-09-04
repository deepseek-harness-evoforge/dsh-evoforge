# ADR-0103：渠道 Adapter 只通过 DSH 原生凭据引用读取秘密

## 状态

Accepted（2026-09-04）。本文保留当日凭据决策；其中 DSH revision 仅是历史依据，当前 API/支持基线以 [最新审计](../research/dsh-latest-audit-2026-09-05.zh.md) 为准。实现仍需真实渠道验收。

## 背景

飞书和 Telegram 都需要 App Secret/Bot token，但直接读取 `process.env` 会绕过 DSH 的凭据来源、Web
设置、权限审计和热更新语义，也会让常驻 Host 的 profile 依赖启动 shell。DSH 当前公开支持基线为
`0.1.2-alpha.5`，其 `@deepseek-ai/dsh-credentials` 定义了 `ctx.credentials.resolve(credentialRef(name))`；
`@deepseek-ai/dsh-credentials-local` 由官方 base Bundle 挂载 `$DSH_HOME/.credentials.yaml`，并保持值不进入
配置文件和 Web 投影。

## 决策

1. `dsh-evoforge-feishu` 在 Bundle `apply` 中注入 `credentials`，使用 `credentialRef` 解析 App ID 与
   App Secret；`dsh-evoforge-telegram` 以同样方式解析 Bot token。
2. 解析结果只在启动官方平台 SDK/HTTP 客户端的进程内存中使用；任何健康、Remote、日志、Session event、
   Candidate 或 UI 都不得返回 secret 或 source value。
3. 现有 `appIdEnv`、`appSecretEnv`、`tokenEnv` 字段暂时保留，以免破坏已安装 profile；其语义改为 DSH
   credential reference，默认名称不变。下一次破坏性配置版本再改成 `*Ref`，不得在当前 alpha 中同时维护两套
   secret 读取路径。
4. 未挂载凭据服务、引用不存在、空值、控制字符或不合法引用名时 fail closed；不回退到 Adapter 自己读取
   `process.env`。代理环境变量仍只属于非秘密网络部署配置。
5. 凭据轮换对后续连接/Bundle reload 生效；当前 SDK 连接若要重新建立，按 DSH/Cordis lifecycle reload，
   不在 Adapter 中新建凭据 watcher、重启器或第二套状态库。

## 取舍与边界

- 采用 DSH 官方 CredentialProvider 而非自建 secret store，保持 DSH Web `remote.credentials` 和原生 base
  的单一权威；用户可在 DSH Web 模型/凭据设置中写值，也可使用官方 local provider 文档格式。
- 不把 secret 作为 Bundle config，因为配置会出现在 profile dump；不把值放进 Client Module，因为浏览器
  只接收脱敏状态。
- 这项决策不代表真实飞书/Telegram 账号已经通过 AS-2/AS-1；真实权限、重连、配对、外部效果和长期运行仍需
  独立证据。

## 依据

- 历史依据：DSH canonical `origin/master` `76fda729799fe9b3848dbe2c211d4b231032b81e`（2026-09-04）；支持测试 checkout：`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。当前 revision 不在本 ADR 中重复维护。
- DSH 官方 `packages/credentials/credentials/src/index.ts`、`packages/credentials/credentials-local/src/index.ts`、
  `packages/api/settings-controller/src/credentials.ts`。
- 本仓库 `packages/dsh-feishu/src/config.ts`、`packages/dsh-telegram/src/config.ts` 与对应 assembled/package
  boundary 测试。

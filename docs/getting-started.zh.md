# 安装、配置与卸载

EvoForge 只加载进现有 DSH Host，不启动第二个 Agent Runtime、Web 服务或 Gateway。当前仍是 pre-alpha，尚无
registry 包；本页描述可复现的仓库安装方式。

## 1. 准备

- Node.js 22、pnpm 11；
- 可运行的 DSH CLI；
- 一个可写的 DSH profile，默认名为 `web`；
- 使用渠道时，准备平台应用和最小权限。

每次开发和发布验证前都要审计 DSH 最新 revision。当前 canonical latest 与可构建支持基线并不相同，准确结论见
[当前状态](status.zh.md)，不要根据旧 evidence 猜版本。

## 2. 一行安装完整产品

在仓库根目录运行：

```sh
pnpm install --frozen-lockfile && pnpm run dsh:install
```

默认安装 `product`：Evolution、Doctor、Control Center、Gateway、Feishu 和 Telegram。指定其他 profile：

```sh
pnpm run dsh:install -- --profile personal
```

可选附加能力：

```sh
pnpm run dsh:install -- --suite delivery --profile web
pnpm run dsh:install -- --suite continuity --profile admin
```

安装器在新 staging 中打包，读取 `evoforge-suite.json`，校验 exact 文件与 SHA-256，再把整组产物按内容地址
原子保存到用户持久数据目录；DSH 安装的永远是该目录中的绝对路径。Bundle 已预构建，因此安装显式禁用依赖
install script，不替用户授予第三方构建权限。成功只清 staging，失败保留可恢复产物。两次 DSH 配置核对均在
进程内完成，完整 effective config 不会打印到 Agent/终端日志。

安装命令会修改目标 profile。人在 shell 中直接运行时，这不是 DSH Agent Approval；由 Agent 通过 DSH Shell
运行时，原生 Tool policy/Approval 仍然生效。安装插件不会写 OS service，只有随后显式执行
`/resident apply <hash>` 才会创建服务。

## 3. 启动一个 Host 和一个页面

```sh
dsh --profile web --no-open
```

只打开启动日志给出的完整 URL，并保留 `?token=...`。裸端口返回 401。以后刷新现有标签页，不要因为安装了
Gateway、Evolution 或渠道再启动 Host。Control Center 是 Session-scoped；先创建或打开原生 Session，空白
onboarding 页面可能不会渲染该 slot。

## 4. 飞书

完整产品已经安装飞书 Adapter，但它默认关闭。先在该 profile 的官方 patch 中增加或覆盖：

```yaml
- id: evoforge-feishu
  name: dsh-evoforge-feishu
  disabled: false
  config:
    mode: pairing
    routeIds: []
    appIdEnv: DSH_FEISHU_APP_ID
    appSecretEnv: DSH_FEISHU_APP_SECRET
```

`appIdEnv` 和 `appSecretEnv` 是历史命名保留的 **CredentialProvider 引用名**，不是让用户导出环境变量。启动
Host 后，在同一 Control Center 的 Feishu 凭据表单保存 App ID/Secret；值只进入 DSH CredentialProvider，不能
写进 YAML、Git、日志或 Session。

飞书开发者后台至少需要机器人、长连接事件 `im.message.receive_v1` 和发送消息权限，并发布当前应用版本。随后：

1. 陌生用户发送第一条私聊；Gateway 返回一次性配对码，消息不进入 Agent。
2. 管理员在同一页面的 **Channels** 中选择已有 Workspace/Session 并批准。
3. 用户发送下一条消息；它进入绑定的原生 Session。

pairing 不需要用户手工提供 `chat_id` 或 `open_id`。过期码、重放、没有可用 Session、身份不匹配或不确定发送
结果都会停在可诊断状态，不会盲目重试。

群聊、图片、文件、知识库、云盘和多维表格必须在 exact route 上逐项开启 `contentPermissions`，并服从 DSH
Attachment/Tool/Approval 契约。当前 DSH 不支持的内容类型会明确拒绝，不伪装成图片或静默丢失。

## 5. Telegram

Telegram Adapter 同样默认关闭。最小 pairing patch：

```yaml
- id: evoforge-telegram
  name: dsh-evoforge-telegram
  disabled: false
  config:
    mode: pairing
    accountId: telegram-bot-prod
    tokenEnv: DSH_TELEGRAM_BOT_TOKEN
    routeIds: []
```

`tokenEnv` 也是 CredentialProvider 引用名。保存 Bot token 后，陌生私聊使用与飞书相同的“首条配对、页面批准、
下一条进入 Session”流程。静态生产路由必须精确绑定 account、conversation/user、Workspace、Session、Agent、
provider 和 model，不接受 wildcard。

## 6. 日常使用与进化

像普通 DSH 一样对话、发材料和纠正回答即可；没有单独的“进化模式”。EvoForge 在旁路记录可归因事件，候选
只在独立评测后才可能用于未来 Session。一次失败、retry 或模型自评不构成学习；缺少证据时状态必须是
`abstain`、`review`、`quarantine` 或 `uncertain`。

统一页面展示已安装模块的 Host 状态、渠道连接与配对、Gap、Candidate 谱系/diff、评测和治理动作。未安装的
能力显示空态；读取失败保留 last-good 并标记 stale/error。当前真实 Provider 慢环仍未完成，状态页会明确写
`partial`，不会用本地夹具冒充产品完成。

## 7. 更新与卸载

本地升级重新运行同一个安装命令，会产生新的内容地址并交给 DSH 协调。不要删除安装器打印的持久数据目录；
DSH 的 profile/lockfile 可能继续引用其中的 tarball。

成功输出会给出 `Verified manifest` 路径。打开该 manifest，复制 `dshRemove`，把 `<profile>` 换成实际 profile 后
执行。然后重新启动一个 Host，确认 EvoForge 表面消失且原生 Session/Goal/Workspace 仍可读。卸载不会撤回
消息、提交或其他外部效果。

若安装过 `continuity` 并实际执行了 `/resident apply`，必须先运行 `/resident status`，再用
`/resident remove <service-id>` 删除 OS service；仅卸载 Bundle 不会伪装成已撤销系统服务。

## 8. 排障

1. 在原生 Session 运行 `/doctor`，先看 Loader、Bundle 和 Gateway 状态。
2. Web 401 时重新使用启动日志中的完整认证 URL。
3. 渠道停在 waiting 时，检查 Adapter 是否启用、CredentialProvider 引用是否存在、平台事件订阅是否已发布。
4. `unknown`/`uncertain` 时先核对 Gateway journal，不要重复发送。
5. Issue 只附脱敏的 revision、命令和状态；不要附完整 `--dump-config`、Secret、token、真实消息或私有样本。

套件边界见[能力套件](capability-suites.zh.md)。贡献者的真实渠道、Provider 与 Hermes 验收命令只在
[发布门](releasing.zh.md)和[benchmarks 说明](../benchmarks/README.md)中维护，不属于用户流程。

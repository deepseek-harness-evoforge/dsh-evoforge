# DeepSeek Harness EvoForge

EvoForge 是一组安装到 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 的原生插件。
它为 DSH 增加常驻渠道、自我进化证据链、软件交付和统一 Web 控制面，同时继续使用 DSH 自己的 Agent、Session、
Goal、Skill、Tool、Approval、Jobs、Workspace 和存储。

EvoForge 不是独立 Agent、Codex 插件、第二个运行时或插件市场。DSH 仍是唯一的运行时和状态权威。

## 当前状态

项目处于 pre-alpha。源码、测试和本地 Bundle 安装路径可供开发者试用，但尚未发布到 npm，也不能宣称已经完成
Hermes 上位替代。真实渠道、真实模型 Provider、长期运行和 Hermes 同条件对照仍在验收中；生产使用前请先阅读
[当前限制](docs/status.zh.md)。

## 能力套件

用户按需要选择结果，不必逐个管理内部 Bundle：

| 套件 | 提供的结果 |
| --- | --- |
| `core` | 自我进化证据链、运行诊断和 DSH Web 控制面 |
| `channels` | 常驻 Gateway、飞书/Telegram Adapter、配对、路由、持久投递和同一个 Web 控制面 |
| `delivery` | 隔离的软件交付、验证、Draft PR 和 GitHub review 跟进 |
| `continuity` | Goal 冷恢复和用户级 DSH profile 常驻 |

`attention` 是可选的渠道提醒层；`full` 只用于维护者验收。套件是安装编排，不是第二个 Runtime 或市场。
需要精确边界时参阅[能力套件说明](docs/capability-suites.zh.md)。

## 安装

当前安装来源是本仓库生成的本地 tarball。请准备 Node.js 22、pnpm 11 和一份与项目支持矩阵匹配的 DSH，
然后在仓库根目录执行：

```sh
pnpm install --frozen-lockfile
PACK_ROOT="$(mktemp -d)"
pnpm run pack:suite -- --suite core --out "$PACK_ROOT"
dsh plugin --profile web add "$PACK_ROOT/core"/*.tgz
dsh --profile web --dump-config
dsh --profile web
```

按需安装渠道或交付：

```sh
pnpm run pack:suite -- --suite channels --channel feishu --out "$PACK_ROOT"
dsh plugin --profile web add "$PACK_ROOT/channels-feishu"/*.tgz

pnpm run pack:suite -- --suite delivery --out "$PACK_ROOT"
dsh plugin --profile web add "$PACK_ROOT/delivery"/*.tgz
```

启动、停止、配置重载和卸载都由 DSH 官方命令负责。EvoForge 不要求启动额外网页、daemon 或产品 CLI。

## 飞书配置与配对

安装 `channels` 后，为 DSH profile 配置飞书 App 的环境变量：

```sh
export DSH_FEISHU_APP_ID='cli_...'
export DSH_FEISHU_APP_SECRET='...'
```

飞书 App 需要启用机器人、长连接事件 `im.message.receive_v1`、发送消息和卡片回调，并把机器人加入测试账号
的私聊。启动 DSH 后，陌生用户在飞书给机器人发送任意私聊：

1. 常驻 Gateway 收到首条消息并返回一次性配对码；首条消息不会进入 Agent。
2. 管理员在同一个 DSH Web 控制面“渠道”页批准待处理请求；也可以使用 Host 侧 request-id 命令。
3. 用户发送下一条消息，才会进入绑定的原生 DSH Session。

不需要在 DSH Session 中执行配对命令，不需要临时 listener，也不需要打开第二个网页。配对、撤销、权限和故障
排查见 [`dsh-gateway`](packages/dsh-gateway/README.md) 与 [`dsh-feishu`](packages/dsh-feishu/README.md)。

## 自我进化

入口只接收自然语言 Goal、材料、约束、权限和验收标准。系统从 DSH 已安装能力以及真实 Goal 的成功、失败、
纠正、返工、成本、时延和外部结果中识别可复核的能力缺口，并在隔离环境中生成和评测完整 Skill Candidate。

Candidate 会经过 baseline/holdout/Retention、安全、权限、成本、时延和 cache 门禁；执行面、Candidate 面和治理
评测面隔离。证据不足时系统会 `abstain` 或 `quarantine`，当前 Session 固定版本，晋升只影响未来 Session，
并支持 canary、崩溃恢复和精确回滚。

这不是运行时从外部市场搜索、下载或导入 Skill 的功能，也不是模型自评。代码、凭据和外部副作用始终需要受保护
动作授权。

## Web 控制面

`core` 与 `channels` 使用同一个原生 DSH 页面，不会为每个插件打开独立网页。控制面可以查看：

- Gateway、飞书和 Telegram 的连接、配对、投递和错误状态；
- 能力图、缺口、Candidate 版本、谱系、diff、baseline/holdout 和失败归因；
- 成本、时延、cache、安全权限，以及晋升、隔离、暂停、恢复和回滚操作。

控制面不调用模型，也不复制 Session 或状态库。插件通过 DSH 原生 surface 接入同一页面。

## 卸载

卸载由 DSH 官方命令完成。要移除完整套件，可执行：

```sh
dsh plugin --profile web remove \
  dsh-evolve dsh-evolve-web dsh-control-center dsh-doctor \
  dsh-gateway dsh-feishu dsh-telegram dsh-evolve-attention \
  dsh-software-delivery dsh-github-review dsh-goal-continuity dsh-resident
dsh --profile web --dump-config
```

卸载不会删除 DSH 原生 Session、Goal 或 Workspace 数据；已经发生的外部发送、提交或其他副作用也不会被撤销。

## 已知限制

- 尚未发布 registry 包；上述包名是当前本地 Bundle 的安装标识，不能当作 npm 稳定依赖。
- 真实 Feishu 的完整配对、Schedule、Approval、重启新增消息、撤销重配和长期重连仍在验收。
- 真实 Provider、同条件 Hermes paired benchmark、长期误晋升/遗忘/负迁移数据尚未全部通过。
- DSH 当前附件契约只支持已验证的原生图片路径；普通文件、音频和视频不由 Gateway 私自伪造支持。
- Telegram 外部 Bot、生产权限和多日运行也需要单独验证。

安装或运行异常时，先运行 DSH 原生 `/doctor`，再查看[当前状态](docs/status.zh.md)和对应插件 README。
请不要在 Issue 或日志中提交 App Secret、访问令牌或真实消息内容。

## 参与开发

请先阅读[开发与发布纪律](docs/releasing.zh.md)、[插件契约](docs/plugin-contract.zh.md)和[能力套件边界](docs/capability-suites.zh.md)。
提交 Pull Request 时附上 DSH revision、复现命令、测试结果和脱敏证据。所有变更在 `main` 上以小提交推进，
发布前必须通过真实安装、浏览器、渠道、Provider 和 Hermes 对照门禁。

许可证：MIT。

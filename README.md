# DeepSeek Harness EvoForge

EvoForge 是一组可安装进 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 的原生
Cordis/Bundle/Client 插件。它给现有 DSH 增加常驻消息 Gateway、飞书与 Telegram Adapter、可验证的 Skill
进化、软件交付和一个统一 Web 控制面。

它不是 Codex 插件，也不替换或 fork DSH。Agent、Session、Goal、Skill、Tool、Approval、Jobs、Workspace、
权限和存储仍由 DSH 管理。

## 当前能力

- **常驻 Gateway**：在 DSH Host 内处理配对、路由、幂等投递、限流、断线恢复和不确定外部结果。
- **飞书与 Telegram**：平台连接是可独立禁用、卸载的 Adapter；陌生私聊先返回配对码，批准后的下一条消息
  才进入已有 DSH Session。
- **可验证进化**：从真实会话中的纠正、失败、验证和结果形成证据；Candidate 与当前 Skill 隔离，独立评测后
  才能影响未来 Session，并支持 quarantine、canary 和精确回滚。
- **统一控制面**：Gateway、Channels、Evolution、Doctor 和其他已安装模块使用同一个 DSH Web 页面，不启动
  插件自己的站点。
- **软件交付与连续运行**：按需增加隔离交付、Draft PR、原生 Goal 冷恢复和用户级常驻服务。

项目仍是 **pre-alpha**：本地合同和部分 assembled 路径已通过，但 registry、真实渠道长期运行、真实 Provider
进化和完整 Hermes paired benchmark 尚未过门，当前不能宣称整体上位替代。准确进度见[当前状态](docs/status.zh.md)。

## 安装

需要 Node.js 22、pnpm 11、可运行的 DSH CLI 和可写 profile。当前尚未发布 registry 包，请在仓库根目录运行：

```sh
pnpm install --frozen-lockfile && pnpm run dsh:install
```

默认 `product` 套件一次安装 Evolution、Doctor、Control Center、Gateway、Feishu 和 Telegram。Gateway 会加载，
两个平台 Adapter 在配置凭据和路由前保持关闭。安装器根据 manifest 校验 exact tarball，并把 DSH 持续依赖的包
保存在用户持久数据目录中；不会用目录 glob，也不会打印完整 profile 配置。所有 Bundle 均为预构建产物，安装时
不会替用户批准或运行依赖包的安装脚本。

这条 shell 命令会修改当前 DSH profile，本身不等于一次 DSH Agent Approval。若由 DSH Agent 调用 Shell，仍由
该 Agent 的 Tool policy/Approval 决定是否执行；`/resident apply` 等额外系统动作另行确认。

给 Agent 的一行请求：

> 请在当前 dsh-evoforge 仓库核对最新 DSH 与正在使用的 profile，运行 `pnpm install --frozen-lockfile && pnpm run dsh:install` 安装默认完整产品；不得输出凭据或完整配置，沿用现有唯一 Host/Web，完成后验证 Bundle 可见和 Host 可启动，失败时保留可恢复安装包并报告准确阻断。

当前没有公开 registry，因此 Agent 也必须执行仓库安装器，不能猜测短包名。高级套件和自定义 profile 见
[安装指南](docs/getting-started.zh.md)。

## 启动与首次使用

只启动一个 DSH Host：

```sh
dsh --profile web --no-open
```

打开日志打印的完整 Web URL，必须保留 `?token=...`；裸端口会返回 401。以后刷新同一个标签页，不要为插件、
渠道或刷新再启动 Host。先打开或创建一个原生 Session，统一控制面才会出现在该会话页面中。

平常直接聊天、发材料或纠正结果即可，不需要先启动“进化流程”或创建 Goal。Goal 只在用户确实需要 DSH 的
长任务续接时使用。进化发生在旁路：一次失败、一次重试或模型自评不会自动修改 Skill，当前 Session 也不会
在运行中漂移。

## 飞书配对

安装后在 DSH profile 中显式启用 `evoforge-feishu` 的 pairing 配置，并通过 DSH CredentialProvider 保存 App ID
和 App Secret；不要把明文写入 YAML、环境日志或仓库。然后：

1. 用户向机器人发送任意私聊，Gateway 返回一次性配对码，首条消息不进入 Agent。
2. 管理员在同一 DSH Web 的 **Channels** 页面选择已有 Workspace/Session 并批准。
3. 用户发送下一条消息，它才进入绑定的原生 Session。

所需 profile 片段、平台权限、Telegram 和故障恢复见[安装指南](docs/getting-started.zh.md)。

## 更新与卸载

本地升级重新运行同一安装命令。卸载必须使用持久安装 manifest 中的包名和 DSH 官方 `plugin remove`；卸载
EvoForge 不会删除原生 Session/Goal/Workspace，也不会撤回已经发送的消息或其他外部效果。`dsh-resident`
创建的 OS service 必须先用 `/resident remove` 显式移除。

## 支持与文档

遇到问题先在 DSH Session 中运行 `/doctor`。不要在 Issue 中粘贴完整 `--dump-config`、Secret、token、真实消息
或私有评测样本。

- [安装、配置与卸载](docs/getting-started.zh.md)
- [能力套件](docs/capability-suites.zh.md)
- [产品设计](docs/architecture/product-target-and-design.zh.md)
- [自我进化设计](docs/architecture/evolution-design.zh.md)
- [当前状态与阻断](docs/status.zh.md)
- [贡献指南](CONTRIBUTING.md)

许可证：MIT。

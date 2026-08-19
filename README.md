# DeepSeek Harness EvoForge

**EvoForge 是安装进 DeepSeek Harness 的原生 out-of-tree 插件套件，不是独立 Harness、Runtime、CLI、Web 服务或 daemon。** DSH 始终是唯一 Agent Host，以及 Session、Goal、Approval、Storage、Jobs、Skill、Tool、Workspace 和 Cordis 生命周期权威。

当前兼容性证据固定在 DeepSeek Harness `47f943859bef60e4160492346772ded9b24f765a`（`0.1.0-rc.5`）。项目仍为 pre-alpha，尚未发布 registry release；当前真实安装路径是本地 tarball 加 DSH 官方 profile 命令。

## 当前套件

| 包 | DSH 内能力 | 默认状态 |
|---|---|---|
| `dsh-evolve` | `/evolve`、Storage/Jobs/Session 上的证据驱动进化与 Skill Generation | enabled |
| `dsh-evolve-web` | DSH Web Client Module；只投影 `dsh-evolve` 的 Host 权威状态 | enabled |
| `dsh-software-delivery` | 原生 `software-delivery` Skill 与 `complete_delivery` Tool | enabled |
| `dsh-doctor` | 原生 `/doctor` Loader readiness | enabled |
| `dsh-github-review` | Draft PR exact-head 人类返修回到原 Session/Goal | disabled，需显式配置 |
| `dsh-telegram` | 一个授权私聊经 Gateway 到原生 Workspace/Session/Agent 的 Adapter | disabled，需显式配置 |
| `dsh-evolve-attention` | 把 Workspace-scoped 进化待决事项投影到既有 Telegram/飞书 route | disabled，需显式配置 |
| `dsh-goal-continuity` | exact allowlist Session 的原生 Goal cold-resume policy | disabled，需显式配置 |
| `dsh-resident` | `/resident` 管理 exact DSH profile 的 launchd/systemd user unit | disabled，需显式配置与逐次确认 |
| `dsh-gateway` | external endpoint 到原生 Workspace/Session/Agent 的静态、幂等绑定；同包提供统一只读渠道健康视图 | disabled，需显式配置 |
| `dsh-feishu` | 一个飞书 App 的 exact 私聊/群聊经 Gateway 进入原生 Workspace/Session/Agent；同包提供 DSH Web 首次连接向导 | disabled，需显式配置 |

当前活动进化纵切只保留 DSH 内部经验路径：Goal-linked Gap、跨 Goal Skill Opportunity、隔离 Candidate、独立评测、内容寻址 Generation、future-session pin 与精确回滚。公开配置与活动源码均已删除 Git repository/source、预选 Skill、静态 Case Pack/Feedback/Evaluator target、Feedback/Evaluator Draft、Shadow 内临时 proposer、自动 review expiry 和旧 Retention/canary 编排；Shadow 现在只消费治理完成的 exact、内容寻址、DSH-assembled Candidate，且自身模型调用为零。旧静态纵切不能作为产品能力重新开启。明确纠正只从 feedback 目标回答的唯一 durable Skill invocation、模型当时看到的 invocation-content hash 与 exact Goal id/revision 归因；同一 Skill 内容版本跨至少两个 Goal 的纠正只形成 investigation，完整 baseline Bundle 尚未封存，因此不会生成 Candidate。用户不选路径、Agent、workflow、Skill 或来源；产品不建设运行时外部 Skill 搜索、获取、下载、导入或市场。该纵切仍只标记为 `implemented`，因为 existing-Skill 完整 Bundle baseline/Candidate、按内部证据重建的 Retention/canary/回滚归因、独立真实 provider 评估、陌生用户、长期误晋升率和生产多日证据尚未完成。

## 安装到一个 DSH profile

先生成发布形态 tarball；这只是开发/验收步骤，不会启动第二个 Runtime：

```sh
pnpm install --frozen-lockfile
PACK_DIR="$(mktemp -d)"
for package in \
  dsh-evolve dsh-evolve-web dsh-software-delivery dsh-doctor \
  dsh-github-review dsh-telegram dsh-evolve-attention dsh-goal-continuity \
  dsh-resident dsh-gateway dsh-feishu
do
  pnpm --filter "$package" pack --pack-destination "$PACK_DIR"
done
```

使用 DSH 官方插件命令安装并检查同一个 Host：

```sh
dsh plugin --profile web add "$PACK_DIR"/*.tgz
dsh --profile web --dump-config
dsh --profile web
```

默认关闭的包只有在部署者通过 profile patch 提供 exact 身份、路由、凭据引用或 Session allowlist 后才能启用。模型不能选择 token、外部身份、Workspace、目标 Agent 或扩大权限。

## 在 DSH 内使用

- `/doctor` 查看当前组合 readiness；
- `/evolve status` 或 DSH Web 侧栏查看和处理进化状态；
- 在原生 Goal 中按需加载 `software-delivery` Skill，由 `complete_delivery` 通过 DSH Bash/Sandbox/Approval 验证并调用原生 `update_goal`；
- `/resident plan|status|apply <plan-sha256>|remove <service-id>` 通过 DSH Command 审查和管理 OS user unit；
- Telegram 与飞书经 DSH Gateway 只使用原生 Workspace、Agent、Session 与 Commands；飞书首次连接也只在原生 DSH Web 内调用 Session Command；GitHub review、Goal continuity 和进化注意力同样不创建第二套权威。

没有 `dsh-evolve`、`dsh-delivery` 或 `dsh-resident` 用户产品 CLI。测试驱动器不是打包入口。

## 卸载

```sh
dsh plugin --profile web remove \
  dsh-evolve-web dsh-evolve dsh-software-delivery dsh-doctor \
  dsh-github-review dsh-evolve-attention dsh-telegram dsh-goal-continuity \
  dsh-resident dsh-feishu dsh-gateway
dsh --profile web --dump-config
dsh --profile web
```

卸载只移除 EvoForge 注册与生命周期资源；原生 DSH Session、Goal 和 Workspace 数据仍由 DSH 读取，已经发生的外部效果不能由卸载撤回。

## 当前 v0.1 工作

`dsh-gateway` 已直接替换旧 Router 包且没有兼容转发层；Gateway、Telegram、飞书、Evolve Attention、全仓类型/构建和十一包 clean-profile add/dump/boot/remove/readback 均已回归通过。静态 exact endpoint、原生 Workspace/Session/Agent、Command、持久 ingress 与双 Workspace 双渠道隔离保持；Gateway 现已统一 Telegram/飞书普通文本的持久 outbound intent、幂等、按 account 串行、明确 429 有界重试、uncertain 恢复、脱敏 transport observation，并由同包 DSH Client Module 提供只读渠道健康视图。最终 tarball 的真实 DSH 浏览器已验证读取、刷新、Host 停机清除旧快照和同端口恢复。飞书 exact 消息闭环、内部 Candidate 独立评测、真实 provider、同模型编码/长任务和真实消息交付 Hermes paired epochs 仍是完成门禁；这些完成前不得发布或宣称整体上位。

- [安装与验收](docs/getting-started.zh.md)
- [当前状态](docs/status.zh.md)
- [产品形态审计](docs/native-plugin-shape-audit.zh.md)
- [插件合同](docs/plugin-contract.zh.md)
- [需求基线](docs/requirements.zh.md)
- [目标重新对齐审计](docs/audits/2026-08-19-goal-realignment.zh.md)
- [ADR-0041](docs/adr/0041-dsh-is-the-only-runtime-and-install-surface.md)
- [ADR-0045](docs/adr/0045-feishu-pairing-ui-reuses-session-commands.md)
- [ADR-0049](docs/adr/0049-channel-adapters-share-one-thin-dsh-gateway.md)
- [ADR-0050](docs/adr/0050-internal-candidates-replace-runtime-skill-acquisition.md)
- [ADR-0060](docs/adr/0060-gateway-web-is-a-read-only-host-projection.md)
- [ADR-0067](docs/adr/0067-generations-resolve-only-internal-content-addressed-bundles.md)
- [ADR-0068](docs/adr/0068-shadow-consumes-one-exact-internal-candidate.md)

License: MIT.

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

当前活动进化纵切只使用 DSH 内部经验：Goal-linked Gap 与跨 Goal Skill Opportunity 经生成前证据密封后，产生隔离、内容寻址的 whole-Skill Candidate；用户不选路径、Agent、workflow、Skill 或来源，产品不建设运行时外部 Skill 搜索、获取、下载、导入或市场。missing-Skill 路径已有 Candidate-independent admission/holdout/可选 Retention、exact Shadow/Retention、future-Session Promotion、failed-Outcome Canary 和人工精确回滚，所有评测结果本身均无 pointer 或发布权。

existing-Skill 路径会封存调用时完整 Bundle，并把当前纠正文与 durable Goal/请求预分为 authoring/admission/holdout/可选 Retention。V4.40 的 Candidate 不可见治理面在 proposer 前用两次独立调用分别消费 protected Holdout 与可选第五 Goal Retention，每次只见 exact baseline 和自己的一个 protected Goal；两套 assembled `skill-tree` Case Pack 经独立 calibration 后共同进入内容寻址 Evaluation Envelope，Candidate id 绑定整个 Envelope。受保护作者只允许改 `SKILL.md`/`references/*.md`，Host 原样继承二进制和其余文件并拒绝权限漂移；结构准入再重验 exact baseline/Candidate 双树、声明 diff 与 protected admission identity。V4.39 的原生 DSH Job 执行完整 paired Holdout；V4.41 只在该 exact Holdout 权威判为 `improved` 后由另一原生 DSH Job 执行预密封 Retention，四 Goal无样本时零花费 abstain，五 Goal按 `fail/pass` 四象限持久判为 `retained/ambiguous/not-retained/regressed`。两者都要求 calibration、assembled、composition 与输入完整性全部成立，中断不盲重试且无晋升权。V4.43 再由独立 Host mutation gate 重验 exact Admission/Holdout/Retention 与完整 sealed Bundle；只有人工 approve 才产生 inactive Generation，另一动作才选择未来 Session，reject 持久终止且 evaluator 始终无发布权。

V4.39 最终 tarball 已验证 paired Holdout 的真实 DSH Web 生命周期；V4.42 又从最终 `dsh-evolve`/`dsh-evolve-web` tarball 验证 exact Retention 的权威卡片、整页 reload、Host 断连显式报错但保留最后快照、同端口恢复、console error 0 和官方卸载。V4.43 已用真实 DSH Agent/Session/SkillRegistry 自动化证明同名现有 Skill 的 future-only 晋升、旧 Session 固定、显式回滚恢复原生选择、二进制整包保留和决定跨重启恢复；Control/Remote/Web 与最终 tarball 浏览器尚未接入。existing-Skill failed-Outcome Canary、两套独立真实 provider、长期 Outcome、真实飞书 exact route、Hermes paired benchmark 与长期误晋升/负迁移/误回滚证据仍未完成。

现有 Skill Candidate 的内容身份绑定生成前 exact Evaluation Envelope；五 Goal Envelope 同时内容寻址 Holdout 与 Retention，四 Goal及历史 v2 Envelope 明确没有 Retention。历史无绑定 Candidate 只读且不得进入 Trial，Envelope 错配在 Candidate 物化前失败关闭；DSH Web 显示 Candidate 绑定、Retention presence 与 paired evaluation 实际使用的 Envelope。

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

`dsh-gateway` 已直接替换旧 Router 包且没有兼容转发层；Gateway、Telegram、飞书、Evolve Attention、全仓类型/构建和十一包 clean-profile add/dump/boot/remove/readback 均已回归通过。静态 exact endpoint、原生 Workspace/Session/Agent、Command、持久 ingress 与双 Workspace 双渠道隔离保持；Gateway 现已统一 Telegram/飞书普通文本的持久 outbound intent、幂等、按 account 串行、明确 429 有界重试、uncertain 恢复、脱敏 transport observation，并由同包 DSH Client Module 提供只读渠道健康视图。飞书图片已在 assembled DSH 中经官方 message-resource 端口下载、整批校验、原生 AttachmentStore 内容寻址保存并以 `ImageAttachmentRef` 进入 Agent，外部 `fileKey` 不进入 Session；固定 DSH attachment v1 尚无通用文件契约，因此普通文件、音视频及飞书内容能力仍明确 pending。最终 tarball 的真实 DSH 浏览器已验证 existing-Skill exact paired holdout 的读取、整页刷新、Host 停机保留最后快照并显式失败、同端口恢复和官方卸载。真实飞书 exact 用户消息/回复/Approval、两套独立真实 provider Trial、同模型编码/长任务和真实消息交付 Hermes paired epochs 仍是完成门禁；这些完成前不得发布或宣称整体上位。

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
- [ADR-0069](docs/adr/0069-channel-images-enter-dsh-as-native-attachments.md)
- [ADR-0080](docs/adr/0080-existing-skill-structural-admission-is-a-separate-paired-subject-gate.md)
- [ADR-0081](docs/adr/0081-existing-skill-holdout-is-authored-before-the-candidate.md)
- [ADR-0082](docs/adr/0082-existing-skill-effect-verdict-requires-an-exact-paired-holdout.md)

License: MIT.

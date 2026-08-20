# V4.28 Shadow/Retention 真实 DSH 浏览器证据

> 日期：2026-08-20。声明等级：`verified`，仅覆盖 V4.27 只读投影的最终 tarball 装配、真实 DOM、整页 reload、Host 断连与同端口恢复；不把确定性浏览器夹具冒充真实 provider Retention outcome、自动晋升或 Hermes 上位替代。

## 验收装配

- 从当前 `main` 构建 `dsh-evolve` 与 `dsh-evolve-web` 最终 tarball，通过官方 `dsh plugin --profile web add` 安装到全新隔离 profile，并用 `--dump-config` 确认 Typert、Host Bundle、Client Module 与测试 overlay 的组合。
- 发布 tarball 不包含 `test`。测试专用 bootstrap 由 overlay 以绝对路径加载，先用 DSH 原生 `WorkspaceRegistry` 创建 Workspace，再在 Workspace-owned `runRoot/shadow` 与 `runRoot/retention` 写入一对确定性的 exact lineage 制品。
- 评测种子不创建额外 Runtime、Session、Goal、Agent、审批或发布面；现有 bootstrap 仍只使用 DSH 原生 Workspace/Session/Agent/Goal 夹具。生产 `ReviewInbox` 与 `InternalSkillRetention.scan()` 负责严格读取、内容地址校验、路径脱敏和 exact Candidate/Admission/Envelope/Shadow/tree 配对。
- 夹具数据只证明浏览器投影，不声称执行过 provider Trial。页面仍明确显示 `无发布权限 · 仅为证据`。

## 红灯发现与修正

第一次真实启动时，Shadow 可见，但 Retention 被标记为 1 条无法精确配对。原因是 macOS 将 `/tmp` 规范化为 `/private/tmp`：Retention terminal result 的路径身份使用未规范化配置路径，而 production scanner 使用 `realpath` 后的 owned root，严格相等校验正确拒绝了该制品。

fixture 现在先 `realpath(config.runRoot)`，再形成 Shadow、Retention 与 terminal `reportPath`。重新启动后 production scanner 返回 exact retained 配对，warning 从 1 变为 0。package contract 固定该规范化步骤，防止浏览器证据依赖路径别名偶然通过。

## 真实浏览器结果

在固定 DSH revision `47f943859bef60e4160492346772ded9b24f765a` 的原生 Web 中选择 `EvoForge Browser Acceptance` Workspace，打开“演化 → Skills”：

- `Assembled Shadow 与 Retention` 标题唯一且布局为 `194.43 × 16.5`；
- exact Shadow 显示 `Baseline 失败 → Candidate 通过 · 4 次 Trial`、稳定 composition 和 Candidate/Admission/Envelope 短身份；
- exact Retention 唯一显示“保留了既有行为”，并显示 `Baseline 通过 → Candidate 通过 · 4 次 Trial`、校准通过、proposer 调用 0、模型调用 `2/2`、input/cache-read `100/80 · 90/70`；
- “1 条评测状态无效或无法精确配对”为 0 项；整页 reload 后 retained、metrics 仍各 1 项，warning 仍为 0。

失败恢复序列：

1. 在高级视图确认 Host 为运行中后停止同一 DSH Host；
2. 点击刷新，页面显示唯一 `evoforgeEvolution/overview ... Failed to fetch` alert；切回 Skills 时最后一次成功的 Retention 证据仍唯一可见；
3. 使用同一 profile、同一端口重启 Host，再点刷新；alert 变为 0，运行状态恢复，Retention 与 metrics 仍各 1 项；
4. 最终浏览器 console error 为 0。故障注入期间 DSH connection client 的断线重试 warning 属于预期信号，不被伪装成零 warning。

## 自动化与边界

- `dsh-evolve-web` package contract 18/18 通过，固定 fixture test-only、最终 tarball 不含测试、installed Host artifact、native Workspace、exact run root 和路径规范化；
- Web typecheck、根级 `pnpm check` 与文档门禁通过；V4.27 的 Retention 防篡改、exact pairing 与 browser-safe 类型测试继续通过；
- 本证据没有调用模型、读取 API Key、发送平台消息或执行晋升。真实 provider assembled Retention、Retention→promotion eligibility、canary/outcome、真实飞书用户消息和 Hermes paired benchmark 仍 pending，因此不创建 tag。

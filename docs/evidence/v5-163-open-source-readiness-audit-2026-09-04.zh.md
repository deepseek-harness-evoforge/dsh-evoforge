# V5.163：开源可用性与真实缺口审计

日期：2026-09-04  
EvoForge：`b03723be4118817cce476076131122627145617d`（`main`，clean）  
canonical DSH 最新 `master`：`76fda729799fe9b3848dbe2c211d4b231032b81e`（`dsh-v0.1.2-rc.1`，clean）  
当前可构建支持基线：`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`（`dsh-v0.1.2-alpha.5`）

## 本轮实际检查

开发前重新执行了两个仓库的 `git fetch origin --tags --prune`，并确认 DSH 最新远端、版本和工作树。随后执行：

```text
pnpm run check:release
node scripts/check-npm-package-names.mjs --json
pnpm run check:release:gates -- --json
```

静态发布预检通过（12 个 Bundle 的 MIT、README、Bundle patch、统一版本和套件清单均满足合同）。动态门禁仍为
`blocked`，不是 CI warning，也不是可以由文档替代的失败。

## 为什么距离真实开源产品仍有差距

### 1. DSH 最新版本尚未形成可安装支持基线

最新 rc.1 的依赖安装通过，但官方根级构建在 `@deepseek-ai/dsh-root` 的
`lib/types/{index,invariant,startup}.js` 入口失败。EvoForge 已在 rc.1 上通过一次 clean-profile 兼容 fixture，
但没有把部分生成物当成发布运行时；正式支持仍锁定完整可构建的 alpha.5。原因在上游，不能通过 EvoForge 偷补
生成目录来伪造支持。

### 2. 本地 Bundle 可安装，不等于可以从 registry 安装

四个公共名称已被无关项目占用：`dsh-doctor`、`dsh-feishu`、`dsh-gateway`、`dsh-telegram`。另外八个名称当前
未注册，但整组命名策略仍未冻结。没有项目拥有的 npm scope 或一次性重命名，不能创建 tag，也不能让用户执行
稳定的 `dsh plugin add <registry-spec>`。

### 3. 外部真实路径仍缺闭环证据

本地 assembled、loopback 和 deterministic 测试已覆盖大部分失败语义，但 release gate 仍要求真实 Feishu
事件→配对→批准→下一条消息、真实 Telegram Bot、真实 Provider 双路、同条件 Hermes paired，以及长期负迁移/遗忘/误晋升/重复外部效果数据。Feishu 最近一次有效凭据运行只证明 WebSocket ready，未观察到新人事件，因此按 fail-closed 记录为失败。

### 4. 现有“12 个包”是内部生命周期边界，不是 12 个用户选择

用户入口已经收敛为 `core`、`channels`、`delivery`、`continuity` 四个套件；`attention` 是可选附加，`full` 只给维护者。
`dsh-gateway` 与 Feishu/Telegram 必须分开才能分别持有平台凭据、协议重连、路由权限和卸载生命周期；`dsh-evolve-web`
与 `dsh-control-center` 分开是为了让一个原生 DSH view 承载多个 Host adapter，而不是制造多个网页。可精简的是安装
入口和页面，不是抹掉真实信任边界。

### 5. “自我进化”已实现控制面，但效果声明仍需真实数据

内部 Gap→Opportunity→whole-Skill Candidate、Candidate-blind holdout、Retention、隔离、Session pin、future-Session
promotion、canary 和精确 rollback 已有 deterministic/assembled 证据。当前 Hermes epoch-4 只比较确定性 release-control
切片（EvoForge primary `0`、Hermes `1`），不能外推成模型质量、长期效果或整体 Hermes 上位替代。

## 当前可公开试用的范围

- 维护者可从本仓库生成套件 tarball，经官方 DSH `plugin add/dump/boot/remove` 安装、卸载和读回原生 Session/Goal；
- `core` 的内部经验进化、零模型诊断和单一 DSH Web 控制面可在 alpha.5 支持基线上复现；
- `channels` 的 resident Gateway、Feishu/Telegram Adapter、Host pairing、持久 ingress/outbound 和统一 Web projection
  可用 assembled/loopback 路径验证；
- `delivery`、`continuity` 和 `attention` 的用户结果有对应本地合同，但外部服务和长期运行仍需单独授权验收。

上述“可试用”不等于生产承诺，不等于 registry 已发布，也不等于 Hermes upper alternative。

## 自动执行队列（不等待用户选择）

1. 每轮先复核最新 DSH；若最新版本仍不可构建，保存上游失败证据并继续用已审计支持基线做不掩盖缺陷的回归。
2. 在不猜测 npm scope 的前提下，持续完善可重复的命名空间迁移预检、套件 tarball 安装说明和发布工作流；不创建
   绕过占用名称的 tag。
3. 在已有 Gateway/Control Center 接缝内继续补真实路径所需的最小诊断和恢复，不新增第二 Runtime、Gateway、网页或
   能力获取市场。
4. 每个可验证增量先写证据、状态、CHANGELOG，再在 `main` 原子提交并推送；所有真实门禁保持事实状态，直到同任务、同模型、
   同权限、同预算的证据真正满足发布条件。

## 结论

仓库不是“没有进展”：核心架构、单页控制面、常驻 Gateway、内部自进化隔离和本地安装生命周期已经形成可复核基线；
它也还不是合格的公开发行版，因为 DSH 最新支持版本、registry 命名、真实外部渠道、真实 Provider paired 和长期效果
仍未闭环。当前最重要的工程纪律是保持这两类事实分离：继续实现和验证，同时拒绝把 deterministic、Mock、文档或一次成功包装成
“已经超越 Hermes”。

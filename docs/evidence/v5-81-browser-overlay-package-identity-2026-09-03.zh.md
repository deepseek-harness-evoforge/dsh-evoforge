# V5.81：最新 DSH 单页浏览器验收与 Fixture 模块隔离（2026-09-03）

## 目的

修复并验证最新 DSH alpha.5 Web 验收 fixture 的真实启动和单页交互。此前 overlay 直接把
`packages/dsh-control-center/test/fixtures/browser-doctor-bootstrap.mjs` 作为绝对 Loader 入口；DSH
按入口向上查找最近的 `package.json` 时，会把该 fixture 识别成第二个 `dsh-control-center` client source，
因此启动失败。该问题属于验收 harness 的入口身份冲突，不是用户 Bundle 的运行时路径。

## 修复

`create-browser-doctor-overlay.mjs` 与 `create-telegram-browser-overlay.mjs` 现在在操作系统临时目录生成极小
ESM shim。shim 只 re-export fixture 的 `name`、`inject` 和 `apply`，生成的 Loader 入口位于 EvoForge 包目录
之外；fixture 自身的依赖解析仍保持原样。临时 shim 不会被写入发布包、profile 或 Git。

## 真实环境与结果

- DSH 在测试前重新 `git fetch origin --tags`，确认 `origin/master` 为
  `76fda729799fe9b3848dbe2c211d4b231032b81e`；可构建支持基线为 alpha.5
  `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。
- 使用隔离 `DSH_HOME`，通过官方 DSH CLI 安装 `core`（Evolve、Doctor、Control Center、Evolution Web）与
  `channels/telegram`（Gateway、Telegram）的最终 tarball；没有修改 DSH 源码，没有建立 Git 分支。
- `dsh --profile web --no-open --port 3080` 在 shim 入口下成功常驻；此前的 duplicate client source 和随后
  的 session-id collision 均通过新的临时 session id 重新冷启动解决。凭据没有写入仓库或报告。
- 只使用一个原生浏览器标签页和一个 `127.0.0.1:3080` 页面：关闭 DSH 内测提示、选择 workspace 和真实
  fixture Session 后，原生 Session 出现“对话 / 轨迹 / 控制台”；进入“控制台”显示 Doctor Surface 与 Evolution
  Surface，没有固定弹窗、独立路由或第二网页。
- 点击“重新诊断”后仍显示“运行就绪度：已就绪、失败项：0”；用原生 ARIA roving keyboard（`ArrowDown`）
  切换到“演化”，显示“演化控制、当前稳定、权威状态 · 不调用模型”。整页 reload 后仍回到同一页面和真实
  fixture Session，控制台及 Doctor Surface 可恢复读取。
- 浏览器截图确认左侧 DSH 原生 workspace/session 导航、中部 Control Center surface 导航和右侧内容区均在同一
  页面内；没有打开额外标签。测试结束已停止临时 Host 并关闭该唯一验证标签。

## 证据边界

本证据证明：最新 DSH 支持基线下，EvoForge 的原生 Control Center fixture 可以干净启动、在同一 DSH
Session 内显示通用插件可视化、执行刷新、键盘切换和 reload 恢复。它不宣称真实 Telegram/飞书外部消息、真实
Provider、Hermes paired benchmark、长期负迁移/遗忘或 release tag 已通过；这些门继续按
根目录 [`release-gates.json`](../../release-gates.json) 阻断发布。

# V5.173：公开套件打包修复与最新 DSH 单页交互复验

日期：2026-09-04  
EvoForge revision：`a401beb`（本轮修复已推送 `origin/main`）
DSH canonical revision：`76fda729799fe9b3848dbe2c211d4b231032b81e`（`origin/master`，`dsh-v0.1.2-rc.1`）  
DSH assembled support revision：`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`（alpha.5）

## 发现与修复

为避免和官方/第三方包撞名，Gateway、Feishu、Telegram、Doctor 的公开分发名已经迁移到
`dsh-evoforge-*`，但套件清单仍保留稳定的 workspace 目录 id。原 `scripts/pack-suites.mjs` 把目录 id
直接传给 pnpm `--filter`，因此 `channels --channel feishu` 会出现 “No projects matched”，实际无法生成
Gateway/Feishu tarball。这是开源用户安装链路中的真实阻断，不是测试夹具问题。

本轮改为先读取每个目录的 `package.json`，再按公开 `manifest.name` 执行官方 pnpm pack；生成的清单仍同时
保留 `dir` 与公开 `name`，从而不改变套件产品入口或 Bundle 生命周期边界。回归测试锁定该分离契约。

## 验证命令与结果

在开发前重新执行 canonical DSH `git fetch --all --prune`，确认 `HEAD == origin/master` 且工作树干净；使用
已审计的 alpha.5 support checkout 作为本地安装基线。随后执行：

```text
node --test scripts/pack-suites.test.mjs
node scripts/pack-suites.mjs --suite channels --channel feishu --out <temporary-dir>
```

结果：回归测试 `2/2` 通过；`channels/feishu` 成功生成三个可由官方 DSH 安装的 tarball：
`dsh-control-center`、`dsh-evoforge-gateway`、`dsh-evoforge-feishu`，并写出带 SHA-256 的
`evoforge-suite.json`。打包同时完成 Control Center、Gateway、Feishu 的 typecheck/build。

## 最新 DSH 单页浏览器

用官方 CLI 在临时 `DSH_HOME` 安装上述 tarball，profile 为 `web`，只启动一次
`dsh --profile web --no-open --port 3083`；没有写入真实凭据。通过临时 test-only overlay 注入一个原生
Workspace/Session 和脱敏的 Gateway 传输观察值。

在同一个 DSH Web 页面完成：

1. 关闭内测提示，跳过 API Key 配置，选择已创建的 `Control Center browser fixture` Session。
2. 点击原生 Session 的“控制台”tab，看到单一 Control Center 的“渠道”Surface。
3. 确认同页展示“首次连接”三阶段、Gateway/飞书/Telegram 传输卡片、授权路由、配对码入口和“只读取
   Host、不调用模型”声明；没有固定弹窗、第二路由或第二网页。
4. 点击“刷新状态”，Surface 保持可见并读取最新 Host 投影。
5. 整页 reload 后仍回到同一 Session，Control Center 与“渠道首次连接进度”恢复；浏览器 error 日志为 `0`。

验收结束调用浏览器 tab finalize，只保留这一页，清理之前无法访问的旧 `3080` 残留页。该页验证的是
DSH 原生 Web 组成、单页交互和 reload 恢复，不把脱敏 fixture 冒充真实 Feishu/Telegram 入站事件。

## 证据边界

本轮证明公开渠道套件现在可以实际打包，并能在最新已审计 DSH 支持基线上由官方安装器启动；Control Center
真实单页的导航、刷新和恢复可用。npm namespace 归属、真实 Feishu 外部入站/配对、真实 Telegram Bot、双
Provider paired、Hermes paired、长期负迁移/遗忘与 release tag 仍由 `release-gates.json` 阻断，不能以本轮
fixture 或一次浏览器成功替代。

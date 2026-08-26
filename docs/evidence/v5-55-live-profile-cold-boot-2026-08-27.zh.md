# V5.55：当前插件套件在 DSH Web 的真实冷启动与单页交互

日期：2026-08-27

## 目标

把当前 `main` 的 core 插件套件安装到 DSH `web` profile，在用户授权的飞书凭据下启动常驻 Host，确认不是旧进程、旧 tarball 或第二个临时网页。

## 实际环境

- DSH 使用当前本地 pinned checkout 与 `web` profile；原有 profile 数据保留。
- 通过官方 `dsh plugin --profile web add` 安装当前构建的 `dsh-evolve`、`dsh-doctor`、`dsh-control-center`、`dsh-evolve-web`，并与已有 `dsh-gateway`、`dsh-feishu` 共存。
- Host 以用户在本任务中提供的凭据启动；凭据未写入仓库、日志或证据。
- 旧的失效 Host 已停止；新 Host 由 `node --import tsx/esm apps/cli/src/bin.ts --profile web --no-open` 启动，监听 `127.0.0.1:3080`。

## 浏览器验收

只保留一个浏览器标签页 `http://127.0.0.1:3080/`，在原生 DSH Session 的“控制台”中完成：

1. 运行诊断显示“已就绪”，`required-plugins` 与 `runtime-failures` 均通过。
2. “渠道”显示 1 个授权实时 Session、入站 3、出站 3、待处理 0；飞书为 `official-feishu-websocket`，状态“连接正常”。
3. 点击“刷新状态”后仍保留同一页面与状态。
4. “飞书内容”和“演化”均在同一个控制中心 Surface 内切换；演化页明确显示尚未配置独立评测治理，不伪造已完成进化。
5. 整页 reload 后仍回到同一个 `3080` 页面，控制中心和四个 Surface tab 恢复；浏览器错误日志为 0。
6. 验证结束关闭该标签页，没有产生 `56017` 或其他临时页面。

## 结论与边界

这证明当前插件组可以在真实 DSH profile 中安装、冷启动并提供单页控制面，且已恢复现有授权路由与持久 journal 计数。它不等于真实飞书新消息端到端 paired benchmark、真实 Provider paired benchmark、Hermes 同任务对照或长期误晋升/遗忘/负迁移数据已通过；发布门禁继续保持阻断。

# V5.50：双版本生命周期探针的单浏览器交付

- 日期：2026-08-26
- EvoForge commit：`ba9e52c93346252c3d2b26fa5bd12425f034588e`
- DSH targets：`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`（`0.1.1-rc.2`）与
  `47f943859bef60e4160492346772ded9b24f765a`（`0.1.0-rc.5`）
- 状态：`verified`（仅覆盖生命周期探针与当前 Web 入口，不提升真实渠道、Provider 或 Hermes 发布门）

## 问题

clean-profile 和 suite-upgrade 会使用临时端口启动真实 DSH Web Host。rc.2 的 Web CLI 默认会打开浏览器，旧
探针没有关闭 handoff，Host 退出后会在用户 Chrome 留下无法恢复的随机端口标签（此前表现为死的
`http://127.0.0.1:56017/`）。rc.5 的 Web CLI 已删除 `--no-open`，不能简单把 rc.2 的参数硬编码到双版本矩阵。

## 修正

`dsh-software-delivery` 的两个 assembled 生命周期测试在启动前读取目标 CLI 的 `dsh --profile web --help`：

1. 帮助包含 `--no-open` 时（rc.2）将该参数传给 CLI 探针和官方 `cmdlineArgs` 的直接 `appBoot` 组装；
2. 帮助不包含该参数时（rc.5）只传官方 `--port 0`，不向旧 Host 发送未知 flag；该版本本身没有浏览器 handoff；
3. CLI 探针还断言 stdout/stderr 不出现 `opening the default browser`，并继续验证 SIGTERM 后进程确实消失。

## 验证证据

本地在同一工作树完成：

- rc.2 clean-profile：`1 file / 1 test passed`，37.36s；
- rc.5 clean-profile：`1 file / 1 test passed`，35.66s；
- rc.2 suite-upgrade：`1 file / 1 test passed`，100.88s；
- docs、release metadata、release tag/workflow、CI path、suite manifest 检查全部通过。

随后推送 `main`，GitHub Actions run [32983430834](https://github.com/deepseek-harness-evoforge/dsh-evoforge/actions/runs/32983430834)
的 Node 22、Node 24、rc.2 assembled 和 rc.5 assembled 四个 job 全部 `success`。其中两个 macOS assembled job
均包含 clean-profile 与 suite-upgrade 路径。

真实浏览器只保留常驻 `http://127.0.0.1:3080/`：在同一标签完成“控制台 → 渠道 / 飞书内容”、刷新、整页 reload
和恢复，页面应用层 console error/warn 为 0；没有再启动 `56017` 或其他随机端口页面。

## 边界

该证据只证明测试与人工交付入口不会制造死标签，并不证明 DSH `dsh --profile web` 的用户默认启动策略被修改，也
不替代真实 Telegram Bot、真实飞书 epoch-3、真实 Provider、Hermes paired 或长期效果门禁。当前 `main` 仍不创建
SemVer tag，发布阻断以 [release-gates.json](../../release-gates.json) 为准。

# V5.158：发布门禁 JSON 快照

日期：2026-09-04  
EvoForge revision：`eb8fdc8a3ef0e80788bd419399e9c26dfad9843e`  
命令：`pnpm run check:release:gates -- --json`  
结果：退出码 `1`，`status: blocked`；`errors: []`，`missingEvidence: []`。

## 当前阻断项

机器可读结果确认没有缺失证据文件或门禁清单格式错误，阻断全部来自尚未满足的真实发布条件：

| 门禁 | 状态 | 可执行的缺口 |
|---|---|---|
| `registry-name-availability` | failed | 四个 unscoped npm 名称已被无关仓库占用；需取得项目 Scope 或完成一次性重命名并重新打包验证。 |
| `web-control-plane` | partial | 真实外部 Telegram Bot 的完整新人配对/回复/恢复路径尚未完成。 |
| `real-feishu-as2` | failed | 有效 App 已到官方 WebSocket ready，但未观察到新人 pending；事件到达和完整 direct-message/Schedule/Approval/重启/卸载 epoch 尚无证据。 |
| `real-telegram-as1` | not-run | 没有获得 Bot token 和真实外部运行授权。 |
| `real-provider-rp1` | not-run | 没有同任务、同模型、同权限、同预算的真实 Provider paired run。 |
| `hermes-paired` | partial | 只有确定性切片，缺少同模型真实 Hermes paired benchmark。 |
| `long-term-effects` | not-run | 缺少长期误晋升、遗忘、负迁移、重复外部效果、恢复和回滚率数据。 |

## 结论

本快照把发布判断固定为 `blocked`，因此当前不能创建或推送 SemVer tag，也不能把本项目宣称为已完成的 Hermes
上位替代。所有本地工程门禁和 clean-profile 生命周期仍保持通过；继续开发时必须复用该 JSON 命令并将新证据绑定到
实际 revision，不能用文档、Mock 或单测覆盖上述真实缺口。

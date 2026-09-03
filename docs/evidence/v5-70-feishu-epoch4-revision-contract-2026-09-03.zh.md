# V5.70：真实飞书 AS-2 epoch-4 revision 契约收口（2026-09-03）

本证据只记录真实渠道执行前的契约修复和 fail-closed 行为，不把它当作真实飞书通过证据。

## 发现

按最新 DSH 更新要求，先拉取并审计了 DSH `dsh-v0.1.2-rc.1` / `76fda729…`。该版本的上游
完整 clean build 被根级 tsdown 缺失入口阻断；最近可复现、已完成 EvoForge assembled 矩阵的公开
基线是 `dsh-v0.1.2-alpha.5` / `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。

AS-2 manifest 原来仍固定已过时的 `b150a551…`。使用 alpha.5 启动真实入口时，验收器在读取飞书身份
和发出任何外部效果前准确拒绝：`AS-2 DSH revision mismatch`。这证明 revision guard 生效，但也说明
真实门不能继续引用旧 benchmark 身份。

## 修复

- 新建 `as2-feishu-resident-pairing-epoch-4`，把 manifest、Contract 和 README 固定到 alpha.5。
- 保留旧 epoch-3 的历史报告，不改写历史证据；manifest hash 变化使旧 terminal report 不可复用。
- 保持未知私聊、Host pending approval、Schedule、Approval、重启、卸载和 readback 的十三项闭合门。
- 先运行 `pnpm benchmark:feishu:as2:check`：TypeScript 检查和 10 项契约测试全部通过。

## 安全执行记录

修复后的第一次真实入口尝试发生在工作树仍有这次契约修改时，入口在外部效果前返回：
`AS-2 requires a clean EvoForge revision before real effects`。没有发送飞书消息、没有读取动态身份、
没有创建 Gateway route；该 run root 仅作失败前审计记录，不能作为通过证据。

下一次真实执行必须使用提交并推送后的 clean `main`、隔离 run root 和 alpha.5 DSH source。只有终态
JSON 的十三项 observation 全为真且 Gateway 无 uncertain/failed，才允许把 gate 从 failed 改为 passed。

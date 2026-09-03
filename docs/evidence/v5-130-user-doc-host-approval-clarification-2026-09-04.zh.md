# V5.130：用户文档与实际 Host 批准入口对齐

## 发现

根 README 的飞书配对步骤仍写“Host 侧 request-id 命令”，容易让用户寻找不存在的独立 CLI。当前公开实现的批准入口是原生 DSH Web `Channels` Surface：pending 行展示脱敏 request-id，并由按钮调用同一个 Gateway Host authority；没有 Session Command，也没有独立宿主命令。

## 修复

中文和英文根 README 已改为准确描述 Web pending 行的 request-id 批准路径。运行时、Gateway Remote 和安全边界未改变，文档没有新增未交付入口。

## 验证

在最新 DSH clean preflight 后执行 `pnpm run check:docs`、`pnpm run check:release -- --allow-dirty` 和 `git diff --check`，全部通过。该修复只消除用户引导歧义，不改变真实 Feishu AS-2、Provider、Hermes paired、长期效果或 npm 发布门状态。

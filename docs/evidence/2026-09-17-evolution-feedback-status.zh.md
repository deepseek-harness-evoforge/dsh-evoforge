# 演化概览：区分反馈记录、候选资格与评测

日期：2026-09-17。代码：`437ae06`。范围：实际原生 Web 的展示纠错，不是普通对话学习链路的实现。

## 真实问题与边界

此前飞书 E2/E3 的普通对话纠正已保留在原生会话，但没有进入当前负反馈计数或生成候选。
实际演化页仍写“条纠正已记录”“照常聊天或纠正结果……会在这里出现”，容易让用户误解采集范围。
此外，组件只凭有评测配置和反馈数就显示“纠正已进入自主评测闭环”，没有要求实际评测运行。

本次只修改 `dsh-evolve-web` 中英文提示与概览：计数明确指带说明的原生回答负反馈；普通聊天纠正尚未自动接入；
有配置和反馈也只显示资格待检查，不证明评测已开始或改进成功。无待办不再称为“当前稳定”。
没有新增模型调用、提示、Tool、状态存储、权限、事件监听或 Host API，也没有降低归因、独立样本和治理门槛。
安装/卸载与恢复继续由原生 Bundle/Client 生命周期负责；回退仅需恢复上一持久包，不迁移会话数据。

## 检查

- 本轮 canonical DSH fetch 后仍为 `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`，与 origin/master 一致；
  工作树干净，`dsh-v0.1.6-alpha.1` 后 5 个提交。冻结安装与完整上游构建通过，未修改 DSH。
- 新增真实中英文 locale 组件用例，先验证 4 项失败，再修复；覆盖无配置/无反馈、有配置/有反馈与无自主评测声明。
- `packages/dsh-evolve-web`：`pnpm exec vitest run --maxWorkers 1`，2 文件、31 项通过。
- `pnpm --filter dsh-evolve-web typecheck` 与 `build` 通过。
- `DSH_EVOLVE_DSH_SOURCE_DIR=<audited-host> pnpm exec vitest run test/clean-profile-suite.e2e.test.ts --maxWorkers 1`，
  在 software-delivery 包运行，2 项通过、39.83 秒；覆盖干净 profile 安装、原生运行、移除和原生数据回读。
- `pnpm run check:docs`、`pnpm run check:ci`、`git diff --check` 通过。
- 官方 product 安装器在隔离 DSH_HOME 中 add/dump 通过；持久 pack 为
  `dd5d31bf0fe678422ded718a3ae3dbe11317b293fdc2f371bc2a529e30d7b29d`。

## 本机部署与实际页面

校验完整 manifest 后只安装其中的 `dsh-evolve-web`。停止唯一空闲 Host 后冷备份，再进行官方 add/dump。
22 个历史文件逐字节一致，profile patch 不变，其他依赖逐项不变；保留飞书表格、文件交付和控制台恢复修复。

同一个原生“中文问候”会话刷新后仍停在演化页，实际显示“反馈可记录，自动改进尚未就绪”、普通聊天纠正限制和
“条带说明的负反馈”。531 像素宽实际截图确认主要提示换行且没有横向截断。
受控停止 Host 后，点页面刷新显示 `Failed to fetch`，原内容保留；重启同一 profile 后再次刷新，错误消失。
最终保持单 Host、原完全权限和原会话；本轮没有发送业务消息或进行付费模型调用。

配置存在且有反馈的分支只由组件测试验证，没有为演示修改生产评测配置或制造反馈。
普通聊天纠正→独立样本→候选→评测的运行时链路仍未完成，本次不得作为已学会、已自动改进或优于 Hermes 的证据。

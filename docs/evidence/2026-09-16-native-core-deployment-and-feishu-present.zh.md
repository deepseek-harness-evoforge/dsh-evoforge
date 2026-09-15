# 2026-09-16：原生核心升级部署与飞书 present 缺口修复

## 结论与范围

本次把现有单一 `web` Host 从历史 alpha.5 升级到固定 DSH `0.1.6-alpha.1` /
`0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`，没有修改上游核心。EvoForge 核心迁移为 `9d3adfc`，
飞书原生 `present` 交付桥修复为 `d05c009`，均已推送 main 并部署；没有发布 tag 或 registry 包。

Web 的旧会话续接完成真实文件读取，新核心重启后新增记录可见。飞书文本收发成功，但首次附件任务失败：
模型把 Web 的 `present` 成功误称为飞书附件送达。该适配缺口已修复并部署，**修复后的真实平台附件验收尚未完成**：
重跑前 Mac 锁屏，界面操作未发出，未产生新的文件发送或审批。不能宣称飞书附件已可用，也不能宣称完成 Hermes 替代。

## 核心迁移验证

- 使用官方 registry 的真实 `0.1.6-alpha.1` 依赖；独立安装候选副本，不共享旧版 `node_modules`。
  处理上游 `code-runtime` → `ptc-runtime` 包名变化和明确的 peer 闭包；`pnpm peers check` 无问题。
- 迁移到 awaited `agent/created`；测试使用实际 register/announce 语义，恶意重放仍单独测试。
- 旧 Typert 生成物虽然能构建，却被新核心拒绝（缺少 `codec.create()`）。改用同 revision 官方生成器，新增
  `scripts/verify-native-typert.mjs`，通过真实 registry 注册、查询与 dispose 验证；干净配置测试要求接口实际存在。
- 主仓库完整 build、typecheck、串行 `pnpm test` 和固定源的 `pnpm run test:dsh-compatibility` 通过。
  该轮飞书 105 项通过；原生矩阵覆盖控制面、安装/卸载/读回、Generation 固定与回滚、聊天、内容、文件和计划恢复。
- 18 份真实旧会话的私有副本经新版原生读取、写入、冷读通过；Workspace/Session 索引、六个既有插件 Domain 的
  副本读回通过，原始数据保持不变。新文件 Domain 在没有 intent 时不写空文件。

关键执行命令（`DSH_EVOLVE_DSH_SOURCE_DIR` 指向上述干净、已构建的固定源）：

```sh
pnpm run build
pnpm run typecheck
DSH_FEISHU_TEST_NATIVE_FILES=1 pnpm test
pnpm run test:dsh-compatibility
pnpm peers check
pnpm run check:docs
pnpm run check:ci
node --test scripts/run-dsh-compatibility-matrix.test.mjs scripts/check-dsh-preflight.test.mjs scripts/check-release-workflow.test.mjs
```

## 数据与部署保护

停旧 Host 后私有备份逐项核对：2281 个可读文件、623 个符号链接一致。一个原本 root 所有的可重建 Session
展示缓存无法复制；原文件未改权限、未删除。凭据文件逐字节相同，18 份原始会话日志在升级后的真实任务与重启后
仍逐字节相同；新格式后继日志由 DSH 创建，不替换历史。原用户配置只增加 `fileDeliveryEnabled: true`。

固定核心放入独立持久安装目录；7 个产品包通过官方 plugin add 与 dump 更新。最终 manifest 的内容地址为
`0f108dbaf01c06c9c25862592c59cf0b85fcf24db09ef5d2e2719e14d213d83f`。核对安装后的飞书代码确实包含新桥。
切换期间先确认旧进程退出、端口空闲，再启动新进程；最后只有一个 Node Host 监听 `127.0.0.1:3000`。
没有增加常驻服务、公开端口、授权主体或第二控制页面。

实际降级复现表明：旧二进制读取新版已追加消息的数据时，只显示升级前内容。因此**新消息产生后禁止仅换回旧核心**，
也不能恢复停机快照而静默丢弃新消息。已保留新版核心兼容的升级前插件配置；恢复策略是保留当前核心与数据，
关闭文件外发或恢复兼容插件。Skill Generation 的精确回滚与核心二进制降级是不同合同。

## 真实任务与复现

| 固定任务 | 可观察结果 | 判定 |
|---|---|---|
| WEB-20260916-B：在原会话中实际重读上一轮的专用文件，不重复给路径、不修改文件 | 原生 1 次读取，返回 `apples=3`、`oranges=4`、`total=7`；11 秒、15.3K tok；随后重启历史恢复 | 通过 |
| FEISHU-20260916-C：把既有虚构验收表作为附件发到当前私聊，只允许这一个文件 | 原生读取与 `present` 共 2 次工具调用；Web 有文件卡，飞书只有“已发送”文本，没有附件或审批；22 秒、27.9K tok，UI 记录一次模型请求重试 | 失败，缺口已定位 |
| 同一私聊、同一会话重跑附件任务 | 新代码已部署；发起前 Mac 锁屏，操作未执行 | 待解锁，不计成功 |

以上 token 为各轮 UI 用量，不是费用或同条件性能比较。验收表仅有两个虚构事项，131 字节，SHA-256 为
`980434b0776b633935e9a582a728e49bb71e249e394bb0734ed35d3179d0c16b`。现有原文件未修改。

首次失败的复现步骤：启用文件外发，在已配对旧会话的飞书私聊请求交付专用文件；观察 Web 工具行显示 `present`
已交付，而飞书没有附件。新版原生 `present` 只声明源文件，不能把它的结果直接当作平台上传回执。

## 修复与回归

按照 [ADR-0105](../adr/0105-feishu-file-delivery-approves-native-snapshots.md)，只在确由飞书入站触发的当前 turn 中，
通过原生 post-execute 将单文件 `present` 接入既有快照、审批与 Gateway 回执；不扫描回复，不新增或替换 schema，
Web 发起的 `present` 不外发。未知或未送达结果返回错误态。旧会话无需重新配对，也无需新增显式发送 Tool。

实际 native `present` 复现用例先失败：审批卡为 0；收紧反馈后约 1.4 秒重复捕获三种分支的同一缺口。
修复后实际 DSH Agent/Approval/AttachmentStore/Gateway 的六个组合用例通过（两种工具 × 批准/拒绝/错误用户）。
其中审批等待期间改写源文件，送出的仍是被批准快照；拒绝没有文件 intent。该层平台为测试 transport。

```sh
DSH_FEISHU_TEST_NATIVE_FILES=1 pnpm --filter dsh-evoforge-feishu exec vitest run test/dsh-assembled-file.e2e.test.ts --maxWorkers 1
pnpm --filter dsh-evoforge-feishu exec vitest run test/native-present-delivery.test.ts test/file-tool.test.ts --maxWorkers 1
pnpm --filter dsh-evoforge-feishu run typecheck
DSH_FEISHU_TEST_NATIVE_FILES=1 pnpm --filter dsh-evoforge-feishu test
```

最终飞书全量 **28 文件、124 测试通过**。覆盖旧 schema 不变、Web/其他 Agent 不外发、关闭/缺审批、未知回执、
其他 post policy 拒绝或改写、原生 guard 拒绝、多文件无副作用拒绝、卸载取消迟到审批。文档、CI 路径与 diff 检查通过。

## 下一步与限制

解锁后在同一飞书私聊重跑，核对审批中的快照与接收方，经过允许再验证真实附件出现、下载后字节一致及重启无重复。
在这些证据完成前保留附件工作流的未验收状态。一次只交付一个工作区内、非空且不超过 30 MB 的文件；
外发已开始后取消不能保证撤回。独立 holdout 的实际改进收益、完整恢复边界和同条件 Hermes 比较仍未由本轮证明。

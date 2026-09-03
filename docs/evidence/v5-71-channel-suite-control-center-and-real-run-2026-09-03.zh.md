# V5.71：渠道套件单页控制面与真实 AS-2 结果

日期：2026-09-03

## 目的

把“只安装渠道却没有配对/健康控制面”的真实安装缺口收口，并用最新可复现 DSH profile 验证只使用一个
DSH Web 页面。与此同时记录本轮真实飞书 AS-2 的终态；等待窗口没有新的陌生私聊，因此不得把本轮写成通过。

## 固定版本

| 项目 | revision / 版本 |
|---|---|
| DSH 最新远端审计 | `76fda729799fe9b3848dbe2c211d4b231032b81e`，`dsh-v0.1.2-rc.1-99-g76fda72979` |
| DSH 实际可复现测试基线 | `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`，`dsh-v0.1.2-alpha.5` |
| EvoForge 真实 AS-2 运行 revision | `fc132114315bfba008b7a38e354cda1827fa3de5` |

rc.1 的上游完整构建仍被根级 tsdown 入口错误阻断；本轮没有修改 DSH 上游，也没有把 rc.1 冒充为支持基线。

## 已落地

- `channels` 套件现在包含轻量 `dsh-control-center`、`dsh-gateway` 和所选 Adapter；`--channel feishu|telegram`
  也保留同一个 Control Center。它不带 `dsh-evolve`、`dsh-evolve-web` 或 `attention`，所以用户入口仍然精简，
  但渠道用户不再需要另装页面才能批准配对。
- AS-2 最终 tarball 现在安装 Control Center、Gateway 与 Feishu，并在卸载阶段一并移除 Control Center；profile
  dump 将其作为生效 Bundle 检查。
- `pnpm run pack:suite -- --suite channels --channel feishu` 生成 3 个官方 tarball（Control Center、Gateway、Feishu），
  没有第二 Runtime、网站或 CLI。

## 单页真实浏览器证据

在 DSH alpha.5 clean profile 安装上述 3 个 tarball，并用一个浏览器标签打开 DSH Web：

1. 关闭 DSH 首次声明与 API Key 引导，选择由原生 fixture 建立的 Session；
2. 点击原生 Session 的“控制台”标签，看到唯一的“控制中心 → 渠道” Surface；
3. 看到 Gateway 的就绪状态、授权渠道、入站/出站记录、待批准请求和飞书配对输入；
4. 点击“刷新状态”，再执行整页 reload，仍停留在同一个 Session 的“控制台 → 渠道”，Surface 和状态可读；
5. 全程只复用一个浏览器标签，没有打开第二个网页，也没有遮挡式固定对话框。

这证明渠道套件的安装和单页 UI 交互路径成立，不证明真实飞书事件、Provider 或 Hermes paired 通过。

## 真实 Feishu AS-2

本轮以显式真实渠道授权启动常驻 Gateway，最终 tarball 安装、profile dump 和官方 Feishu WebSocket 均成功：

```text
stage: awaiting-resident-pairing-request
finalTarballsInstalled: true
profileDumped: true
officialTransportReady: true
residentPairingGranted: false
reason: resident Gateway did not expose the exact pending Feishu request
```

等待窗口没有新的陌生私聊，所以未批准任何 principal，未进入 Agent，未发送挑战、回复、Command、Schedule、
Approval、notice 或重启后的外部效果。该失败是人工事件未到达，不是把失败吞掉；下一次真实运行必须使用新的隔离
run root，并重新完成完整 AS-2。

## 可复核命令

```sh
git -C ../deepseek-harness fetch origin --tags
pnpm run check:suites
pnpm run benchmark:feishu:as2:check
pnpm run pack:suite -- --suite channels --channel feishu --out <clean-directory>
```

## 发布结论

V5.71 只关闭渠道套件缺少单页控制面的产品装配缺口，并记录真实 AS-2 的严格失败。真实 Feishu 完整配对、
Approval、Schedule、重启、卸载、Session readback、两套真实 Provider、Hermes paired、长期负迁移/遗忘以及
全部发布门仍未通过；禁止创建首个 SemVer tag。

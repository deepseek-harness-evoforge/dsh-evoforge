# 真实插件状态副本与默认产品分包全量验证

- 日期：2026-09-14；EvoForge 起点 `8b499c80faf836bd79f129387b281efb8dcb1bc5`。
- DSH 已构建源码 c291e7961a515f6d7af9304e7fd1d257929aef26，clean，CLI 0.1.5-rc.2；
  本次重新 fetch 后 origin/master 仍为 c291。
- EvoForge 使用 `.rc2-dependency-build.AXa4EW` 独立 rc.2 依赖，正式支持声明没有变更。

## 实际状态副本

在私有临时目录 `.real-plugin-state.aZ0ZKP` 复制六个插件自有 JSON unit，不复制凭据或 profile。
只装载新版已构建的 Cordis、Storage、JSON backend 和 Domain facility，不装载 Gateway/Adapter/AgentLoop。
调用独立候选源码的六个正式 store open factory，通过实际 Domain facility 验证 schema，再逐表比较所有记录。
close 全部 store、dispose Context 后，用新 Context 重复同样检查。没有运行恢复发送、重试、配对批准或模型调用。

| Store | 验证记录数 |
| --- | --- |
| evolution v2 | Session pin 18；Generation 和 Workspace state 均 0 |
| gateway ingress v1 | 9 |
| gateway outbound v1 | 9 |
| gateway pairing v1 | 1 |
| gateway ingress evidence v1 | 6 |
| long-term effects v1 | 6 |

两次打开全部通过，逐条记录相等；六个原文件和六个副本的完整字节均未变化。没有将私有记录或正文写入 Git/输出。
本地执行：`node --import <c291-source>/node_modules/tsx/dist/esm/index.mjs <private-root>/probe.mjs`，exit 0。
首次探针误用不存在的 loader 路径，后又误将函数插件当 default export；修正为模块 namespace 后，
在新副本完成最终验证。前两次环境错误不是产品数据校验失败。

这证明现有插件 store 可读，不证明旧 receipt 经 Session 迁移后仍可匹配新坐标，也不证明 native Workspace/cache、
完整 profile、凭据、Agent 恢复或真实渠道效果。未把 schema 可读等同于安全发布。

## 本轮分包全量检查

在独立候选的各包目录，设置 `DSH_EVOLVE_DSH_SOURCE_DIR=<c291-source>` 执行
`node_modules/.bin/vitest run`；Feishu/Telegram 追加 `--maxWorkers 1`。

| 包 | 文件 | 测试结果 |
| --- | --- | --- |
| Control Center | 2 | 5/5 通过 |
| Doctor | 5 | 40/40 通过 |
| Evolution Web | 2 | 27/27 通过 |
| Telegram | 11 | 38/38 通过，17.24 秒 |
| Feishu（最终） | 22 | 61/61 通过，70.62 秒 |

Feishu 首轮 60 通过、1 失败，唯一失败为 package-contract 固定 alpha.5 字符串。
改成核对实际安装 Session/Tools/LLM 精确版本与 Tools/LLM peer、dev 一致；SDK、Gateway、无产品 bin、
无生产 DSH dependency 和默认关闭 patch 断言保留。只改这一份测试，未改生产实现或 skip。
主树旧依赖的该测试 1/1 通过；两套 Feishu 类型检查通过。候选 Control Center、Evolution Web、Telegram
类型检查也通过，Evolution Web 的前置 Evolve 构建和 artifact 校验通过。

结合此前当前环境的 Evolve 1012/1012 与 Gateway 136/136，默认七包均已分别完成全量测试；
不是一次统一套件运行，不代表生产/浏览器/真实渠道验收。文档及 diff 检查通过。
Mac 锁屏的真实浏览器验证限制尚未解除，本轮没有再次声称界面验收。日常 Host、授权、凭据与历史未改变。

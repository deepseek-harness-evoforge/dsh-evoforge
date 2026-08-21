# V5.6 飞书内容就绪权威投影与 DSH Web

> 日期：2026-08-21；固定 DSH revision：`47f943859bef60e4160492346772ded9b24f765a`；状态：最终 tarball 浏览器门已通过；真实飞书平台授权 pending

## 本增量交付

按 [ADR-0091](../adr/0091-feishu-content-readiness-is-host-authoritative.md)，`dsh-feishu` 的 `/feishu`
健康协议升级为 V2。Host 对当前 route Session 读取四项部署权限、精确 Agent 的
`feishu_content_read` registry、原生 Approval seam 和 request header，区分：未配置、当前 DSH 就绪、
仅未来 Session 生效、Approval 不可用和 Tool 不可用。已配置但不可执行会让总健康进入 `attention`。

快照只含权限名称/布尔值、Tool/Approval 可用性和配置上限；`platformAccess` 固定为 `not-verified`。
刷新不调用模型或飞书平台，不探测资源 token，不新增 Gateway 内容 API、Remote、存储或配置菜单。
DSH Web 逐项显示四权限、原生 Tool/Approval、字符/记录上限和平台未探测说明；V2 parser 对权限顺序、
计数、状态组合和数值范围 fail closed，读取失败会清除面板旧快照。

## 自动化证据

- `health.test.ts` 固定 V2 完整投影、`approval-unavailable`/`future-session-only` 的 `attention`、旧 V1
  拒绝、脱敏和原生 Command round-trip；
- `pairing-action.client.test.tsx` 固定四项权限、DSH 就绪、平台未探测提示，以及首次失败→刷新恢复→再次
  失败必须清空旧状态；
- `dsh-assembled-content.e2e.test.ts` 在真实 DSH Boot/Agent/ToolRuntime/Approval/Gateway 中证明当前 exact
  Agent 为 `ready`，四权限、Tool、Approval 与 `modelCalls=0` 均来自 Host；无内容权限的 assembled chat
  明确为 `disabled`；
- Client Module 包合同锁住 `EVOFORGE_FEISHU_HEALTH_V2` 和未来 Session/权限文案进入发布 bundle。

完整 `dsh-feishu` 当前为 `17/17` test files、`48/48` tests，并通过 typecheck/build。

## 最终 tarball 真实浏览器

重新打包 `dsh-gateway-0.1.0-alpha.1.tgz` 与 `dsh-feishu-0.1.0-alpha.1.tgz`，通过官方
`dsh plugin --profile web add` 安装到测试自有全新 profile。外部飞书网络由 test-only fake transport
替代；为让 DSH 激活同包 Client Module，验收 profile 只把包默认 Host 入口替换为空激活壳，产品 Host
逻辑仍显式导入安装包内未改动的 `dist/index.mjs`，浏览器仍加载未改动的 `dist/client.js`。两文件与最终
tarball 的 SHA-256 分别完全相等：Host `a742f212…d1e3`，Client `1061b973…3b6`。激活壳不进入仓库或发布包。

真实 DSH Web 浏览器完成：

1. exact route Session 侧栏出现唯一“飞书健康”，打开后显示 `cli_browser_health`、route、WebSocket、
   文档/多维表格已启用、Wiki/Drive 未启用、原生 Tool/Approval 可用、`20000`/`20` 上限和平台未探测；
2. 面板 DOM 不含测试 App secret、chat id 或 user id，模型调用为 0；人工刷新时间前进；
3. 停止独立 Host 后点击刷新只显示 `Failed to fetch`，旧 App、route、DSH 就绪和权限行全部从面板清除；
4. 同端口重启 Host，页面不 reload，再次人工刷新恢复完整 `DSH 就绪`；浏览器 console error 为 0，故障
   窗口只有 DSH connection retry warning；
5. 浏览器截图发现四列指标过密后改为三列，重打最终 tarball，并在该最终构建上重新执行刷新、失败清空和
   无 reload 恢复，结果再次通过。

## 未完成声明

本门没有调用真实飞书内容 API，不证明 App/tenant scope、资源成员权限、真实内容、真实权限拒绝或真实用户
审批。它也不替代 exact route 用户消息、多日重连、两套真实 provider 或 Hermes paired benchmark；因此
飞书 Adapter 和整体 v0.1 仍是 `implemented`，不得创建发布 tag。

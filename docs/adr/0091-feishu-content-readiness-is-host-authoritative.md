# ADR-0091：飞书内容就绪状态来自当前 Session 的 Host 权威

- 状态：accepted
- 日期：2026-08-21
- 关联：[ADR-0090](0090-feishu-content-reads-are-agent-scoped-native-tools.md)、[ADR-0049](0049-channel-adapters-share-one-thin-dsh-gateway.md)
- 固定 DSH revision：`47f943859bef60e4160492346772ded9b24f765a`

## 背景

V5.5 已实现四项独立内容权限和一个 Agent-scoped 原生 Tool，但部署配置不等于当前 Session 真正可用：
已有 request header 可能固定了旧 Tool schema，ToolRuntime 或 Approval 也可能未组合。只展示配置会把“未来
Session 才生效”误报为当前可用；为健康检查主动调用飞书又会产生平台访问、审批和外部副作用。

## 决策

1. `/feishu` 健康协议升级为 V2。内容投影只读取部署配置、精确 Session 当前 Agent、Agent-scoped Tool
   registry、原生 Approval seam 和 request header，不调用模型或飞书平台，也不进入 `dsh-gateway`。
2. 四项权限按固定顺序逐项展示，并给出 `disabled`、`ready`、`future-session-only`、
   `approval-unavailable`、`tool-unavailable` 五种状态。已配置但当前不可执行时，Host 总状态进入
   `attention`；未配置内容能力不影响渠道健康。
3. `future-session-only` 只表示当前 request header 没有 `feishu_content_read`、配置的新能力将在未来
   Session 生效。当前 Session 不重写 schema；权限撤销仍由执行门拒绝。
4. 平台授权固定投影为 `not-verified`。健康读取不得用资源 token 探测 App scope、tenant 或资源成员权限；
   只有获批的真实 Tool 调用能得到飞书的最终授权结果。
5. DSH Web 继续只调用当前 Session 的原生 `/feishu` Command，不增加 Remote、配置菜单或后台轮询。
   Client 严格解析 V2、限制数组和数值边界；刷新失败必须清除旧快照，不能保留历史 `ready`。

## 后果

- 操作者能区分“配置已开”“当前 Session 有 Tool”“Approval 可用”和“平台尚未验证”，不会把配置当能力。
- 健康面不扩大飞书权限、不改变当前 Session、不增加模型请求，也不让 Gateway 理解内容业务。
- assembled fake transport 和真实浏览器可以验证 DSH 组合、失败与恢复，但仍不能替代真实飞书 App scope、
  资源权限拒绝、真实内容、真实用户审批或长期运行证据。

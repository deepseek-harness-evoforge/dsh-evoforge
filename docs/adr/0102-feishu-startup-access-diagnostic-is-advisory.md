# ADR-0102：飞书启动配置诊断只读且仅作提示

- 状态：accepted
- 日期：2026-09-04
- supersedes：ADR-0091 中“平台授权固定为 not-verified”的实现约束；保留其 Session/Tool/Approval 权威边界
- 固定 DSH 审计基线：`76fda729799fe9b3848dbe2c211d4b231032b81e`（rc.1）与可构建支持 checkout `db6bdc…`（alpha.5）

## 背景

真实 Feishu AS-2 曾出现“官方 WebSocket 已 `ready`，但没有 pending pairing”的长时间等待。一次性维护者
诊断已证明 App 凭据有效，并发现事件订阅读取 API 因缺少 `event:subscription:read` 而无法检查；但把这一
检查留在外部脚本会让普通用户只能等到验收超时，无法在 DSH Web 看见配置边界。另一方面，健康刷新不能每次
主动访问飞书，更不能把 API 可访问误报为已经收到 `im.message.receive_v1`。

## 决定

1. `dsh-feishu` 在官方 Adapter 成功建立 WebSocket 后最多执行一次启动期、只读的 App 诊断：读取机器人身份
   已解析事实、消息收发必需 scope，以及（仅当 App 有 `event:subscription:read` 时）事件订阅读取 API。
2. 诊断只返回固定枚举、scope 名称、布尔值和时间；不返回 App Secret、tenant/chat/user/message/resource
   标识、响应正文或 token。诊断失败不会拆掉已建立的 Adapter；缺少消息必需权限才进入 `attention`，事件订阅
   无法读取则保持 `not-verified` 并明确提示开发者后台确认。
3. 诊断结果作为同一 V2 `/feishu` 健康快照的可选 Host 事实，浏览器只解析已有快照，不发起平台请求，不调用
   模型，不新增 Remote、Gateway、Session、状态库或网页。旧/自定义 Adapter 可以省略该字段。
4. `eventSubscription: verified` 只证明读取 API 可访问，不证明目标事件已订阅或已经有入站事件；`lastInboundAt`
   和 Gateway pending projection 仍是事件到达的唯一运行时事实。真实 AS-2 仍必须由人工发私聊完成。

## 后果

- 用户在同一个 DSH 控制面可区分“WebSocket 已连接”“消息 scope 缺失”和“事件订阅尚未验证”，减少无证据等待。
- 该诊断不会改变权限、路由、Session、外部效果或当前 Session schema；它不替代飞书开发者后台配置和真实消息验收。
- 浏览器 bundle 不依赖 Node-only Feishu SDK；平台探针实现留在 Host Adapter 边界，保持 DSH 官方 Web 单页结构。

## 验证

- `inspectFeishuPlatformAccess` 覆盖全 scope、事件读取、缺少 scope 和异常边界；健康快照覆盖可选字段的解析、
  枚举校验和向后兼容。
- `dsh-feishu` 全量回归、typecheck 和 build 必须通过；真实 AS-2 的既有失败证据不能因诊断显示而改写为通过。

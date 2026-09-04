# V5.172：飞书启动期只读配置诊断

> 日期：2026-09-04。范围：把真实 AS-2 已知的“凭据有效、WebSocket ready、事件订阅无法由 API 验证”事实
> 变成 `dsh-feishu` Host 健康快照中的脱敏可见状态；不改变配对、Session、Gateway 或发布门。

## 真实平台事实

使用此前明确授权的飞书 App 凭据执行只读 HTTP 检查，未执行权限申请、订阅修改、消息发送或资源读取：

- tenant token HTTP `200`、`code=0`；Bot info HTTP `200`、`code=0`。
- App scope 列表 HTTP `200`、`code=0`，返回 36 项；消息接收与发送所需的两个 transport scope 均为已授权。
- `GET /open-apis/event/v1/subscriptions` 返回 `code=99991672`，原因是 App 未开通
  `event:subscription:read`。这只能说明订阅读取 API 当前不可检查，不能证明目标事件已关闭或已开启。
- 输出、仓库和证据没有保存 token、App Secret、App ID、tenant/chat/user/message/resource 标识或消息正文。

## 实施

- `dsh-feishu` 官方 SDK Adapter 在 WebSocket 成功后执行一次可选 `inspectFeishuPlatformAccess`；只返回固定
  status、时间、机器人身份是否解析、两个必需 scope 布尔值、事件订阅 API 可达性和固定原因枚举。
- 缺少消息必需 scope 显示 `attention`；缺少事件订阅读取 scope 显示 `not-verified`，不会拆除已连接传输。
- 健康快照保留 V2 兼容性，可选携带 `platformAccess`；浏览器只解析 Host 已有快照，不在刷新时调用飞书。
- 控制面在原有“连接与路由”区显示诊断实体和技术详情；没有新增网页、Remote、Gateway、状态库或模型调用。
- ADR-0102 记录该诊断为何是 advisory，以及为什么 `eventSubscription: verified` 也不等于目标事件已订阅。

## 验证

开发前重新 fetch canonical DSH：`origin/master` 为 `76fda729799fe9b3848dbe2c211d4b231032b81e`、clean，最新 tag
为 `dsh-v0.1.2-rc.1`；EvoForge 仍只在 `main` 工作。已审计 alpha.5 支持 checkout 继续用于完整插件回归。

| 检查 | 结果 |
| --- | --- |
| `inspectFeishuPlatformAccess` 全 scope/事件读取/缺失/异常测试 | 3/3 通过 |
| Feishu health + platform 定向测试 | 12/12 通过 |
| `dsh-evoforge-feishu` 全量测试 | 50/50 通过（18 个测试文件） |
| `dsh-evoforge-feishu` typecheck | 通过 |
| `dsh-evoforge-feishu` build | 通过；Web client 约 36 KB，未捆绑 Node-only SDK |
| 真实外部检查副作用 | 0（只读） |

该增量只提升诊断可见性，不关闭 `real-feishu-as2`：仍需真实陌生私聊、Host 审批、回复、Schedule、Approval、
重启、卸载和 Session readback 的完整 terminal evidence。

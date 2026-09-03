# V5.103：渠道控制面轮询契约与用户文档对齐

日期：2026-09-04  
EvoForge：`main`  
范围：`docs/getting-started.zh.md`、`packages/dsh-feishu/README.md` 与 `dsh-gateway` Control Surface

## 发现

Control Center 的 `GatewaySurface` 为了在不打开第二个网页的情况下显示新的配对请求，按 5 秒间隔调用
Host `pendingPairings()`。它只读取 Gateway 已脱敏的 pending projection；完整 Gateway snapshot 仍在打开页面或
用户点击“刷新状态”时读取。该实现不会调用飞书 API、轮询消息、读取凭据、读取正文或调用模型，轮询失败会保留
最后一次 pending 快照。

飞书用户 README 和开始使用文档此前仍写着“没有浏览器后台轮询”，与真实实现冲突，容易让用户误以为页面不会自动
发现待批准请求。本轮只修正用户契约文字，未改变运行时轮询频率、Host 权威、单页布局或状态存储。

## 修正与验证

- 明确区分“Host 脱敏 pending 低频只读轮询”和“平台消息/健康主动探测”；
- 保留失败时最后快照、手动完整刷新和不调用模型的语义；
- `pnpm run check:docs` 通过，`git diff --check` 通过；
- 未新增网页、Router、Gateway、Session、Goal、数据库或凭据读取。

该修正只消除文档误导，不提升真实飞书 AS-2、Provider、Hermes paired、长期效果或发布 tag 门。

# 原生工作区索引与缓存的隔离升级验证

- 日期：2026-09-14；EvoForge 起点 `956bb6d4b515832b2390eceea27752790d128e64`。
- 旧版：db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5；新版：c291e7961a515f6d7af9304e7fd1d257929aef26。
- 两边使用各自已构建的原生 Cordis/Storage/Session/Workspace 模块，没有修改 DSH 源码。

## 数据与权限边界

在私有 `.native-state-upgrade.Kh0a25` 中复制 sessions 和可读 Storage 文件，不复制 profile、settings 或凭据。
一份 `session_projcache` 派生缓存文件属 root、mode 600，当前用户读取返回 EACCES。
没有提权、改 owner/权限或读取该文件；副本不包含它，按官方“不可读缓存视为缺失、从日志重建”的契约验证。
该文件只记录权限、owner、长度、mtime 元数据，不能对其正文作字节未变的证明。

全部可读源文件在前后进行 SHA-256 比较，保持不变；不可读文件的上述元数据保持不变。
没有启动第二 Host、AgentLoop、模型或渠道连接，没有对生产数据执行缓存重建。

## 验证步骤

1. 旧版原生 WorkspaceRegistry 在副本启动，记录工作区及可见 Session 的完整有序索引摘要。
2. dispose 后改由新版原生模块读取同一副本，验证完整有序索引摘要相同。
3. 新版注册官方 title projection，启动原生 SessionProjectionCache；对 18 份日志执行官方只读迁移，
   再通过 `coldSnapshot` 从完整逻辑日志取得标题投影。投影内容只做摘要比较，不输出正文或标题。
4. dispose 后新建 Context：若缓存有可用 title 值则直接比较；未命中则再次从日志重建并比较。
5. 检查原始目录中可读文件的摘要及不可读缓存文件元数据没有变化。

本地命令 `node <private-root>/probe.mjs` 最终 exit 0，结果：

| 环境/阶段 | 工作区 | 可见会话 | 标题投影 |
| --- | --- | --- | --- |
| alpha.5 原生索引 | 5 | 13 | 基线索引 |
| rc.2 首次读取 | 5 | 13 | 18 份日志重建；旧缓存直接命中 0 |
| rc.2 Context 重新打开 | 5 | 13 | 4 份缓存命中、14 份日志重建；全部与首次投影一致 |

13 是两版原生索引当前可见数，18 是持久日志文件数；不能把这两个数量混为一谈。
此验证是 Context 关闭/重建，不是完整 OS 进程、profile 或浏览器重启。

## 正确解释缓存结果

当前 Workspace domain 仍为 v2。Projection cache 是 v7 per-record，接受 v3–v6 的结构兼容记录，
但不让缺失/旧 Session format 身份的 checkpoint 直接用于新格式 hydration。
`coldSnapshot` 的写回是 fail-soft/fire-and-forget，`cachedSnapshot` 也允许没有可用键时返回 undefined。
初版探针误把立即读取当作写回完成，并要求重开后全部缓存命中，因而失败；这不是历史丢失证据。
最终按公开契约核对返回值：可用缓存必须正确，缺失时原生日志重建必须得到同一投影。
没有把 14 次 fallback 称为 14 次缓存命中，也没有以派生缓存证明原始历史已可完整恢复执行。

## 部署边界

现有真实 Session、插件 Store 和原生索引/标题读取的隔离证据已具备；这仍不证明完整 profile、
凭据解析、真实 Web/飞书执行与回滚后外部效果一致。生产 Host 保持 alpha.5，本轮没有部署变更。
真实浏览器操作仍需解除此前观察到的 Mac 锁屏限制；不以这些后端检查代替页面验收。

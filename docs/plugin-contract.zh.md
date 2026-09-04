# DSH 原生插件契约

本文是 EvoForge 包级实现的当前最低要求。具体 DSH API 必须以每轮开发前审计的上游 revision 为准，不能从旧
evidence 或历史源码链接推断。当前版本身份见 [DSH 最新审计](research/dsh-latest-audit-2026-09-05.zh.md)。

## 1. 交付形态

每个运行组件必须是可由 DSH 官方 Loader 安装的 out-of-tree Cordis Bundle；需要浏览器时，通过 DSH Client
metadata 注册模块。包必须提供：

- `package.json` 中明确的 name、version、license、repository、exports、files 和 peerDependencies；
- 根级 `cordis.patch.yml`，只插入本包拥有的稳定 row；
- Host 入口 `default export Service`；Client 包提供 DSH 认可的 client metadata；
- 不发布额外 Agent executable、第二 Host、第二 Web server 或隐式安装器。

能力套件只把多个真实 Bundle 编排成一个用户结果，不是 Meta Runtime。默认产品和兼容入口见
[能力套件](capability-suites.zh.md)。

## 2. DSH 权威

插件不得复制或替代 DSH 的 Agent、Session、Goal、Skill、Tool、Approval、Jobs、Schedule、Workspace、Credential、
Storage 或生命周期。确需状态时，使用 DSH Storage 提供的 namespaced domain，并保留清晰的 owner、scope、schema、
恢复和卸载语义。

跨包依赖通过 Cordis Service Definition/inject 表达，不能靠全局变量、固定启动顺序、端口探测或扫描其他包的
私有目录。可选 Provider 出现/消失时，Consumer 必须正确 activate/dispose。

## 3. 生命周期

所有 listener、timer、watcher、transport、Remote、临时目录和文件句柄都由当前 fiber 持有。disable、reload、
dispose 或 remove 后必须：

1. 停止接收新工作；
2. 有界 drain 已接收工作或明确标记 uncertain；
3. 取消订阅并释放资源；
4. 不再写状态、发消息或更新 UI；
5. 不删除 DSH 原生数据，也不宣称撤回已发生的外部效果。

异步启动和卸载并发必须可重复测试；后台 Promise 不能在 dispose 后产生未捕获 rejection。

## 4. 模型与 KV Cache

每个包要声明自己是否增加 Tool、Skill、System Prompt、Session event 或模型调用。只读 Host/Web/诊断组件应保持
零模型调用和零模型可见 token。需要模型可见内容时：

- 只通过 DSH 原生 Session/Skill/Tool seam；
- 固定 schema 和稳定前缀，不把时间戳、随机 id 或动态健康状态写进 system prompt；
- 记录 cache-read、uncached input/output、延迟和组成差异；
- 卸载后模型组成恢复，不能残留 Tool/Skill/Prompt。

## 5. 权限、凭据与外部效果

凭据只保存和解析于 DSH CredentialProvider；配置中只允许引用名。不得把 Secret 放进 profile YAML、Git、日志、
Session、Web projection 或 evidence。

代码修改、profile 写入、OS service、付费 Provider 和外部发送属于 Protected Action。由 Agent 发起时服从 DSH
Tool policy/Approval；人在 shell 中直接执行属于部署者权限，不能伪称经过 Agent Approval。外部效果必须先写
durable intent，使用确定性 identity；结果未知时保留 uncertain，不能盲目重试。

## 6. Web

EvoForge 只注册一个 Session-scoped 原生 `conversation.view`。Control Center 提供 child slot，各业务包贡献自己的
Host-authoritative projection。Client 不保存第二份真相、不直接写 Generation、不显示 Secret/正文/私有路径，必须
实现 loading、empty、stale、error、retry 和权限拒绝状态。空 Session/onboarding 不渲染 slot 是 DSH 边界，不能用
固定浮层或第二网页绕过。

## 7. 安装、更新与卸载

公开 registry 尚未发布时，只允许使用仓库安装器生成并校验的 exact tarball。DSH 对本地 `file:` 依赖会持续引用
原路径，因此产物必须先进入持久内容地址，不能安装后删除。安装器不得回显 effective config。

每个可发布组合必须从 clean profile 验证：

```text
add → list/dump → boot → real Session path → reload/dispose → remove → boot/readback
```

验证还要覆盖部分安装失败、重复安装、缺失凭据、Host 重启、依赖消失和卸载顺序。通过 unit test 或生成 tarball
本身不等于完成原生插件合同。

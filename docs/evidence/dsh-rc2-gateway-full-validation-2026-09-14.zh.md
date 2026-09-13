# Gateway 新版全量检查与部署状态盘点

- 日期：2026-09-14；EvoForge 起点 `9361c31b49d02492f63fd0878d4d01427695dee1`。
- 独立 rc.2 依赖副本 `.rc2-dependency-build.AXa4EW`，源码目标 c291e7961a515f6d7af9304e7fd1d257929aef26。
- 旧版回归使用主树 alpha.5 依赖与 db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5 源码。

## 当前部署盘点

只读检查确认产品 profile 安装 7 个 Bundle，Gateway 使用单独更新的持久 tarball，其他包来自 product pack。
升级不能假定当前安装是一个未发生变化的统一 pack。启动包装器仍指向 alpha.5。
持久化聚合计数（未输出记录内容）：Evolution v2 有 18 个 Session pin、零 Generation/Workspace state；
Gateway ingress v1 有 9 条，outbound v1 有 9 条，pairing v1 有 1 条，ingress evidence v1 有 6 条；
long-term effects v1 有 6 条。只核对版本与计数，未因此宣称新版已完成这些真实记录的 schema/readback 验收。

浏览器实测尝试被 Mac 锁屏阻止，已请求解锁；没有伪造截图或改用不可见的界面状态宣称体验通过。

## 红灯与定位

在独立副本 Gateway 包目录，以 `DSH_EVOLVE_DSH_SOURCE_DIR=<c291-source>` 执行
`node_modules/.bin/vitest run`：最初 136 项中 63 失败、73 通过，另有 1 个未捕获 rejection。
将分发测试缩小到 physical enqueue 用例，5 毫秒稳定失败于 native Session 构造：
`session header version must be 3, got 0`，尚未进入 Gateway 路由。

三个可证伪方向是固定旧 header、依赖/源码版本不一致、Gateway 新事件处理不兼容。
仅改固定 header 后分发测试从 8 项失败降为 1 项：剩余错误为已移除的 `Inbox` 构造器。
其他两份测试采用当前 native format 后 88/88 通过；未修改生产的严格 header 校验。

## 测试修复

三份测试的 live fixture 使用 `SESSION_FORMAT_VERSION`，不把历史文件改写成新版。
alpha.5 保留其公共 Inbox 构造路径；rc.2 通过官方 `agent-loop-testkit` 创建生产 Agent 和真实 Inbox，
使用其 append/claim 操作，仍验证精确的入队→turn/start→移除顺序与 Gateway evidence match。
rc.2 所需 preset 由原生 `agent-preset/selected` 事件提供并明确断言，未忽略任意前缀。
Context 由 afterEach dispose，不引入常驻 Host 或渠道连接。没有用 testkit 的内存 Inbox stub 代替持久化语义。

异步取消测试复用原有 fixture list 返回值，不再给当前 snapshot 签名强塞 header 数组类型；
错误版本负例继续传入 version 1，并用显式测试对象变异避免将非法输入声明为合法原生类型。
未放宽生产 schema、添加 skip 或修改正式支持范围。

## 最终验证

两套环境 Gateway 包目录先执行 `node_modules/.bin/tsc --noEmit -p tsconfig.test.json`，均 exit 0；
再设置对应源码环境变量执行完整 `node_modules/.bin/vitest run`：

| 环境 | 结果 |
| --- | --- |
| rc.2 独立依赖 + c291 | 11 文件、136/136 通过，1.18 秒，无未捕获错误 |
| alpha.5 依赖 + db6 | 11 文件、135 通过、1 个既有 current-only 用例跳过，0.96 秒 |

主树文档检查与 diff 检查通过。此为 Gateway 全量与测试适配证据，不是跨渠道真实收发效果或生产部署证据。
生产 Host、profile、凭据、授权和历史没有修改；完整目标仍需实际 Web/飞书路径及受控部署验证。

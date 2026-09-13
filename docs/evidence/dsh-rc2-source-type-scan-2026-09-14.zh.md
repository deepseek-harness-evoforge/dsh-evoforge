# rc.2 首轮源码类型阻断清零

- 日期：2026-09-14；EvoForge 起点 `448933b`。
- 本轮 fetch 后 canonical HEAD / origin/master 仍为 clean `c291e7961a515f6d7af9304e7fd1d257929aef26`。
  复用此前安装与构建产物，不修改上游。

## Feishu 最后两项

Control Center 提供原生选中 Session 的 wire id，但通用 surface props 将其声明为 string；新版 command
API 参数是 branded SessionId。两个调用点显式标记该类型，Host 的 id 校验、命令授权、配对边界、错误处理
与旧/新 execute 参数适配均未改变。此类型标记不验证 id，也不授予权限。

修改前 current `tsc --noEmit -p packages/dsh-feishu/tsconfig.json` 报两个 TS2345，修改后通过。
使用 TypeScript transpileModule（ES2022 / ESNext / ReactJSX / removeComments）比较修改前后的
FeishuAction.tsx JavaScript，SHA-256 均为：

```text
7d5d20467257a73ae696b9601509470311247c04243acfb794f90425e31fb727
```

这证明该组件发出的 JS 没变，不是整个 bundle 或 sourcemap 的字节比较。
原工作树包 typecheck、build（包括 Typert 和 Node artifact 检查）通过；组件和 client-module 两文件
9/9，在隔离 current runtime aliases 下也为 9/9。测试覆盖既有 UI 逻辑，不是真实飞书 API 验收。

查看原有 DSH Web 页仍是原生新会话界面、原工作区、标准模式和 gpt-5.6-sol；没有发送任务、改凭据或
切换 profile。此次没有新的运行时 UI 行为需要发布，也未将这些检查声称为 rc.2 浏览器部署验收。

## 全部 12 项源码配置复验

沿用[首轮扫描方法](dsh-rc2-type-migration-2026-09-14.zh.md)，在隔离源码副本中对每个
`packages/<package>/tsconfig.json` 重新运行 `tsc --noEmit -p <config>`，使用 491 项 current 类型映射。
此前各轮已通过的包没有直接沿用历史结果。

| 包 | exit code |
| --- | --- |
| dsh-control-center | 0 |
| dsh-doctor | 0 |
| dsh-evolve | 0 |
| dsh-evolve-attention | 0 |
| dsh-evolve-web | 0 |
| dsh-feishu | 0 |
| dsh-gateway | 0 |
| dsh-github-review | 0 |
| dsh-goal-continuity | 0 |
| dsh-resident | 0 |
| dsh-software-delivery | 0 |
| dsh-telegram | 0 |

结论是这些 **tsconfig.json 配置**全部通过，而不是每个独立测试配置或全部发布门通过。
副本仍复用开发工具链及包间构建产物；完整 current peer/dev 安装、lockfile、测试夹具迁移、CI、
官方 add/dump/boot/reload/dispose/remove/readback 和实际产品升级仍未闭合。
正式 Host、支持版本、用户历史和凭据未变；不能将源码类型检查通过等同于可以安全升级用户数据。

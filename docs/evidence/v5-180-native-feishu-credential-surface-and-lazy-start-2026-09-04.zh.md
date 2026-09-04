# V5.180：飞书原生凭据页面与常驻 Adapter 延迟启动

> 日期：2026-09-04。范围：把飞书 App ID/Secret 的配置接入 DSH 官方原生凭据 Remote，并修复凭据尚未配置时整个 DSH Host 被 Adapter 启动失败拖垮的问题。

## 结论

本增量已把 `dsh-evoforge-feishu` 的凭据配置放进原生 DSH Web 控制面。页面只调用 DSH `remote.credentials.describe/set`：`describe` 只返回
`configured/source/writable` 等元数据，输入值只写入 Host，页面和日志不回显 Secret。保存任意一项后，Host 接收官方
`credentials/reference-updated` 事件，销毁旧连接并尝试唤醒同一个常驻 Adapter；当前 Session 不被迁移或重建。

未配置凭据现在是一个可观察的 fail-closed 渠道状态，而不是 Host 级启动失败。Gateway、Session、Goal 和其他插件仍可启动；飞书 Adapter
保持未就绪，直到两个引用都能由 DSH CredentialProvider 解析。非法配置、路由不一致和其他结构错误仍然阻止该 Bundle 启动，避免把真正的配置错误吞掉。

## 开发前基线

- 开发前重新 fetch canonical DSH：`origin/master` = `76fda729799fe9b3848dbe2c211d4b231032b81e`，`dsh-v0.1.2-rc.1-99-g76fda72979`。
- EvoForge 支持运行时仍锁定已审计的 DSH alpha.5 checkout `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`；canonical rc.1 根级 tsdown 入口缺陷继续单独记录，没有被本增量掩盖。
- 用户 `web` profile 已从易失 `/tmp` 包迁移到持久 `.evoforge/packs` 包路径；Feishu/Gateway Bundle 使用 DSH 官方 credentials provider，不再由 Adapter 直读 `process.env`。

## 代码变化

1. `packages/dsh-feishu/src/client/FeishuAction.tsx` 增加单页凭据区：状态徽标、App ID/App Secret 写入框、写入中/成功/失败反馈和 write-only 提示。表单不读取或保存旧值。
2. `packages/dsh-feishu/src/client/index.ts` 通过已存在的 DSH `remote.credentials` 注入凭据能力；没有新建网站、Router、Session 或第二套凭据库。
3. `packages/dsh-feishu/src/index.ts` 注册一次动态 `evoforge.feishuRoute` façade。Cordis 服务仍是单一实例，凭据轮换只替换内部 `FeishuRuntime`，避免重复 `ctx.provide`；缺失/非法解析值时保留 Host，配置成功后由官方事件触发重试。
4. `packages/dsh-control-center/src/client/style.ts` 仅补充密码输入的展示样式，沿用 DSH 原生 Control Center 表面。
5. 测试覆盖：表单写入两个原生引用且不渲染 Secret；原有 Feishu config、runtime、assembled、package-boundary 和生命周期测试继续纳入全量检查。

## 验证记录

以下命令在上述 alpha.5 支持 checkout / 当前 `main` 工作树执行：

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter dsh-evoforge-feishu exec vitest run test/feishu-action.client.test.tsx test/config.test.ts --maxWorkers 1` | 通过：2 files / 10 tests |
| `pnpm --filter dsh-evoforge-feishu run typecheck` | 通过 |
| `pnpm --filter dsh-evoforge-feishu run build` | 通过；client CJS gzip 10.70 kB，Host ESM gzip 20.85 kB |
| `pnpm run pack:suite -- --suite channels --channel feishu --out .evoforge/packs` | 通过；生成 Gateway/Feishu/Control Center 三个包 |
| `DSH_EVOLVE_DSH_SOURCE_DIR=/private/tmp/evoforge-dsh-latest.qPqo1d pnpm run check` | 通过，`CHECK_RC=0`；Feishu 18 files / 52 tests，全仓 Bundle、类型、测试、构建、clean-profile 和发布合同均完成 |
| `git diff --check` | 通过 |

### Host 启动边界

在修改前，最新 DSH 使用同一用户 profile 启动时会因 Feishu 两个引用为空而在 plugin tree 阶段失败，Gateway/Web 也随之无法使用。
修改后用同一 profile、同一 alpha.5 运行时启动 `dsh --profile web --no-open --port 3083`，Host 成功监听；飞书 Adapter 保持等待凭据的安全状态，未输出
App Secret，也未发出平台消息。这个结果验证的是 Host 不再被缺失可选渠道拖垮，不等于真实飞书连接或外部消息验收通过。

### 浏览器边界

当前运行的 DSH Web 使用一个页面、无新增窗口；刷新和新建原生 Session 的基础壳层可用。由于该临时启动的 cwd 与已有 Control Center 历史 Session
存储根不一致，本轮没有把 Feishu 表单误记为“真实浏览器点击通过”；表单交互由 jsdom 测试覆盖，原生 Control Center 单页的真实浏览器证据沿用
V5.173 的已记录结果；必须在同一 profile、同一工作区 Session 中补做输入、保存、刷新和 Adapter 恢复。

## 安全与未通过门禁

- 本增量没有把用户提供的 App ID/Secret 写入仓库、profile、日志或证据文件，也没有连接真实飞书、发送消息或读取平台资源。
- 未配置值不会让 Adapter 伪造 ready；动态重启只影响未来连接，当前 Session 仍保持 DSH 原生版本。
- 真实 Feishu AS-2、Telegram AS-1、Provider paired、Hermes 同条件 paired benchmark、长期重连/负迁移、npm namespace 和首个 SemVer tag 仍未通过，发布门禁继续为 `blocked`。

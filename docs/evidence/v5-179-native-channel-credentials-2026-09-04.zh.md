# V5.179：渠道 Adapter 接入 DSH 原生 CredentialProvider

日期：2026-09-04

## 目的

修复开源安装的真实阻断：飞书和 Telegram 原先分别从 `process.env` 读取秘密，无法使用 DSH 官方凭据服务，
也无法由常驻 Host 的 Web 凭据设置管理。此次只改变秘密读取边界，不把真实密钥写入仓库或证据。

## 实施

- Feishu 注入 `credentials`，`resolveFeishuConfig`/`resolveFeishuPairingConfig` 异步解析两个 credential
  references；缺少、空、未修剪或含控制字符的值 fail closed。
- Telegram 注入 `credentials`，新增 `resolveTelegramToken`，静态和 pairing 两条启动路径统一经
  `ctx.credentials.resolve(credentialRef(tokenEnv))` 获取 token；Adapter 源码不再读取 `process.env`。
- 保留 `appIdEnv`、`appSecretEnv`、`tokenEnv` 作为兼容字段名，但文档明确它们是 credential reference；新增
  `@deepseek-ai/dsh-credentials@0.1.2-alpha.5` peer/dev 依赖。
- package-boundary 测试增加最小 credentials seam，证明 packed Telegram Bundle 在无环境 token 时仍能启动；
  Feishu assembled fixture 增加官方 `credentials` 注入，避免测试树把真实契约误判成环境变量契约。
- 用户 README 改为 DSH Web/官方 `$DSH_HOME/.credentials.yaml` 配置路径，并将渠道安装 tarball 改存到持久的
  `.evoforge/packs`，不再建议 profile 依赖易失的 `/tmp` 路径。

## TDD 与失败证据

先在 Telegram 保护路由测试加入 `resolveTelegramToken` 的红测，再实现 seam。第一次 assembled 组合验证暴露了
真实 package-boundary 缺口：packed Telegram 运行时因 peer `@deepseek-ai/dsh-credentials` 未在测试 profile 中
提供而失败，错误为 `ERR_MODULE_NOT_FOUND`；补齐官方模块 seam 后同一测试通过。这不是放宽断言或改回环境读取。

## 验证

命令（均在仓库 `main` 工作树，DSH source 固定为上述 alpha.5 checkout）：

```sh
pnpm --filter dsh-evoforge-telegram exec vitest run --maxWorkers 1 test/protected-route.test.ts
pnpm --filter dsh-evoforge-telegram exec vitest run --maxWorkers 1 \
  test/pairing-assembled.e2e.test.ts test/dsh-assembled-chat.e2e.test.ts \
  test/package-install-remove.e2e.test.ts
pnpm --filter dsh-evoforge-telegram test
pnpm --filter dsh-evoforge-telegram typecheck
pnpm --filter dsh-evoforge-telegram build
pnpm --filter dsh-evoforge-feishu test
pnpm --filter dsh-evoforge-feishu typecheck
pnpm --filter dsh-evoforge-feishu build
```

结果：Telegram 保护路由 `5/5`；assembled/package boundary `3/3`；Telegram 全量 `9 files / 35 tests`；Feishu
全量 `18 files / 51 tests`；两包 typecheck/build 均通过。此前已有的 alpha.5 全仓 `CHECK_RC=0` 和真实 GitHub
Actions CI 通过证据不被本切片覆盖或重写。

## 未宣称事项

本证据不把 fixture 启动当作真实 Telegram Bot/Feishu App 通过，不宣称 live credential rotation、真实 AS-1/AS-2、
Hermes paired、长期运行或 npm 发布完成；这些门禁仍保持原状态。密钥值从未写入日志、diff、证据或 README。

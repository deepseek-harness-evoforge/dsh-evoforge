# V5.217：Channels 安装即启用常驻 Gateway

日期：2026-09-04  
EvoForge：本次变更提交前的 `main` 工作树干净；提交后仍只在 `main`。  
最新 DSH 审计：canonical `origin/master` `d347e703908d0406b7a7ef80e3a0e594d86b2215`（`0.1.3-alpha.1`，官方根构建缺失 `@deepseek-ai/dsh-root` 类型入口）；可构建支持基线仍为 alpha.5 `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。

## 修正

`dsh-gateway` 原先随 Bundle 写入 `disabled: true`，导致用户安装 `channels` 后还必须手工改 profile 才能获得常驻 Host Gateway。该行为与产品目标和 Hermes 式常驻 Gateway 不一致，也让渠道首次配置多出一个无意义步骤。

现在 Gateway Bundle 安装即启用，配置默认 `routes: []`。空 route 启动只打开 DSH Host 接缝、Storage Domain 和只读控制面，不连接飞书/Telegram、不读取平台凭据、不发送消息、不创建 Agent/Session。Feishu、Telegram 仍保持 disabled，只有完整凭据和精确 route 配置后才产生平台连接。

## 验证

- `pnpm --filter dsh-evoforge-gateway exec vitest run test/client-module-contract.test.ts`：`4/4` 通过；新增断言确保 Gateway patch 不含 `disabled: true`。
- `pnpm --filter dsh-evoforge-gateway build`：通过，Typert 与 Node 产物校验通过。
- `pnpm run check:docs`：通过。
- `pnpm run check:suites`：`6/6` 通过，套件清单仍无重复包。
- 使用最新 DSH 支持矩阵执行根级 `pnpm run check`：`CHECK_RC=0`；其中 `dsh-gateway` 全包回归为
  `9` 个测试文件、`52/52` 通过，Feishu `57/57`、Telegram `38/38`，其余类型、构建与契约门均通过。
- `pnpm run pack:suite -- --suite channels`：成功生成 4 个 tarball；解包后的 Gateway patch 为：

  ```yaml
  - insert:
      - id: evoforge-gateway
        name: dsh-evoforge-gateway
  ```

本次没有启动真实外部渠道，没有读取凭据，也没有改变 Feishu/Telegram 的默认安全边界。真实 Feishu、Telegram、Provider、Hermes paired、长期效果和 npm ownership 发布门继续按 `release-gates.json` 阻断。

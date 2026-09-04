# V5.181：飞书自定义凭据引用的 Host→Web typed Remote

> 日期：2026-09-04。范围：修复 profile 使用自定义 `appIdEnv`/`appSecretEnv` 时 Web 表单仍写默认引用的契约错误。

## 结论

`dsh-evoforge-feishu` 现在随 Host Bundle 发布一个最小 Typert Remote：`evoforgeFeishu/references()`。
它只返回两个**引用名**，不返回任何凭据值；Feishu Web Client 在同一个 DSH 页面挂载该 Remote，再把返回的名字交给已有
原生 `remote.credentials.describe/set`。因此默认引用和自定义引用都走同一 write-only DSH CredentialProvider，页面不会制造第二套配置状态。

这修复了此前的真实开源可用性问题：profile 可以合法配置自定义引用，但表单硬编码 `DSH_FEISHU_APP_ID/SECRET` 会造成“页面显示已保存、Adapter
仍等待另一组引用”。现在表单会显示自定义引用的配置状态、只向对应引用写入，并继续清空本地输入框。

## 实现

- 新增 `FeishuCredentialRemoteService` 与静态 Typert contract；Host 每个 Bundle 实例只注册一次 `evoforge.feishuCredentials`。
- 生成并提交 Host/Client Remote artifact；`references` 无参数，返回 `{appIdRef, appSecretRef}`，没有 Secret、App identity 或平台探测。
- 新增 package `./remote`、`./client-types` exports 和公开 `lib/types` 构建路径；build 会验证 source digest、Host/Remote manifest 与 method 集合。
- Feishu Client 在卸载时按 DSH Remote lifecycle 移除挂载；Control Center、Gateway、Session、Goal 和凭据服务仍由 DSH 原生拥有。
- 英文根 README 改为 DSH 原生 CredentialProvider/单页 write-only 配置，不再指导用户把渠道 Secret 当作普通环境变量导出。

## 开发前与验证

- 每次开发/测试前重新 fetch canonical DSH；本轮 `HEAD == origin/master == 76fda729799fe9b3848dbe2c211d4b231032b81e`，描述为
  `dsh-v0.1.2-rc.1-99-g76fda72979`；Typert 生成使用已审计 alpha.5 checkout `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。
- `DSH_SOURCE_ROOT=/private/tmp/evoforge-dsh-latest.qPqo1d pnpm run generate:typert`：通过，生成 Feishu Remote 并校验已有 Evolution/Gateway artifact。
- `pnpm --filter dsh-evoforge-feishu run typecheck`：通过。
- `pnpm --filter dsh-evoforge-feishu run build`：通过，Feishu Host/Client 产物、Typert digest 和 node artifact guard 通过。
- `pnpm --filter dsh-evoforge-feishu exec vitest run test/feishu-action.client.test.tsx test/feishu-credentials-remote.test.ts test/client-module-contract.test.ts --maxWorkers 1`：通过，3 files / 9 tests。

新增的 jsdom 用例同时覆盖默认引用和自定义引用：输入值进入对应的 `set(ref,value)`，页面文本不包含 Secret；Remote 单测验证只投影引用名和
DSH service namespace。随后在再次 fetch 最新 canonical DSH 后执行完整根级 `pnpm run check`，权威退出码为 `CHECK_RC=0`；Feishu
`19 files / 55 tests`、Gateway `41/41`、Evolution `309/309` 及其余 Bundle、assembled/package-boundary/clean-profile 均通过。

## 边界

本增量没有连接真实飞书、写入用户凭据、发送消息或修改外部权限；它只修复 Host 配置到 Web 表单的契约。真实 Feishu AS-2、Telegram、Provider/Hermes
paired、长期效果、npm ownership 和首个 SemVer tag 继续阻止发布。

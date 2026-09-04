# V5.182：Telegram 原生凭据缺失时保持 Host 可用并延迟启动

> 日期：2026-09-04。范围：补齐 Telegram 与 Feishu 对 DSH 原生 CredentialProvider 的生命周期一致性。

## 结论

`dsh-evoforge-telegram` 现在不会因为 Bot token 尚未配置而拖垮 DSH Host、Gateway、Web、Session 或 Goal。
它先校验静态路由/配对结构并注册稳定的 Host route façade；凭据为空或非法时保持 fail-closed waiting，不创建轮询、
外发或平台连接。DSH CredentialProvider 提交对应引用后，Adapter 监听官方 `credentials/reference-updated`，在原有
Cordis 服务身份内销毁旧运行时并启动一个新运行时；不会增加第二条 Gateway 路由、第二个 Session 或第二个网页。

这修复了一个真实安装缺口：用户可以先安装并启动 DSH，再通过原生 Web/Host 凭据设置配置 Telegram，而不必把 Secret
写入环境变量或重启 Gateway。未配置凭据期间，`notify` 明确返回 `Adapter is not ready`，避免把未授权的外部副作用伪装成成功。

## 实现

- `apply` 先解析路由/配对结构；只有结构错误才阻止 Bundle 启动，凭据引用缺失/非法只进入等待状态。
- 对固定路由注册一次稳定的 `evoforge.telegramRoute`，其 `notify` 只转发到当前已就绪的 `TelegramRuntime`。
- 监听官方 `credentials/reference-updated`，先 dispose 旧运行时，再按同一引用重新解析并启动；启动竞态由单次 `startPromise` 串行化。
- Host dispose 会等待正在进行的启动并清理轮询、Gateway transport 和 outbound registration；凭据值仍只经过 DSH provider，不进入日志或配置输出。
- 新增 Cordis 生命周期测试，覆盖“空凭据不启动→事件提交→同一 Host route 启动→完整卸载”路径。

## 开发前与验证

- 开发/测试前重新 fetch canonical DSH：`HEAD == origin/master == 76fda729799fe9b3848dbe2c211d4b231032b81e`，描述为
  `dsh-v0.1.2-rc.1-99-g76fda72979`；因该公开 rc.1 仍有上游根级构建缺陷，本项目继续使用已审计可构建 alpha.5 checkout
  `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`，未修改上游源码。
- `pnpm --filter dsh-evoforge-telegram typecheck`：通过。
- `pnpm --filter dsh-evoforge-telegram build`：通过，Host/Client 产物生成完成。
- `pnpm --filter dsh-evoforge-telegram test`：通过，`10 files / 36 tests`。
- 新增用例以本地 loopback Bot API 响应空 updates，不调用模型、不读取真实凭据、不产生 Telegram 外部效果。
- 随后再次 fetch 最新 canonical DSH 执行根级 `DSH_EVOLVE_DSH_SOURCE_DIR=/private/tmp/evoforge-dsh-latest.qPqo1d pnpm run check`：
  DSH preflight、文档/CI/套件/发布合同、Hermes/Provider/Feishu/Telegram 验收合同、全包 typecheck/build、clean-profile、
  Evolution `309/309`、Gateway `41/41`、Feishu `19 files / 55 tests`、Telegram `36/36` 均通过，权威退出码记录为 `CHECK_RC=0`。

## 边界与发布状态

本增量没有读取用户真实 Telegram token、连接外部 Bot、发送消息或修改权限；它只让凭据配置顺序符合 DSH 常驻 Host 语义。
真实 Telegram AS-1、真实 Feishu AS-2、Provider/Hermes 同条件 paired、长期效果、npm 名称归属和首个 SemVer tag 仍是发布门禁，
未满足前不能宣称 Hermes 上位替代或创建 tag。

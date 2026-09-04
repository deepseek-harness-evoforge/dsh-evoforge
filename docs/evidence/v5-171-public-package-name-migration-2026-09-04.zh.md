# V5.171：公共分发名迁移与 alpha.5 回归证据

> 日期：2026-09-04。范围：修复四个未发布公共包与 npm 上无关仓库撞名的问题，并在当前最新 DSH 审计基线
> 上重新验证安装、Bundle、依赖、Typert、测试和构建。本文不是 npm 发布声明，也不关闭真实渠道、Provider 或
> Hermes paired 门禁。

## 事实与取舍

此前以下仓库目录对应的 unscoped 分发名已被无关 npm 仓库占用：

| 仓库目录 / 逻辑组件 | 迁移后的 npm 分发名 | 说明 |
| --- | --- | --- |
| `packages/dsh-doctor` | `dsh-evoforge-doctor` | 目录名、Bundle row id 和组件文档标识保持不变 |
| `packages/dsh-feishu` | `dsh-evoforge-feishu` | 仅分发/模块加载名改变，仍是 Gateway 薄 Adapter |
| `packages/dsh-gateway` | `dsh-evoforge-gateway` | 常驻 Host Gateway 的唯一权威不变 |
| `packages/dsh-telegram` | `dsh-evoforge-telegram` | 仅分发/模块加载名改变，仍是 Gateway 薄 Adapter |

`dsh-evoforge-*` 是当前的冲突规避名，不代表维护者已经拥有 npm Scope、包保留权或发布授权。没有归属证明时，
`registry-name-availability` 继续 fail closed；不创建别名、不抢注、不打 tag。

逻辑套件清单仍使用仓库目录名（例如 `dsh-gateway`），而 `package.json.name`、Cordis patch、Typert manifest、
workspace/peer/dev 依赖、安装/卸载命令和 tarball 使用公共分发名。这样可避免把 DSH 内部生命周期 id 与 npm 名称
混为一谈，也不引入第二个 Runtime、Gateway 或兼容包。

## 实施内容

- 更新四个包的 `package.json`、exports、Client module id、Cordis patch 和 Typert host/remote 生成物。
- 更新 `dsh-evolve-attention` 的可选渠道 peer、根脚本、CI 路径、套件打包、浏览器 overlay 和真实 Feishu/Telegram
  验收脚本。
- 更新安装、卸载、clean-profile、升级夹具和用户 README；根文档明确“未发布 registry 包”，避免用户误装第三方包。
- 锁文件由 `pnpm install --lockfile-only --offline` 重新生成；目录名仍作为 workspace key。
- 增加本证据，并在 ADR-0101 中记录“可用不等于归属”的发布规则。

## DSH 版本前置审计

开发和测试前重新 fetch canonical DSH：

- canonical `deepseek-harness` checkout：`HEAD == origin/master == 76fda729799fe9b3848dbe2c211d4b231032b81e`，clean，
  最新 tag `dsh-v0.1.2-rc.1`。
- 官方 DSH 依赖安装（frozen lockfile、offline、ignore-scripts）通过；官方根构建仍因
  `@deepseek-ai/dsh-root` 缺少 `lib/types/{index,invariant,startup}.js` 入口而被已知上游问题阻断。
- 兼容性执行基线：已审计 alpha.5 checkout `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。

## 可复现验证

以下命令均在上述 alpha.5 checkout 上执行；真实平台凭据、真实 Provider 和外部副作用未在本增量中伪造：

| 检查 | 结果 |
| --- | --- |
| `pnpm install --lockfile-only --offline` | 通过 |
| `pnpm run check:docs` | 通过 |
| `pnpm run check:suites` | 6/6 通过；确认目录套件与公共 npm 名分离 |
| `pnpm run check:release -- --allow-dirty` | 12 个包的静态预检通过 |
| `pnpm run check:release:names` / JSON 检查 | 12/12 当前返回 `available`，0 collision；不等于 ownership |
| Gateway/Feishu/Telegram/Doctor/Evolve-attention build + typecheck | 全部通过 |
| Doctor 聚焦测试 | 35/35 契约测试；全包 40/40 |
| Feishu 聚焦契约测试 | 4/4；全包 46/46 |
| Telegram 聚焦 Client 契约测试 | 3/3；全包 34/34 |
| Gateway 全包测试 | 41/41 |
| Evolve-attention 契约测试 | 1/1；全包 11/11 |
| Evolution 全包测试 | 309/309 |
| Evolve Web 全包测试 | 27/27 |
| clean-profile 安装/启停/卸载纵切 | 1/1（升级历史夹具 1 项按设计 skip） |
| 根级 `pnpm run build` | `BUILD_RC=0` |

根级测试链在修正旧名称断言后完成：Evolution `309/309`、Doctor `40/40`、Gateway `41/41`、Telegram `34/34`、
Feishu `46/46`、Evolve-attention `11/11`、clean-profile `1/1`（另 1 skip）。

## 门禁结论

本增量只消除误装第三方包的撞名风险，不能宣称可发布。`release-gates.json` 仍将
`registry-name-availability` 标记为 `failed`，原因是项目尚无维护者拥有的 npm namespace/reservation 和 publish
authorization；真实 Feishu AS-2、Telegram AS-1、Provider paired、完整 Hermes paired 和长期负迁移/恢复数据也仍按
既有门禁保持阻断。当前不创建 SemVer tag，不执行 npm publish。

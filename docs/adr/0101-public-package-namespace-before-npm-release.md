# ADR-0101：首个 npm 发布前必须拥有项目命名空间

- 状态：accepted
- 日期：2026-09-04
- 决策者：EvoForge maintainer

## 背景

EvoForge 的十二个物理 Bundle 当前使用未加 Scope 的内部/分发名。registry 审计发现
`dsh-doctor`、`dsh-feishu`、`dsh-gateway` 和 `dsh-telegram` 已经属于其他公开仓库；其余名称虽返回
`E404`，也不代表本项目已经取得所有权。继续使用这些名称会让首次发布在最后一步失败，或者在维护者误配
registry 时把用户导向其他项目。

同时，DSH Bundle patch 中的逻辑 row id、Cordis service id、内部 import specifier 和 npm 分发名不是同一
层次。未经设计直接全局替换会破坏套件清单、peer 依赖、Typert 生成、安装/卸载和已有 profile 的迁移。

## 决定

1. 首个公开 npm tag 前，所有公开包必须使用维护者明确拥有的 npm Scope/命名空间；没有授权时保持 registry
   发布阻断，不猜测 Scope、不抢注、不发布同名别人的 unscoped 包。
2. 逻辑 Bundle row、服务和 DSH 内部能力 id 保持稳定；npm 分发名作为独立映射层迁移。迁移必须一次性覆盖
   十二个 `package.json`、workspace/peer/dev 依赖、源码 imports、suite manifest、打包清单、lockfile、CI、
   安装/卸载文档、README、升级/回滚和 clean-profile evidence。
3. 不为冲突的 unscoped 名称发布兼容别名，也不通过 npm `latest`、重定向包或第二个 Runtime 绕过归属问题；
   DSH 用户可继续从本地 tarball 验证逻辑 Bundle，但这不构成 registry 可安装声明。
4. 命名迁移完成后必须重新运行 public metadata、npm name ownership、完整 alpha.5/最新可构建 DSH 兼容矩阵、
   clean-profile add/dump/boot/reload/dispose/remove/readback 和所有真实发布门；所有新分发名在一个 annotated
   SemVer tag 中保持同一版本。

## 后果

- 当前 `dsh-*` 名称仍可作为仓库目录、逻辑 Bundle id 和本地 tarball 的暂时标识，但 README 不得把它们写成
  已可从 npm 安装的稳定包。
- 未来迁移会是一个有边界的兼容性增量，而不是逐包随机改名；期间 `check:release:names` 和
  `registry-name-availability` gate 持续 fail closed。
- 需要 npm Scope 所有权这一项外部维护者动作；在此之前仍可继续做本地插件、真实 DSH、浏览器和渠道验证，不能
  因命名阻塞停止其他工程工作。

## 验证

- `docs/evidence/v5-104-npm-package-name-collision-2026-09-04.zh.md` 记录了当前 registry 事实和四个冲突；
- `scripts/check-npm-package-names.mjs` 在发布工作流的 `npm publish` 前执行，未知 registry 错误也阻断；
- Scope 授权完成后，本 ADR 的第 2、4 条必须由新的迁移证据逐项关闭，不能以改 manifest 或单元测试代替。

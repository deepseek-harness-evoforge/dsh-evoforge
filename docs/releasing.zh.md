# 发布与开源迭代门

EvoForge 以 DSH 官方 Bundle 作为交付单元，以能力套件作为用户安装入口。当前仍是 `pre-alpha`，没有 registry 发布声明；本地 tarball 只能用于开发和验收，不能被文档包装成稳定发行版。

## 版本和 Git 纪律

- 所有插件包在一次发布中使用同一 SemVer 版本；版本变更必须同时更新 `CHANGELOG.md`、套件清单和验证证据。
- 只在 `main` 开发。通过测试的最小增量原子提交并推送 `origin/main`，不使用功能分支或 Git 分支保存 Candidate。
- Candidate 由运行时内容寻址存储保存；发布版本用 annotated tag 标记，例如 `dsh-v0.1.0-alpha.1`。tag 只能指向已在 `main` 验证过的提交，不能用轻量 tag 或手工改包覆盖。
- `pnpm run check:release` 是 tag 前静态预检；它检查 clean worktree、统一版本、MIT/仓库/README/Bundle patch 公共包元数据、能力套件完整性和 Changelog 入口。`--allow-dirty` 只用于本地演练，不构成发布证据。

## 可复现的安装包

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm run check:suites
pnpm run pack:suite -- --suite core --out /tmp/evoforge-packs
pnpm run check:release
```

`pack:suite` 只调用 DSH 官方 `pnpm pack`，并产生包含文件名、版本和 SHA-256 的 `evoforge-suite.json`。部署者仍使用官方 `dsh plugin --profile <profile> add/remove`，不安装第二个 EvoForge Runtime。

## 不可跳过的发布门

静态检查通过不等于可以发布。首个 annotated tag 前必须从 clean profile 使用最终 tarball 完成：

1. 官方 `add`、`dump`、Host boot、真实 Session/Goal 路径、reload、Host 断连与恢复；
2. `dispose`、官方 `remove`、再次 boot/readback，确认原生 DSH 数据仍在且 EvoForge 表面消失；
3. 真实浏览器验证 Control Center 的成功、失败、刷新和恢复；
4. 已配置的真实飞书 Gateway/Adapter 配对、重连、幂等投递和最小权限路径；
5. 同任务、同模型、同权限、同预算的 Hermes paired benchmark，覆盖成功率、人工干预、误调用、负迁移、恢复、重复外部效果、成本、延迟、cache-read 和精确回滚。

越权、评测泄漏、当前 Session 漂移、不可卸载、不可精确回滚或只有模型自评/Mock/单测而无真实路径，均阻止 tag 和 registry 发布。后续迭代仍沿 `main → 验证 → annotated tag`，不以分支区分 Candidate。

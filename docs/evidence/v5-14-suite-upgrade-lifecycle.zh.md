# V5.14 十一包 DSH 原生升级生命周期证据

日期：2026-08-24

状态：`verified`（冻结 pre-release predecessor → 当前十一包最终 tarball；真实发布 tag→tag、真实 Provider、真实飞书和 Hermes paired 仍未完成）

## 用户结果

DSH 运维者可以把一个已经拥有原生 Session/Goal 和 EvoForge 内部经验的旧插件组升级到当前插件组，而不重复
Bundle、不丢失 DSH 事实、不使旧进化证据不可读；升级后的插件还能在同一 Workspace 继续从新的 Goal 形成证据，
随后全部卸载不会阻止原生 DSH 读回升级前后的 Session/Goal。

## 冻结范围

- predecessor 源码：V5.11 commit `b0e4360b49c243535395b7b1ffba59b9ce0ae2c6`；
- predecessor 的运行时代码保持该 commit 原样；依赖按其 exact lockfile 离线恢复后，只在测试临时目录把十一包
  打包版本标记为 `0.1.0-alpha.0`，以便 pnpm 执行真实低版本→高版本替换；
- current：当前 `main` 十一包 `0.1.0-alpha.1` 最终 tarball；
- DSH：固定 revision `47f943859bef60e4160492346772ded9b24f765a`；
- 全程只使用官方 `dsh plugin --profile web add/remove`、`--dump-config`、官方 App Boot、原生
  Workspace/Agent/Session/Goal/Tool/Storage；没有 EvoForge CLI、源码 import 产品入口或第二 Runtime。

## 实际路径

1. 从两个 revision 分别构建并打包十一包，确认历史/current `dsh-evolve` tarball digest 不同；
2. 官方 CLI 安装历史十一包，确认十一项 dependency、Bundle 层和配置行各出现一次；
3. 历史 Host 创建真实 Workspace、Agent、Session 与 Goal；keyless LLM Adapter 只驱动真实 Agent Loop 调用稳定
   `report_capability_gap` Tool，形成一个 durable `suite-upgrade-proof` Capability Gap；
4. Host 正常 dispose 后，官方 CLI 以当前十一包 tarball spec 再次 `add`，确认全部安装版本变为
   `0.1.0-alpha.1`、Bundle 无重复、升级前后 EvoForge 配置行完全一致；
5. 当前 Host 从同一 Workspace/旧 Session 精确读回旧 Gap 和原生 Goal；另一个真实 Agent/Session/Goal 记录同名
   Gap，权威 Control 形成 `2 Goals / 1 eligible Skill Opportunity`；
6. 官方 CLI 删除全部十一包；profile 只剩 DSH base/web Bundle，dump 中 EvoForge 行数为 0；原生 Host 仍能从
   Session Persistence 读回升级前后两条 Session 的 `goal/change` 事实。

## 验证

- 红态：`pnpm test:suite-upgrade` 先以未实现断言失败；
- 绿态：`pnpm test:suite-upgrade`：`1 passed`，69.19 秒；
- `pnpm --filter dsh-software-delivery typecheck`：退出码 0；
- 根级 `pnpm check`：退出码 0，全仓 `565 passed / 3 skipped`；升级纵切在根级测试中再次通过，RP-1
  `8/8`、AS-2 `7/7` 未授权合同继续零付费 Provider 调用、零真实飞书平台副作用。

## 声明边界

该门证明真实历史源码形成的 pre-release migration floor，不证明尚不存在的 registry release 或 annotated tag 之间
的迁移。首个 tag 发布后必须把 predecessor 改为真实已发布 artifact，并持续执行 tag→tag 矩阵。测试使用 keyless
LLM 只验证原生 Agent/Tool/Storage 纵切，不是 Provider 效果证据；没有调用飞书、Telegram、GitHub 或付费模型，
也没有完成真实 Hermes paired，因此仍不得打 tag 或宣布整体上位替代。

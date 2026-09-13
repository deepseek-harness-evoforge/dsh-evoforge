# rc.2 当前 epoch 全量与套件装配验收

- 日期：2026-09-14；EvoForge 起点 `7f64900ebe0eca35462acbc0dfcc89ec51c65648`。
- 独立依赖副本 `.rc2-dependency-build.AXa4EW`，沿用既有独立 rc.2 安装记录，未修改正式依赖声明。
- 实际 DSH 测试源码 `.dsh-latest-audit.3Xt9CT/source`：clean
  `c291e7961a515f6d7af9304e7fd1d257929aef26`，CLI `0.1.5-rc.2`。
- 本次重新 fetch 的 `deepseek-harness` checkout：HEAD `5dda764ed3aa172535a7967b06ff95d9cbfe536a`，
  origin/master 为 c291，工作树干净。须区分它与实际测试源码副本；此前记录的“canonical HEAD/origin 均 c291”
  不适用于这个目录。本次没有移动任何 checkout。

## 当前 epoch 全量通过

使用仓库既有脚本，在新建临时目录生成专用副本：

```text
node scripts/prepare-dsh-case-packs.mjs --revision c291e7961a515f6d7af9304e7fd1d257929aef26 --out <current-case-packs>
```

对源目录与输出执行递归 diff：仅五份 manifest 的 `epoch.dshRevision` 改变。
所有 evaluator、版本、预算、known-bad、known-correction 与其他文件不变；旧冻结目录不变。
输出位于本机 `.rc2-acceptance-epoch.UnOViD`，可用上述命令重新生成。

在独立副本 Evolve 包目录执行：

```text
DSH_EVOLVE_CASE_PACK_ROOT=<current-case-packs> DSH_EVOLVE_DSH_SOURCE_DIR=<c291-source> node_modules/.bin/vitest run
```

结果：85/85 文件、1012/1012 测试通过，exit 0，17.95 秒，无跳过。
这是同一新版环境的完整结果，不是把旧、新两组结果相加。包含此前因旧 epoch 不匹配失败的六项。
这仍是隔离/装配证据，不代表真实任务效果或生产升级完成。

## 后续套件门禁尚未通过

以下在对应包目录使用相同 `DSH_EVOLVE_DSH_SOURCE_DIR`，运行 `node_modules/.bin/vitest run`：

| 包与测试参数 | 结果 |
| --- | --- |
| doctor：`test/suite-native-plugin-contract.test.ts --maxWorkers 1` | 13 通过、11 失败；断言写死 alpha.5，与独立副本 rc.2 声明不符 |
| feishu：`test/dsh-assembled-chat.e2e.test.ts test/dsh-assembled-content.e2e.test.ts test/full-channel-cache-composition.e2e.test.ts test/native-schedule-restart.e2e.test.ts --maxWorkers 1` | 4 文件、5/5 通过，43.81 秒 |
| software-delivery：`test/clean-profile-suite.e2e.test.ts test/suite-upgrade.e2e.test.ts --maxWorkers 1` | 2 失败、1 跳过，37.53 秒 |

两项 clean-profile 失败均在 `expectRequiredEvolveRuntimePeers` 写死的 Goal/Tools alpha.5 声明检查。
第二项已经经过打包、原生 add、dump 和安装包读取，但在后续 boot/dispose/remove/readback 前停止；不能宣称完整生命周期通过。
suite-upgrade 是源码既有的显式 skip，原因是历史 pre-alpha5 输入要求原始 runtime；本轮没有新增 skip，也没有获得升级证据。
Feishu 使用隔离测试平台，覆盖原生装配与冷重启，不代表真实飞书收发。

## 边界与下一步

本轮没有生产代码或测试断言修改，没有放宽支持 allowlist，没有生产部署或发布。
本机既有 Host PID 40511 仍是 `127.0.0.1:3000` 的唯一监听者，未变动其凭据、授权和历史。
下一步需要让套件检查验证实际安装的精确 DSH 依赖 cohort，再完成完整 clean-profile 生命周期；
历史迁移必须另行得到真实证据，不能以旧测试跳过代替。正式支持升级、Web/真实飞书和 Hermes 同条件比较仍未完成。

# rc.2 完整隔离 profile 生命周期

- 日期：2026-09-14；EvoForge 起点 `bdafbcc2cb9eabeca27b535fe3e329738c50a2e8`。
- 当前测试 DSH：clean `c291e7961a515f6d7af9304e7fd1d257929aef26`，CLI `0.1.5-rc.2`，
  独立依赖副本 `.rc2-dependency-build.AXa4EW`；重新 fetch 后 origin/master 仍为 c291。
- 旧版回归：主工作树 alpha.5 依赖，DSH 使用只读 `dsh-alpha5` checkout
  `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。

## 变更与边界

只修改 doctor 的 suite-native-plugin-contract 与 delivery 的 clean-profile-suite 两份测试。
不再把 alpha.5 字符串作为跨安装环境的包一致性判断；改为读取实际安装 native Session 的精确版本，
核对包声明及实际依赖版本。doctor 逐包解析依赖，要求 DSH peer、dev、安装版本一致；delivery 继续
要求 Goal/Tools 为必需 peer，且实际 Goal/Tools 与 Session 版本一致。版本范围不能通过。

没有修改正式 manifests、支持 allowlist、运行时、原生数据或模型组成。这些检查证明安装一致性，
不授予 release support，也不把隔离数据回读解释为已有用户数据跨版本迁移成功。

## 实际命令与结果

在两套环境相应包目录执行：

```text
# doctor
node_modules/.bin/vitest run test/suite-native-plugin-contract.test.ts
# software-delivery：分别给出与依赖匹配的 c291 / db6 源码目录
DSH_EVOLVE_DSH_SOURCE_DIR=<matching-source> node_modules/.bin/vitest run test/clean-profile-suite.e2e.test.ts --maxWorkers 1
```

| 检查 | alpha.5 | rc.2 |
| --- | --- | --- |
| doctor 包/Bundle 合同 | 24/24 通过 | 24/24 通过 |
| clean-profile 两项 | 2/2 通过，44.48 秒 | 2/2 通过，49.04 秒 |
| doctor `pnpm --filter dsh-evoforge-doctor run typecheck` | 通过 | 通过 |
| delivery `pnpm --filter dsh-software-delivery run typecheck` | 通过 | 通过 |

主树 `pnpm run check:suites` 15/15 通过；`pnpm run check:docs`、`git diff --check` 通过。
本次 clean-profile 无跳过；既有 suite-upgrade 的历史测试没有修改，也未以此声称升级通过。

## 已证明与未证明

clean-profile 实际打包 12 个 Bundle，经原生 CLI add/dump，启动隔离 Host，并通过原生 Agent、Tool、Goal
执行固定提交验证。完成后 flush Session、dispose、原生 remove，再启动无 EvoForge 的 DSH，读回完成
Goal 事件，确认插件 Tool/Skill/Service 不再存在，并验证原生 CLI 可启动。
测试使用确定性 LLM adapter，不证明真实模型任务效果、真实飞书收发、Web 体验或已有历史迁移。

生产 Host PID 40511 仍是 `127.0.0.1:3000` 唯一监听者；没有修改其 profile、凭据、授权或历史。
下一步仍需审计旧用户历史到新版的官方读取/迁移路径，然后才能决定日常 Host 升级。
最终 Web、真实渠道、恢复与同条件 Hermes 比较目标尚未完成。

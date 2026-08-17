# EvoForge 当前状态

> 2026-08-17：产品形态已纠正为 DSH 原生 out-of-tree Bundle 套件。旧 P0/P1/P2/LC 功能状态只描述可复用内部实现，不再单独构成产品完成声明。

## 原生插件合同

| 项目 | 当前结论 |
|---|---|
| 六包 Cordis exports | `name`、`inject`、`Config`、`apply` 已统一 |
| 六包官方 Bundle | 每包一个 `dsh.bundle.patch`、一个自有稳定 row、patch 已导出 |
| 独立产品入口 | `dsh-evolve`、`dsh-delivery` bin 已删除；Shadow driver 降级为不打包 test fixture |
| Runtime ownership | DSH/Cordis 只在 peer + dev dependencies；tarball 不含第二份 Runtime |
| Web | 仅 DSH client module/Host adapter；无 EvoForge server 或第二控制面 |
| 生命周期 | 注册、watcher、长轮询、supervisor 由 Cordis fiber/effect 持有 |
| clean-profile gate | 本地 macOS 已通过 tarball add → dump → Host → Agent/Session/Goal → persistence → remove → native boot/readback |
| CI | macOS job 固定 DSH commit并运行静态合同与 clean-profile assembled test；尚未在本工作区观察一次 hosted CI run |
| 发布 | 未发布；本次明确不 merge、不 release、不 deploy |

详细逐包结论见[全仓产品形态审计](native-plugin-shape-audit.zh.md)。

## 当前限制

- Registry 尚无本次 pre-alpha 发布物；当前真实安装路径是本地 tarball。
- 固定 rc.5 源码是唯一兼容性证据；rc.6 dev dependency 只用于已发布类型，不代表扩大的支持范围。
- Telegram 与 Goal continuity 默认 disabled，需要部署者明确配置。
- 独立真实 provider、陌生用户与长期 outcome 证据仍未完成，不能用 assembled 自动化替代。

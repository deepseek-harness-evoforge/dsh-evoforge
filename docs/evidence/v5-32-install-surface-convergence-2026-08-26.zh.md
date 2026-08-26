# V5.32 安装面收敛证据

日期：2026-08-26

## 目的

验证用户看到的是少量按结果组织的安装入口，而不是十二个内部 Bundle；同时证明精简没有删除 DSH 官方 Bundle 的独立安装、权限和卸载边界。

## 当前分类

| 分类 | 入口 |
|---|---|
| 默认 | `core`、`channels`、`delivery`、`continuity` |
| 可选 | `attention` |
| 兼容/高级 | `evolution`、`control`、`gateway` |
| 维护者 | `full` |

`core` 是四个 Bundle 的用户入口；`channels` 只包含 `dsh-gateway`、`dsh-feishu`、`dsh-telegram`，不再强制安装 Control Center 或 `dsh-evolve-attention`。物理 Bundle 数量仍为十二个，`full` 仍覆盖全部十二包。

## 可复核命令与结果

```text
pnpm run check:suites
✔ capability suite manifest is complete and has no duplicate package rows
✔ user-facing suites keep independent runtime boundaries explicit

pnpm run pack:suite -- --suite core --out <isolated-directory>
Packed core suite (4 packages) into <isolated-directory>/core
```

生成的 `core/evoforge-suite.json` 关键字段：

```json
{
  "suite": "core",
  "audience": "default",
  "packages": [
    "dsh-evolve",
    "dsh-doctor",
    "dsh-control-center",
    "dsh-evolve-web"
  ]
}
```

每个条目仍由官方 `pnpm pack` 生成真实 tarball；套件清单只是安装编排，不引入聚合 Runtime、第二 CLI、全局注册表或新的 DSH 生命周期。

## 仍然必须保留的边界

- Gateway 与 Feishu/Telegram Adapter 的凭据、重连和协议权限不同；
- Control Center 是公共 Web Shell，Evolution Web 是其 child Surface；
- Evolution 与 Attention 的模型/渠道依赖不同；
- Goal Continuity 与 OS Resident 分别属于 Agent 生命周期和 OS service authority；
- Software Delivery 与 GitHub Review 的本地写入/外部读取信任边界不同。

因此本证据只证明安装入口收敛和套件编排正确，不把十二个物理 Bundle 宣称为一个可独立卸载的单一插件，也不替代 DSH clean-profile、真实渠道、真实 Provider 或 Hermes paired 发布门。

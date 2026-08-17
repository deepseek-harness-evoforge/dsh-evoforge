# ADR-0041：DSH 是 EvoForge 唯一 Runtime 与安装入口

## 状态

Accepted，2026-08-17。产品所有者方向纠正；优先于任何把 EvoForge CLI、Web、daemon 或 verifier 描述成用户产品入口的旧 ADR/文档。

## 背景

仓库已有大量可复用的进化、交付、诊断、渠道与 Goal 连续性实现，但 `dsh-evolve`、`dsh-software-delivery`、`dsh-resident` 曾发布独立 bin，部分包没有官方 Bundle 或完整 patch export，部分 package-boundary 测试甚至把独立 executable 当作产品边界。这会让 EvoForge 形成旁路工具，而不是安装进 DSH 的插件。

目标 DSH 源码 `47f943859bef60e4160492346772ded9b24f765a` 已提供官方 `dsh plugin --profile <name> add/remove`、`dsh.bundle.patch`、profile layer、`--dump-config` 与 Cordis lifecycle。没有必要也不允许再造 installer 或 Runtime。

## 决策

1. 九个用户包都声明一个官方 Bundle layer，并导出真正的 Cordis 插件合同：`name`、`inject`、`Config`、`apply`。
2. DSH/Cordis 由 Host 提供，只作为 peer + dev dependency；tarball 不携带第二份 Runtime。
3. 删除 `dsh-evolve`、`dsh-delivery` 与 `dsh-resident` 产品 bin。算法或 OS adapter 驱动器只能作为不打包的测试夹具，或由 DSH Command/Tool/Job/Skill 调用的内部实现。
4. `dsh-evolve-web` 只保留 DSH client module 与 Host service dependency gate，不绑定端口、不启动 server、不保存第二份权威状态。
5. Telegram 长轮询、进化 supervisor 和所有注册项都由 Cordis fiber/effect 持有；禁用或卸载必须结束资源并移除表面。
6. Resident 只保留默认关闭的 Bundle、`/resident` Command 与私有 launchd/systemd adapter；apply/remove 必须逐次确认 exact plan hash/service id，OS manager/unit 仍是进程权威。
7. 发布门禁必须从九个 tarball 安装到隔离的官方 profile，检查有效配置和 Host 启动，在真实 Agent preset/Session/Goal 内触发能力并写入 DSH 持久化，然后通过官方 remove 卸载并重新启动、读回原生数据。

## 结果

- 内部进化与交付算法可继续复用，但不再构成独立产品。
- 开发测试命令与用户安装/使用命令必须分开书写。
- 旧功能状态只能说明内部能力存在；在 native assembled gate 之前不能称为 suite 交付完成。
- 后续 roadmap 维持冻结，直到该合同持续在 CI 中通过。

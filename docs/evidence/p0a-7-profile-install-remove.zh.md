# P0A.7：`profile-install-remove` 产品 fixture 证据

> 状态：`implemented`；三个公开产品 fixture 已全部完成，但本地未见 final-test 仍缺失，P0A 尚未退出

## 用户问题

有些插件安装后必须自动加入一条默认 profile 配置。若只发布 runtime export 并要求每个用户复制 YAML，能力不会随安装自动启用，多个 profile 容易漂移，删除包也不等于配置已恢复。反过来，不需要默认配置的普通库若滥用 Bundle，又会在所有目标 profile 注入不必要的组合面。

本 fixture 验证最小选择规则：只有“安装即需要 profile patch”时声明 `dsh.bundle`；安装、组合、启动和删除都通过 DSH 的真实接缝完成。

## 固定输入与额外权限

- DSH revision：`47f943859bef60e4160492346772ded9b24f765a`
- Case Pack：[`examples/case-packs/profile-install-remove`](../../examples/case-packs/profile-install-remove)
- 受管 Skill：[`skills/build-dsh-plugin`](../../skills/build-dsh-plugin)
- Trial：known-bad、known-correction、baseline、Candidate 四个独立 macOS Seatbelt workspace
- 包管理器：固定的本机 pnpm 可执行包，只读挂载；安装使用本地目录与 `--offline --ignore-scripts`

只有同时声明 `dshAssembled=true` 和 `dshProfileInstall=true` 的 Case Pack 能获得该包管理器接缝。否则 manifest 在模型调用和 Trial 之前失败。Seatbelt 继续禁网络、禁宿主写入，只允许 Trial workspace 写入；普通 assembled fixture 不获得 pnpm 权限。若本机只暴露 Corepack shim，Host 解析已缓存的精确 pnpm 版本并只读挂载对应 package 目录，不开放用户 home。

## 真实执行路径

每棵 Skill 树都执行：

```text
生成固定、可审计的本地插件包
→ node --check
→ real dsh plugin --profile fixture add <local-dir> --offline --ignore-scripts
→ 检查 profile manifest 自动选择 Bundle
→ real dsh --profile fixture --dump-config
→ pinned DSH App Boot 装载该精确 dump
→ real dsh plugin --profile fixture remove <package>
→ 再次 dump-config
→ pinned DSH App Boot 装载恢复后的原生空配置
```

正确包只贡献一行 host-only Loader entry。known-bad 包故意省略 `dsh.bundle`：pnpm 会把它作为普通依赖安装，但 DSH 不会把它加入 profile layer，因此 evaluator 拒绝。

完整 `dsh --profile fixture` 还会无条件启动用户 patch HMR watcher；它属于常驻 profile 的另一职责，在当前子进程 Seatbelt 中会得到 `EMFILE`。本 fixture 不掩盖该错误，也不把它算作安装验证，而是用真实 `--dump-config` 输出驱动 pinned App Boot。长时 HMR/常驻进程属于 P0B Local Continuity 的独立故障试验。

## 结果

2026-08-16 本机验证：

- known-bad=`fail`，known-correction=`pass`；
- active Skill 已含正确 Bundle 选择规则，baseline=`pass`；
- Candidate 只补充 dump 检查点，Candidate=`pass` 但没有净改善；
- Decision=`review`，没有制造虚假晋升；
- 安装后 dependency 与 Bundle layer 各出现一次，dump 只有预期 entry；
- 安装态精确 dump 经真实 App Boot 后写出 `installed` 用户结果；
- 删除后 dependency 与 Bundle layer 均消失，dump 恢复为安装前内容；
- 恢复态再次真实 App Boot，私有插件不再执行；
- fixture 正常模型调用为 `0`，active Skill 不变。

## 尚不能声称

- 三个 fixture 都是公开、参与开发的固定 evaluator，不是用户本机未见 final-test；
- Candidate 仍是 Skill 数据，未执行任意模型生成代码；
- 未做真实 registry/tarball 安装、Windows profile 或网络失败恢复；
- 未实现 Generation、激活、回滚、常驻恢复或自动晋升；
- 因此 P0A 仍是 `implemented / in progress`，不能声称持续进化已完成或优于 Hermes。

下一步不再增加公开 fixture，而是准备一份不进入仓库、不给 proposer 的本地 held-out Case Pack。只有真实修正胜过 baseline、全部 known-bad 稳定失败且成本值得，P0A 才能退出并进入 P0B。

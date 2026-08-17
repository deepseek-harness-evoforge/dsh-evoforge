# LC-2：用户级 DSH 常驻服务证据

> 日期：2026-08-17
>
> 状态：`implemented`；尚未达到生产多日 `verified`
>
> 包：`dsh-resident@0.1.0-alpha.1`
>
> DSH 基线：`47f943859bef60e4160492346772ded9b24f765a`

## 用户痛点与最小实现

DSH 原生 profile 能正确 boot，并能在 `SIGTERM` 下收尾，但进程退出后需要外部进程管理器再次启动。
没有这一层时，Goal/Session/Shadow 即使已经持久化，也会停到人手工重开 DSH。

LC-2 只消除这个进程级人工断点。实现是一个 DSH Cordis Bundle 和一个 `/resident` Command，内部只有
四个动作和两个私有 renderer/manager adapter。它没有 executable、第二 Runtime、daemon、状态库、
公共 supervisor API、Mission 或任务图。
这也是过度设计门：如果 DSH 上游以后仍然正确，用户仍然需要“把任意 exact profile 注册为 OS user
service”这个独立结果，因此它不是 bug workaround。

## 自动化证据

`pnpm --filter dsh-resident test` 覆盖：

- launchd/systemd 的纯 plan render；unit 不包含 shell、`PATH`、API key、token 或 secret；
- 非 executable Node、非法 profile 和非 normalized/不存在路径在 plan 前 fail closed；
- `/resident apply` 的 plan hash 或 `/resident remove` 的 service id 不匹配时无 unit/manager effect；
- systemd manager protocol 的 atomic write → daemon-reload → enable → restart → status → disable --now
  → remove 顺序与三态结果；
- Linux CI 使用原生 `/usr/bin/systemd-analyze verify` 检查生成 unit；
- tarball 声明官方 Bundle/patch，包含 `dist/index.mjs`，且明确不存在 `node_modules/.bin/dsh-resident`；
- 真实 Cordis Commands composition 注册 `/resident`，精确 hash 后通过 fake systemd 完成
  apply/status/remove，dispose 后 Command 消失；
- macOS 真 launchd 启动 pinned DSH CLI 的最小真实 profile，读取 marker 中的 exact `--profile`；对第一
  个 DSH PID 发真实 `SIGKILL`，等待 manager 产生不同的第二 PID；status 显示 registered/active/unit；
  remove 后 unit 消失、第二 PID 退出，等待超过 throttle window 后没有第三次启动。

本地 macOS 最近一次包测试结果：

```text
Test Files  7 passed | 1 skipped (8)
Tests       14 passed | 1 skipped (15)

pnpm check
Tests       311 passed | 4 skipped
docs / typecheck / build exit 0

pnpm test:pa1
Tests       166 passed | 1 skipped
```

跳过项是只在 Linux 执行的 native systemd unit verifier；macOS launchd 真生命周期已执行。CI 的 Linux
Node 22.19/24 lane 执行 unit verifier 和 manager protocol；macOS lane再次执行真实 DSH launchd
`SIGKILL` 生命周期。远端 run 链接保留在对应 Draft PR。

## KV Cache、token 与模型表面

包有一个默认关闭的 Cordis row：1 Bundle、1 human Command、0 Service、0 Tool、0 Skill、0 Prompt、
0 Remote、0 model call。plan/apply/status/remove 均在 DSH Command handler 中完成，但该 Command 不进入
模型请求。因此正常 Session 的 Prompt/Tool/Skill composition 不变，空闲与运行时额外模型 token 都为 `0`。

## 权限、秘密和删除

- plan 是只读动作；apply/remove 属部署效果，DSH Command 每次硬性要求 exact plan hash/service id；
- unit 只保存 exact absolute Node、DSH entry、profile、cwd 和 `DSH_HOME`；不经过 shell，不写 PATH，
  不读取或复制 secret 环境；
- launchd plist 和 systemd unit 均以 `0600` 原子写；
- remove 停止 registration 并删除 unit；macOS 日志保留在 DSH home 中作为可审计数据，文档明确告知
  用户可另行删除；
- 插件删除不会改写 DSH Session、Goal 或 Workspace。已安装的 OS unit 是先前明确发生的外部效果，必须在
  卸载 Bundle 前执行 `/resident remove <service-id>`；卸载不能伪称撤销它。

## 尚缺证据

- Linux 真 systemd user manager 下的 DSH PID crash/login/disable/remove 生命周期；
- 陌生机器的 Node/DSH 安装布局、用户登录策略与 systemd lingering 可用性；
- 真实 DSH profile 的生产多日恢复率、恢复时间、crash-loop 诊断与日志增长；
- 磁盘满、unit directory 权限变化和 OS upgrade 后的故障数据；
- Windows 和多故障域 SLO。当前只称 Local Continuity，不称 High Availability。

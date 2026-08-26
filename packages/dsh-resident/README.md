# dsh-resident

`dsh-resident` 是安装进 DeepSeek Harness 的原生 Cordis Bundle。它通过 DSH `/resident` Command
管理一个 exact DSH profile 的用户级 `launchd` 或 `systemd` unit；没有独立 executable、Runtime、
daemon、Session、状态数据库或 Agent loop。

操作系统 service manager 和生成的 unit 是进程状态唯一权威。DSH Commands 提供可审计控制面，
Session、Goal、Jobs、Schedule 与恢复状态仍由 DSH 持有。

## 安装与配置

```sh
dsh plugin --profile admin add ./dsh-resident-0.1.0-alpha.1.tgz
```

Bundle 默认 disabled，因为目标 profile 和绝对路径属于机器部署策略。通过 profile patch 明确启用：

```yaml
- id: evoforge-resident
  name: dsh-resident
  disabled: false
  config:
    manager: auto
    profile: web
    dshHome: /absolute/path/to/.dsh
    cwd: /absolute/path/to/workspace
    dshEntry: /absolute/path/to/deepseek-harness/apps/cli/lib/bin.js
    nodeBin: /absolute/path/to/node
    # Required for a Web target under launchd/systemd: keep the service from opening another tab.
    noOpen: true
```

控制 profile 可以与目标 profile 不同，避免首次启动 resident unit 时和当前管理进程争用同一端口。
所有路径必须存在、为绝对规范路径；Node 必须可执行。

## DSH 内操作

先查看完整 unit 与 exact 启动参数：

```text
/resident plan
```

结果末尾给出当前 plan 的 SHA-256。只有把该 hash 原样带回，才会写 unit 并调用原生 service manager：

```text
/resident apply <plan-sha256>
/resident status
```

删除同样要求逐次确认当前 exact service id：

```text
/resident remove <service-id>
```

`apply` 和 `remove` 会进入 DSH `command/run`/`command/done` 审计。错误 hash、错误 service id、
非本机 manager、无效路径或不可用 manager 都 fail closed。若调用方在外部效果开始后断线，先用
`/resident status` 查询，不要假设失败并盲目重试。

## 安全与生命周期

- unit 直接执行 exact Node + DSH JavaScript entry，不经过 shell 或 `PATH`；`noOpen` 只向目标应用追加
  `--no-open`，不会改变 profile、Session 或 Gateway 路由；
- unit 只携带 `DSH_HOME`，不复制 token、API key 或其他 shell 环境；
- unit 原子写入并使用 `0600`；
- macOS 日志位于 `<DSH_HOME>/resident/<service-id>/`，卸载插件不会伪称撤销已发生的 OS 效果；
- 禁用或卸载 Bundle 只移除 DSH Command。要停止并删除现存 unit，必须先显式执行
  `/resident remove <service-id>`；
- 插件不增加模型可见 Prompt、Tool、Skill 或 schema，普通模型请求 token 开销为 0。

macOS unit 使用 `RunAtLoad`、`KeepAlive` 和五秒节流。Linux user unit 使用 `Restart=always`、
五秒重启间隔与有界 start-limit；是否开启 user lingering 仍由机器管理员决定。

## 验证

```sh
pnpm --filter dsh-resident test
pnpm --filter dsh-resident typecheck
pnpm --filter dsh-resident build
pnpm --filter dsh-resident pack --pack-destination /tmp
```

测试进程 driver 位于 `test/fixtures`，不在 tarball 的 `files`、`exports` 或 `bin` 中。

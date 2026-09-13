# rc.2 GitHub Review 原生队列测试迁移

- 日期：2026-09-14；EvoForge 起点 `fddf3a0`。
- 本轮 fetch 后 canonical HEAD / origin/master 为 clean `c291e7961a515f6d7af9304e7fd1d257929aef26`。
  沿用已审计 install/build 产物，未修改上游。
- 关闭首轮类型扫描的四项 Inbox 构造器错误，不改变 GitHub Review 产品逻辑或正式部署。

## 修改

新版 Agent 包只公开 Inbox 接口，实际实现由 AgentLoop 创建。两个测试不再构造已移除的公开 Inbox，
改为在生命周期拥有的 Context 内加载真实 AgentLoop，取得真实 Agent/Session/Inbox。
测试中的 followup 仅调用真实 Inbox append，保持消息待执行，便于确定性检查接收失败/恢复/去重；
它不是完整模型执行测试，也没有用数组替代原生日志。另加两项 native inbox splice 数量断言，确认重复扫描
和“已接收但未结算”的恢复不产生第二次入队。卸载仍通过所属 Context 的 dispose。

增加三个 alpha.5 **开发依赖**（AgentLoop、SessionProjection、SystemPrompt），生产 dependencies/peers
不变。`pnpm install --filter dsh-github-review --offline --ignore-scripts` exit 0，未下载包；lockfile 仅该
importer 新增 9 行。保留其他已有 peer 警告，不以本次安装宣称整个工作区依赖矩阵无误。

## 验证与失败边界

- 原工作树包 `typecheck` 通过；隔离副本使用 491 项 rc.2 类型映射检查同一包也通过。
- runtime + plugin-lifecycle 在旧开发依赖下 4/4，在 current runtime aliases 下 4/4；包括原生 splice
  检查、transient acceptance failure 恢复、精确 Session 投递、已接收结果去重和 Context dispose。
- 原工作树分别显式设置 `DSH_EVOLVE_DSH_SOURCE_DIR` 到 alpha.5 与 c291，执行
  `pnpm --filter dsh-github-review exec vitest run --maxWorkers 1 --reporter=dot`，两侧均 **10 文件 27/27**。
  两个 assembled 用例实际 boot 对应原生 DSH，分别验证 Tool 结果进入真实 AgentLoop 的 review followup，
  以及打开轮询器前后的完整普通模型请求组成相等；其他静态开发依赖仍为 alpha.5。

最初未设置 source 环境变量时，两个 assembled 用例错误地指向旧的未完整安装 checkout，因缺少
`node-addon-landlock-run` 失败；指定上述已审计 checkout 后通过，没有修改或降级断言。
隔离别名扫描副本的全包运行另有两个 build 前置失败：pnpm 检测到共享 node_modules 与副本 manifest/lock
不同，尝试重新安装并因无 TTY 中止。没有强制清除共享目录；该副本只用于上述类型与直接 runtime 测试，
不能用它宣称完整 current npm 构建/安装通过。

模型、GitHub 服务和审查消息均为本地夹具；没有访问真实 PR，没有新增模型费用，也没有证明实际任务效果
或 Hermes 优势。正式单 Host、用户授权、凭据、历史与支持矩阵未变。其余迁移与完整升级验收继续进行。

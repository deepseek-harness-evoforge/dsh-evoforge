# 飞书审批卡 Card 2.0 协议修复

日期：2026-09-18。起点 `5639d93`；本轮只修改飞书 Adapter 的卡片呈现协议及相应测试、说明。

## 问题与边界

原 `approvalCard` 声明 `schema: '2.0'`，却把按钮置于旧版 `tag: 'action'` 容器，
并使用按钮顶层 `value`。飞书官方仓库的[按钮协议](https://github.com/larksuite/cli/blob/main/skills/lark-im/references/card/components/button.md)
明确规定2.0按钮直接放入elements，交互使用behaviors中的callback/value，不支持旧action容器。
这是Adapter的平台协议缺陷，不是DSH核心审批缺陷；原装配测试能从非法结构手工取出nonce，因而未捕获平台拒绝风险。
本轮没有在生产发送旧非法卡片，因此不声称取得真实平台错误码。

用户结果：原生审批请求生成符合Card 2.0的中文操作卡，允许/拒绝仍交回原生DSH审批。
没有增加Tool、模型请求、系统提示、权限、路由或持久化字段；模型组成不变。
保持现有nonce、卡片id、会话id、操作人校验，取消/dispose及迟到回调处理不变。
不创建另一审批服务、不放宽完全访问策略，也不改变当前生产会话的权限。

另补充[官方回调配置要求](https://github.com/larksuite/cli/blob/main/skills/lark-im/references/lark-im-card-action-reply.md)：
`card.action.trigger` 位于开发者后台的回调配置，不是普通消息事件订阅；未配置时长连接仍可能正常启动。
本文没有读取或修改用户开发者后台，不声称当前应用已启用该回调。

## 复现与回归

以下命令在`packages/dsh-feishu`运行，`DSH_EVOLVE_DSH_SOURCE_DIR`指向审计过的官方支持checkout。

1. 为`dsh-assembled-chat.e2e.test.ts`中的真实Adapter卡片输出添加2.0按钮及中文标签断言。
   `pnpm exec vitest run test/dsh-assembled-chat.e2e.test.ts --maxWorkers 1`：修复前失败，收到action/actions/top-level value。
2. 改为两个直接button，使用behaviors callback，并更新五条装配路径按真实回调结构取值。
   聊天、内容读取、配对、双工作区四个装配文件通过。第一次同时选择文件交付测试时未开opt-in，
   20个文件用例被跳过，不能算通过；随后明确开启如下开关重跑。
3. `DSH_FEISHU_TEST_NATIVE_FILES=1 pnpm exec vitest run test/dsh-assembled-file.e2e.test.ts test/native-present-delivery.test.ts test/file-runtime.test.ts --maxWorkers 1`：41通过、0跳过。
   覆盖routes/pairing/旧header、原生present/显式文件Tool、批准、拒绝、错误用户、完全访问、快照改写和取消。
4. `pnpm exec vitest run test/package-install-remove.e2e.test.ts test/runtime-dispose.test.ts test/websocket-lifecycle.test.ts --maxWorkers 1`：5通过、0跳过。
   clean-profile官方add/dump/remove与SDK解析、装配运行/dispose分别有证据，不称单个安装测试已覆盖所有运行路径。
5. `pnpm run typecheck`、官方channels/feishu三Bundle打包通过；文档与diff检查通过。

全部上述执行模型与平台传输为无凭据fixture。它们证明原生集成和协议输出，不代替真实审批卡渲染或点击验收。

## 上游与部署

本轮fetch canonical DSH：checkout `5dda764`、origin/master `ddefc45`，clean，仍非当前可直接替换的支持版本。
生产与装配使用官方`0.1.6-alpha.1 / 0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`，支持checkout clean。
沿用当天该精确支持版本的frozen install/full build结果，不重新构建或修改DSH核心，不称其为最新上游。

飞书tarball SHA-256 `cf681c648a6f1bb28d2d52824503a6c593cbf953c300f17b7c9671b0811a78bd`，
先进入持久内容地址，再通过官方plugin add更新唯一生产profile。只改变`dsh-evoforge-feishu`依赖；
Bundle集合、profile策略、凭据及绑定保持不变。安装dist与测试构建逐字节相同，SHA-256
`2a0f23d2cc29a16260da8477e8483b6e2c60a75edafde4d76d61b01fdaa95e52`。

空闲后停止旧PID572，确认端口释放，再启动唯一PID2682、127.0.0.1:3000。
冷启动读回31个Session：header和全部旧事件相同、追加0；三个学习/两个外发账本字节相同。
备份为本机部署目录的`card-v2-backup-20260918.l6tu4P`。回退可重装其package.json引用的旧飞书包，
但会恢复非法卡片结构；不覆盖Session、账本或凭据。

## 真实渠道检查与剩余门禁

部署后在原DSH飞书私聊发送一次预定的`FEISHU-20260918-CARD2-SMOKE`，要求只回复“升级后渠道仍可用”。
实际客户端收到一次对应回复并截图；原生Session第32轮completed、1次模型响应、0工具调用，耗时4.663秒。
原生totalTokens为25,831（含4,608缓存token）；金额未知。原26条外发记录完整保留，只新增1条delivered、attempts=1。
三个学习账本和文件外发账本未变；会话仍为原danger-full-access，没有改变权限以制造审批结果。
这只证明升级后普通收发恢复，不计作任务效果样本或审批验收。

已询问是否允许一次临时收紧该会话权限并在验收后恢复；未收到授权，不执行此变更。
因此真实审批卡发送、渲染、允许/拒绝按钮回调仍未通过验收，不能宣称飞书审批问题全部关闭。
Web待审批文字冲突、真实学习收益、未来启用/精确回滚及Hermes同条件优势仍未解决。

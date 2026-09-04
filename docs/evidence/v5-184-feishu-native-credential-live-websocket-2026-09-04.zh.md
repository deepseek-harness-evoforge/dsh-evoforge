# V5.184：原生凭据写入后的飞书常驻 WebSocket 复验

> 日期：2026-09-04。范围：验证用户在同一个 DSH Web 控制面保存飞书凭据后，凭据是否进入原生凭据存储，以及同一 Host 内的 Feishu Adapter 是否恢复为官方 WebSocket 连接。

## 结论

使用当前 `main` 和已审计的 DSH alpha.5 支持 checkout，只启动一个 DSH Web Host 和一个浏览器页面。在原生 Session 的“控制台 → 飞书内容”页填写用户提供的 App ID 与 App Secret 并点击“保存凭据”后，页面显示“已配置”和“凭据已保存；正在唤醒常驻 Adapter”。凭据文件新增两个引用，但本轮没有读取或输出其值。

回到同一页面的“渠道”tab 后，控制中心显示：

- `常驻连接：飞书 · Adapter 已连接`；
- `official-feishu-websocket`；
- `连接正常`；
- 已有一个动态授权路由；
- 页面仍是同一个原生 `conversation.view`，没有新网页、第二个 Gateway 或第二个 Session。

这证明了“DSH 原生 write-only 凭据 → 同一 Host 的 Adapter 重启 → 官方 WebSocket ready”的真实路径。页面同时明确提示“连接已建立，但尚未观察到平台入站事件”，因此本轮没有把连接 ready 误报为真实消息验收通过，也没有发送测试消息或修改飞书权限。

## 操作与证据

1. 开发/测试前重新 fetch canonical DSH：`origin/master` 为 `76fda729799fe9b3848dbe2c211d4b231032b81e`；运行使用已审计可构建 checkout `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。
2. 启动 `node /private/tmp/evoforge-dsh-latest.qPqo1d/apps/cli/lib/bin.js --profile web --no-open`，只建立一个 Web 页面。
3. 在既有 Session 的原生“控制台”中打开“飞书内容”，填写 App ID/Secret；页面未回显 Secret。
4. 点击“保存凭据”，等待约 2.5 秒；页面返回保存成功状态。
5. 切换到“渠道”，等待约 5 秒；观察到官方 WebSocket ready 和同一授权路由。
6. 对 `$DSH_HOME/.credentials.yaml` 只做键名级脱敏检查，确认 `DSH_FEISHU_APP_ID`、`DSH_FEISHU_APP_SECRET` 两个引用存在，未把机密复制到仓库或日志。
7. 停止临时 Web Host，并清理浏览器页面。

## 版本、边界与未通过项

- EvoForge 工作树：`main`，本证据对应提交前的工作状态 `518757b`。
- App identity 只保留 SHA-256：`de91a76492ba38ca329d998c0245c7bbdd8b84ff9cc404fda8eb7f1138b349da`；Secret 从不进入证据。
- 已证明凭据配置和官方 WebSocket 连接恢复；未证明新的陌生私聊事件到达、配对码生成/批准、Agent 回复、Schedule、Approval、重启、卸载和 readback。
- `real-feishu-as2` 仍保持阻断：没有入站事件就不能声称真实 AS-2 通过。Telegram、真实 Provider、同条件 Hermes paired、长期效果、npm 归属和 SemVer tag 门禁不变。

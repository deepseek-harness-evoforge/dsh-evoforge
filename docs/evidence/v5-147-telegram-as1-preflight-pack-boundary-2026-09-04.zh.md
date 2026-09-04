# V5.147：Telegram AS-1 未授权运行与最终包边界验证

日期：2026-09-04  
EvoForge revision：`05d572d`  
Canonical DSH：`76fda729799fe9b3848dbe2c211d4b231032b81e`，`0.1.2-rc.1`，`HEAD == origin/master`，clean。  
可运行 assembled 支持基线：`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`，`0.1.2-alpha.5`，clean。

## 未授权运行

执行前再次 fetch/核对 canonical DSH 后，在无授权、无凭据环境运行：

```sh
env -i PATH="$PATH" HOME="$HOME" pnpm benchmark:telegram:as1
```

结果：退出码 `2`，stdout 只有一份 `not-run` JSON，原因是 `real-telegram-effects-not-authorized`；stderr 为空。
执行器没有被加载，不读取 Bot token、账户或路径，也没有连接 Telegram API。

## 最终包边界

对 `dsh-control-center`、`dsh-gateway`、`dsh-telegram` 分别执行 `pnpm --filter <package> pack --pack-destination`
并检查 tar 内容。三个 tarball 均成功生成，包内没有 `node_modules/` 或产品 CLI 文件；EvoForge 工作树 clean。

## 结论

这证明 AS-1 的安全预检和最终包边界可复现，不证明真实 Telegram Bot 通过。真实私聊配对、Host 批准、exact
challenge、原生回复、Gateway ingress 回放、Approval、重启、卸载和 Session readback 仍需显式授权的人工运行；
`real-telegram-as1` 继续保持 `not-run`，不能创建 release tag。

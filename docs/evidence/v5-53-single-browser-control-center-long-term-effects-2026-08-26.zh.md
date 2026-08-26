# V5.53：单浏览器控制中心与长期效果卡片实测

日期：2026-08-26

## 验证目标

确认新增长期效果证据不会再生成独立网页、遮挡层或随机端口页面，并且公共控制中心在同一个原生 DSH
Session 页面中可以完成 tab 切换、状态刷新和整页恢复。

## 实测路径

使用当前 `main` 启动的 DSH Local Build，仅保留一个页面：

```text
http://127.0.0.1:3080/
```

没有打开 `56017` 或其他 clean-profile 残留页面，也没有创建第二个控制中心窗口。浏览器读取到原生
`conversation.view` 中的 `控制台` tab 和同一页内的 `控制中心` child surface。

依次执行以下真实浏览器操作：

1. 在 `控制中心` 中确认 `渠道` tab、飞书 WebSocket 状态、授权路由、入站/出站计数和刷新按钮均可见。
2. 点击 `飞书内容` tab，确认页面切换到同一控制中心的内容能力视图，没有导航到新 URL。
3. 点击回 `渠道` tab，确认刷新按钮可用；点击 `刷新状态` 后仍显示 `连接正常`。
4. 整页 reload，确认仍回到同一 `127.0.0.1:3080/`，`控制中心`、`渠道与网关` 和 `渠道` tab 仍存在。
5. 读取浏览器错误日志，error 数量为 `0`。

新增长期效果卡片在同一 Evolution surface 中按六个指标展示：误晋升、遗忘回归、负迁移、重复外部效果、
崩溃/重启恢复和回滚率。当前 profile 没有真实长期 paired 事实时显示 `未测量`/`样本不足`，不会伪造百分比
或授予发布权。

## 结果

```text
single page URL                  http://127.0.0.1:3080/
control center after reload     true
gateway surface after reload    true
channel tab switch              passed
refresh button                  enabled / passed
connection status               连接正常
browser console errors          0
extra control-center pages      0
```

这证明视觉入口已经并入 DSH 网页，不证明真实飞书重启后新增消息、真实 Provider 或 Hermes paired 门已经
通过；这些门仍由 `scripts/check-release-gates.mjs` 独立阻断。

## 复现命令

```text
pnpm check
```

本次实测前后工作树保持 clean；变更只记录证据文档，不修改运行时状态。

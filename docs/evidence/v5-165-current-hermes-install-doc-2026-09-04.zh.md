# V5.165：当前 Hermes revision 安装说明同步

日期：2026-09-04  
EvoForge revision：`65992cb779a7dae018662383fd7d5d095446db7a`  
Hermes current `origin/main`：`29d0cc2602e01943ab300c0382fc9d97efb376da`（clean）

## 发现与修正

`docs/getting-started.zh.md` 的 EV-1 示例仍指向已淘汰的 Hermes `63279301…` epoch-3。当前脚本已切换到
epoch-4，继续保留 exact revision assertion；旧 epoch 仍只在历史证据中保留，不能作为当前结果复用。
示例已更新为 `29d0cc2602e01943ab300c0382fc9d97efb376da`，并明确结果漂移会 fail closed。

## 验证

```text
pnpm run check:docs
git diff --check
```

两项均通过。该修正只同步维护者验收命令，不改变 Hermes paired 门禁状态，也不把确定性 EV-1 结果包装成整体上位替代。

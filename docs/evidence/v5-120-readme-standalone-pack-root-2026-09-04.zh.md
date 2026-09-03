# V5.120：README 套件示例可独立执行

## 结果

中英文根 README 的按需安装示例现在先使用
`PACK_ROOT="${PACK_ROOT:-$(mktemp -d)}"`。用户可以单独复制渠道/交付代码块，不会因为前一个代码块未执行而
把 tarball 输出目录解析为空；已有核心安装流程保持不变。

## 验证

在 canonical DSH 最新 master fetch/clean preflight 后执行 `pnpm run check:docs` 和 `git diff --check`，均通过。
该改动只修正用户文档命令，不修改运行时、DSH 或外部状态。

## 未完成门禁

真实 Feishu AS-2、真实 Provider、Hermes paired、长期效果、Telegram 和 npm 命名空间门仍保持未通过。

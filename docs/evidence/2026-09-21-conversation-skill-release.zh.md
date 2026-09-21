# 普通纠正 Skill 接入未来会话版本（2026-09-21）

## 结果与限制

普通纠正原先止于草稿/对照，没有通往 Generation 的入口。本次在现有 Host 内接通独立语义评测后的人工确认、
未来会话加载与精确回滚，不伪造 Goal-qualified Candidate，也不建立第二运行时或版本库。
这是受控机制证据，不是真实学习收益。现有宽表纠正的历史字面检查仍为两边 0/4；统计总数纠正仍未形成草稿。
真实未见任务改善、文件/外部效果验收和同条件 Hermes 优势均未取得，不发布版本标签。

启用要求完整语义实验、可比组成、四个草稿答案通过、holdout 改善及正文实际加载、retention 两边通过、零退化，
并重新读取原纠正来源。历史字面结果或缺少基线封存的计划不能补授资格。有限同模型独立上下文裁判仍可能判错。
控制台区分生成、评测、可启用、未来版本与实际加载，返回完整转义正文，不返回受保护题目或答案。

当前会话继续固定原版本。回滚只改未来选择；恢复同一基线后，新的页面确认可启用同一内容地址版本。
过期确认序号被拒绝，原实验不重评、不改写。撤回学习或评测策略阻止新启用；关闭未来语义评测本身不抹去已完成证据。
卸载停止新工作并等待已接受操作完成，保留历史。旧二进制不保证读取新谱系，不能覆盖账本降级。

## 固定核心与权限

开发基点为 EvoForge `338f276c35fae1f227dcdf393a8a1074079800e0`，只更改演化 Host/Web 及对应契约。
9月21日 canonical fetch 成功：检出 `5dda764`、origin/master `ddefc45`，工作树干净。
支持检出仍为 `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720` / DSH `0.1.6-alpha.1`，没有改动核心，
不是最新 alpha.2 支持声明。支持检出的 `pnpm install --frozen-lockfile --ignore-scripts` 与官方 `pnpm run build` 均通过。
Host/Web 动作不调用模型；模型可见变化仅为用户确认后新 Session 的原生 Skill 目录/按需正文。
不修改当前凭据、权限、反馈、来源会话、付费策略或旧实验，不增加模型请求。

## 执行过的验证

下列 `DSH_EVOLVE_DSH_SOURCE_DIR` 与 `DSH_SOURCE_ROOT` 均指向上述固定支持检出。

- `DSH_EVOLVE_DSH_SOURCE_DIR=… pnpm --filter dsh-evolve exec vitest run test/conversation-correction-native.e2e.test.ts --maxWorkers 1`：
  修改测试后先出现 4 通过/1 失败（缺少确认序号）；实现后 5 通过。最早未提供环境变量的 5 项跳过不计为通过。
- 最终 `DSH_EVOLVE_DSH_SOURCE_DIR=… NODE_OPTIONS=--experimental-transform-types pnpm --filter dsh-evolve exec vitest run
  test/conversation-correction-native.e2e.test.ts test/generation-store.e2e.test.ts test/generation-binder.e2e.test.ts
  test/workspace-generation-store.e2e.test.ts --maxWorkers 1`：4 文件 25 项通过。
  覆盖真实原生无 Goal 纠正、封存、隔离分支、原生 skill Tool 读到完整正文、回滚后新 Session 无加载、旧 Session 不变、
  过期启用拒绝、重新确认复用同 Generation，以及冷启保留四次选择事件。模型为确定性替身，不据此声称质量提高。
- Host 另外一组对照存储、控制面、Remote、binder、原生纠正回归：5 文件 37 项通过，与上述原生测试有重叠，不加总。
- Web `test/evolution-action.client.test.tsx`：45 项通过；启用确认携带内容 hash 和页面选择序号，回滚携带 exact Generation。
  展示正文不执行 HTML；回滚后的第二次确认携带新序号，不误调旧 Candidate 晋升接口。
- Host/Web 测试 TypeScript 检查、官方 `generate:typert`、两个包 build、`check:docs`、`check:ci`、`check:suites`
  （15 项）与 `git diff --check` 通过。
- `DSH_EVOLVE_DSH_SOURCE_DIR=… pnpm --filter dsh-software-delivery exec vitest run test/clean-profile-suite.e2e.test.ts --maxWorkers 1`：
  首轮 1 通过/1 失败；安装遇 npm ECONNRESET 并超过命令时限，未进入启动门禁。确认 pnpm 11 不读取该测试原有
  `npm_config_store_dir`，随后仅在运行命令指定 `pnpm_config_store_dir` / `pnpm_config_cache_dir` 为本地现有缓存，
  不改测试断言或核心，第二轮 2 项通过（41.95 秒）。覆盖12包 add/dump/boot、原生 Session/Goal/Storage、dispose、
  remove 和 native readback。源码加载测试的 Node 参数用于既有非可擦除 TypeScript，不代表生产需要该参数。

## 本机部署

两个 exact tarball 已生成并保存在本机持久内容地址，尚未在本段记录生产切换成功。
生产验收必须另外核对唯一 Host、原生历史前缀、私有账本、策略与实际 Web；安装测试不代替这些结果。

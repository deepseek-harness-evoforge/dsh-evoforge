import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ignoredDirectories = new Set(['.evoforge', '.git', 'dist', 'node_modules'])
const markdownLink = /\[[^\]]*\]\(([^)]+)\)/g
const forbiddenPublicText = ['/Users/my/', '/home/runner/', 'file://', 'oh-my-dsh']
const removedStandaloneCli = /\bdsh-evolve\s+(?:shadow|calibrate|retain)\b|\bdsh-delivery\s+verify\b/u
const staleControlSurfaceGuide = ['打开侧栏“渠道健康', '打开侧栏"渠道健康', '渠道健康”面板', '渠道健康"面板', 'Router 配成 `routes: []`']
const duplicateWebStartupGuide = /^dsh --profile web[ \t]*$/mu
// Registry packages are intentionally unpublished while the public namespace
// gate is blocked. Operational docs must point at a repository-built tarball,
// never a bare dsh-* name that could resolve to an unrelated npm package.
const unpublishedRegistryInstall = /dsh plugin[^\n]*\badd\s+dsh-[a-z0-9-]+(?:\s|$)/iu
const failures = []

for (const file of await markdownFiles(repositoryRoot)) {
  const source = await readFile(file, 'utf8')
  const relative = relativeFile(file)
  for (const text of forbiddenPublicText) {
    if (source.includes(text)) failures.push(`${relative} contains private or legacy text: ${text}`)
  }

  if (removedStandaloneCli.test(source)) {
    if (isOperationalDoc(relative)) {
      failures.push(`${relative} invokes a removed standalone EvoForge CLI; use native DSH Commands/Jobs/Tools`)
    } else if (!source.includes('ADR-0041')) {
      failures.push(`${relative} mentions a removed standalone EvoForge CLI without an ADR-0041 supersession marker`)
    }
  }

  if (isOperationalDoc(relative) && staleControlSurfaceGuide.some(text => source.includes(text))) {
    failures.push(`${relative} contains the retired sidebar/Router channel-health guide; use native Control Center → Channels`)
  }

  if (isOperationalDoc(relative) && duplicateWebStartupGuide.test(source)) {
    failures.push(`${relative} starts DSH Web without --no-open; tell users to reuse one browser tab instead of launching another handoff`)
  }
  if (isOperationalDoc(relative) && unpublishedRegistryInstall.test(source)) {
    failures.push(`${relative} installs an unpublished bare dsh-* registry name; build and install a local suite tarball instead`)
  }

  for (const match of source.matchAll(markdownLink)) {
    const rawTarget = match[1]?.trim()
    if (!rawTarget || /^(?:https?:|mailto:|#)/.test(rawTarget)) continue
    const target = rawTarget.replace(/^<|>$/g, '').split('#', 1)[0]?.split('?', 1)[0]
    if (!target) continue
    if (isAbsolute(target)) {
      failures.push(`${relative} has an absolute local link: ${rawTarget}`)
      continue
    }
    const path = resolve(dirname(file), decodeURIComponent(target))
    try {
      await access(path)
    } catch {
      failures.push(`${relative} has a missing local link: ${rawTarget}`)
    }
  }
}

const goalPromptPath = resolve(repositoryRoot, 'docs/goal-prompt.zh.md')
const goalPromptSource = await readFile(goalPromptPath, 'utf8')
const goalPromptBlocks = [...goalPromptSource.matchAll(/^```text\n([\s\S]*?)\n```/gmu)]
const goalPromptBlock = goalPromptBlocks[0]?.[1]
const hasFinalPromptBlock = goalPromptBlocks.length === 1
  && /```text\n[\s\S]*\n```\s*$/u.test(goalPromptSource)
if (goalPromptBlock === undefined || !hasFinalPromptBlock) {
  failures.push('docs/goal-prompt.zh.md must contain exactly one final ```text prompt block')
} else {
  if (goalPromptSource.length > 2_000) failures.push(`docs/goal-prompt.zh.md exceeds the 2,000-character codex goal budget: ${goalPromptSource.length}`)
  if (goalPromptBlock.includes('宿主 CLI')) failures.push('docs/goal-prompt.zh.md promises an unsupported host CLI; use the native DSH Web Host authority')
  if (!goalPromptBlock.includes('不得让我选择') || !goalPromptBlock.includes('继续下一个未通过门禁')) {
    failures.push('docs/goal-prompt.zh.md must require autonomous planning and continuation')
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`)
  process.exitCode = 1
} else {
  process.stdout.write('Documentation links and public-path checks passed.\n')
}

async function markdownFiles(root) {
  const files = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
    const path = resolve(root, entry.name)
    if (entry.isDirectory()) files.push(...await markdownFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(path)
  }
  return files
}

function relativeFile(file) {
  return file.slice(repositoryRoot.length + 1)
}

function isOperationalDoc(file) {
  return file === 'README.md'
    || file === 'README.en.md'
    || file === 'docs/getting-started.zh.md'
    || /^packages\/[^/]+\/README(?:\.[^/]+)?\.md$/u.test(file)
    || /^skills\/[^/]+\/SKILL\.md$/u.test(file)
}

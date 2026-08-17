import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ignoredDirectories = new Set(['.evoforge', '.git', 'dist', 'node_modules'])
const markdownLink = /\[[^\]]*\]\(([^)]+)\)/g
const forbiddenPublicText = ['/Users/my/', '/home/runner/', 'file://', 'oh-my-dsh']
const removedStandaloneCli = /\bdsh-evolve\s+(?:shadow|calibrate|retain)\b|\bdsh-delivery\s+verify\b/u
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

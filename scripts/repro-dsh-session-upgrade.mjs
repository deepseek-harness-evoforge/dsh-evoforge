import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Keyless, synthetic storage-contract probe. No user profile or Agent policy is read.
const script = fileURLToPath(import.meta.url)
const id = 'evoforge-cross-version-history'
const before = 'Synthetic history before runtime upgrade.'
const after = 'Synthetic history after runtime upgrade.'
const args = process.argv.slice(2)
if (args[0] === '--phase') {
  await phase(...args.slice(1))
} else {
  const [oldSource, newSource, flag] = args
  assert.ok(args.length === 2 || (args.length === 3 && flag === '--require-safe-downgrade'),
    'usage: repro-dsh-session-upgrade.mjs <built-alpha5> <built-rc2> [--require-safe-downgrade]')
  for (const [source, expected] of [
    [oldSource, 'db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5'],
    [newSource, 'c291e7961a515f6d7af9304e7fd1d257929aef26'],
  ]) {
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim(), expected)
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: source, encoding: 'utf8' }).trim(), '')
  }
  const root = await mkdtemp(join(tmpdir(), 'evoforge-dsh-upgrade-'))
  const downgradeResults = []
  try {
    for (const compression of ['none', 'zstd']) {
      const data = join(root, compression)
      const run = (name, source) => JSON.parse(execFileSync(process.execPath,
        [script, '--phase', name, source, data, compression],
        { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 }))
      const seeded = run('seed', oldSource)
      const original = await inventory(data)
      const read = run('read', newSource)
      assert.equal(read.version, 3)
      assert.deepEqual(read.identity, seeded.identity)
      assert.equal(read.hasBefore, true)
      assert.equal(read.hasAfter, false)
      assert.equal(read.readOnlyDenied, true)
      assert.deepEqual(await inventory(data), original, 'read migration must not alter disk')
      const write = run('append', newSource)
      assert.equal(write.hasBefore, true)
      assert.equal(write.hasAfter, true)
      const upgraded = await inventory(data)
      for (const [path, hash] of Object.entries(original)) assert.equal(upgraded[path], hash)
      assert.ok(Object.keys(upgraded).length > Object.keys(original).length, 'write must publish a successor')
      const cold = run('read', newSource)
      assert.equal(cold.hasBefore && cold.hasAfter, true, 'new history must survive a new process')
      const downgrade = run('inspect-old', oldSource)
      downgradeResults.push(downgrade)
      assert.deepEqual(await inventory(data), upgraded, 'old read must not alter upgraded storage')
      process.stdout.write(`${JSON.stringify({ compression, readOnlyMigration: 'passed',
        sourceBytesPreserved: true, newProcessReadback: 'passed', downgrade })}\n`)
    }
    if (flag === '--require-safe-downgrade') {
      assert.ok(downgradeResults.every(result => result.hasAfter === true
        || (result.status === 'refused' && result.error === 'SessionFormatUnsupportedError')),
      'old runtime silently exposes stale pre-upgrade history; binary-only downgrade is unsafe')
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function phase(mode, source, root, compression) {
  assert.ok(['seed', 'append', 'read', 'inspect-old'].includes(mode))
  const load = path => import(pathToFileURL(join(source, path, 'lib/index.js')).href)
  const { Context } = await load('vendor/cordis')
  const { default: SessionStore, SessionId } = await load('packages/core/session')
  const { default: Persistence } = await load('packages/session/session-persistence-jsonl')
  const llm = await load('packages/llm/llm')
  const ctx = new Context()
  try {
    await ctx.plugin(SessionStore)
    await ctx.plugin(Persistence, { root, compression })
    if (mode === 'seed' || mode === 'append') {
      await ctx.plugin(llm.default)
      for (const path of ['packages/session/session-projection', 'packages/core/system-prompt',
        'packages/core/tools', 'packages/core/agent']) {
        await ctx.plugin((await load(path)).default)
      }
      const requests = []
      class Adapter extends llm.LlmAdapter {
        async resolveModel(provider, model) { return { provider, id: model, name: model } }
        async * stream(options) {
          requests.push(JSON.stringify(options))
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text: 'Synthetic response.' }
          yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Synthetic response.' } }
          yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        }
      }
      ctx.llm.registerAdapter(['upgrade-fixture'], new Adapter())
      await ctx.plugin((await load('packages/core/agent-loop')).default, { agents: [] })
      const agentOptions = { provider: 'upgrade-fixture', model: 'upgrade-fixture' }
      const handle = mode === 'seed'
        ? await ctx.agents.create({ sessionId: SessionId(id), agentOptions })
        : await ctx.agents.resume({ resumeSessionId: SessionId(id), agentOptions })
      handle.agent.followup(llm.createUserMessage({
        content: [{ type: 'text', text: mode === 'seed' ? before : after }], source: { kind: 'user' },
      }))
      await handle.agent.whenIdle()
      assert.equal(requests.length, 1)
      assert.ok(requests[0].includes(before), 'old input must remain in the actual LLM request')
      if (mode === 'append') assert.ok(requests[0].includes(after))
      const session = handle.agent.session
      const events = session.snapshotEvents()
      assert.equal(events.at(-1)?.type, 'turn/end')
      assert.equal(events.at(-1)?.data.reason.kind, 'completed')
      await ctx.sessions.flush(session)
      process.stdout.write(JSON.stringify(summary(session.header, events)))
    } else if (mode === 'inspect-old') {
      let result
      try {
        const value = await ctx.sessionPersistence.load(SessionId(id))
        result = { status: 'readable', ...summary(value.header ?? value.meta, value.events) }
      } catch (error) {
        result = { status: 'refused', error: error.name }
      }
      process.stdout.write(JSON.stringify(result))
    } else {
      const handle = await ctx.sessionPersistence.open(SessionId(id), 'read')
      try {
        let readOnlyDenied = false
        await assert.rejects(handle.append([]), error => {
          readOnlyDenied = error.name === 'SessionReadOnlyError'
          return readOnlyDenied
        })
        process.stdout.write(JSON.stringify({ ...summary(handle.header, (await handle.read()).events), readOnlyDenied }))
      } finally {
        await handle.close()
      }
    }
  } finally {
    await ctx.fiber.dispose()
  }
}

function summary(header, events) {
  const text = JSON.stringify(events)
  return { version: header?.version,
    identity: { id: header?.id, createdAt: header?.createdAt, cwd: header?.cwd ?? null,
      isSeeded: header?.isSeeded, parentSession: header?.parentSession ?? null,
      delegationDepth: header?.delegationDepth ?? 0 },
    hasBefore: text.includes(before), hasAfter: text.includes(after) }
}

async function inventory(root, dir = root) {
  const result = {}
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) Object.assign(result, await inventory(root, path))
    else result[relative(root, path)] = createHash('sha256').update(await readFile(path)).digest('hex')
  }
  return result
}

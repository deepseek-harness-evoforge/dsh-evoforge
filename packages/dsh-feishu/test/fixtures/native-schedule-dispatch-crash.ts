import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { bootLatestDshProfile } from '../latest-dsh-test-runtime.ts'

const [root, config, dshSourceDir] = process.argv.slice(2)
if (root === undefined || config === undefined || dshSourceDir === undefined) {
  throw new Error('usage: native-schedule-dispatch-crash <root> <config> <dsh-source-dir>')
}

process.chdir(root)
const ctx = await bootLatestDshProfile({
  binName: 'dsh-feishu-schedule-dispatch-crash',
  configPath: config,
  dshSourceDir,
  home: process.env.DSH_HOME ?? join(root, '.dsh-home'),
})
const agent = ctx.agents.get('main')
if (agent === undefined) throw new Error('Feishu dispatch-crash fixture Agent did not load')
await agent.whenIdle()
const scheduled = await ctx.agents.withInitiator(agent, () => ctx.tools.execute({
  signal: new AbortController().signal,
  callId: ToolCallId('feishu-schedule-dispatch-crash'),
  name: 'schedule_create',
  arguments: {
    prompt: 'Deliver this reminder exactly once across the dispatch checkpoint crash.',
    // Leave enough startup headroom to install the crash seam before due time.
    after_seconds: 5,
  },
  agent,
}))
if (scheduled.isError) throw new Error('Feishu dispatch-crash fixture failed to create the native Schedule')

let resolveDispatchBlocked: (() => void) | undefined
const dispatchBlocked = new Promise<void>((resolveBlocked) => {
  resolveDispatchBlocked = resolveBlocked
})
type PersistenceBackend = {
  appendBatch?: (...args: unknown[]) => Promise<void>
  persistBatch?: (...args: unknown[]) => Promise<void>
}
const persistence = ctx.sessionPersistence as unknown as {
  coordinator?: { backend?: PersistenceBackend }
  appendBatch?: (...args: unknown[]) => Promise<void>
  persistBatch?: (...args: unknown[]) => Promise<void>
}
const backend = persistence.coordinator?.backend ?? persistence
const methodName: 'appendBatch' | 'persistBatch' = backend.appendBatch !== undefined ? 'appendBatch' : 'persistBatch'
const appendBatch = backend[methodName]
if (typeof appendBatch !== 'function') throw new Error('alpha5 persistence appendBatch seam is unavailable')
const boundAppendBatch = appendBatch.bind(backend)
backend[methodName] = async (...args: unknown[]) => {
  const events = (args[1] ?? []) as readonly {
    readonly type?: unknown
    readonly data?: { readonly operation?: unknown }
  }[]
  if (events.some(event => event.type === 'schedule/change' && event.data?.operation === 'dispatch')) {
    resolveDispatchBlocked?.()
    await new Promise<void>(() => {})
  }
  await boundAppendBatch(...args)
}

await ctx.sessions.flush(agent.session)
await Promise.all([
  dispatchBlocked,
  waitForEffect(join(root, 'platform-effects.jsonl')),
])
process.stdout.write('PLATFORM_EFFECT_BEFORE_DISPATCH_DURABLE\n')
setInterval(() => {}, 60_000)

async function waitForEffect(path: string): Promise<void> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      if ((await readFile(path, 'utf8')).trim().length > 0) return
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await wait(10)
  }
  throw new Error('Feishu dispatch-crash fixture observed no platform effect')
}

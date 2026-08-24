import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { CallId } from '@deepseek-ai/dsh-llm'

const [root, config, dshSourceDir] = process.argv.slice(2)
if (root === undefined || config === undefined || dshSourceDir === undefined) {
  throw new Error('usage: native-schedule-dispatch-crash <root> <config> <dsh-source-dir>')
}

const { boot } = await import(pathToFileURL(
  join(dshSourceDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js'),
).href)
process.chdir(root)
const ctx = await boot('dsh-feishu-schedule-dispatch-crash', config)
const agent = ctx.agents.get('main')
if (agent === undefined) throw new Error('Feishu dispatch-crash fixture Agent did not load')
await agent.whenIdle()
const scheduled = await ctx.agents.withInitiator(agent, () => ctx.tools.execute({
  signal: new AbortController().signal,
  callId: CallId('feishu-schedule-dispatch-crash'),
  name: 'schedule_create',
  arguments: {
    prompt: 'Deliver this reminder exactly once across the dispatch checkpoint crash.',
    after_seconds: 1,
  },
  agent,
}))
if (scheduled.isError) throw new Error('Feishu dispatch-crash fixture failed to create the native Schedule')
await ctx.sessions.flush(agent.session)

let resolveDispatchBlocked: (() => void) | undefined
const dispatchBlocked = new Promise<void>((resolveBlocked) => {
  resolveDispatchBlocked = resolveBlocked
})
const persistence = ctx.sessionPersistence as unknown as {
  appendBatch(
    meta: unknown,
    events: readonly { readonly type?: unknown; readonly data?: { readonly operation?: unknown } }[],
    isMaterialized: boolean,
  ): Promise<void>
}
const appendBatch = persistence.appendBatch.bind(persistence)
persistence.appendBatch = async (meta, events, isMaterialized) => {
  if (events.some(event => event.type === 'schedule/change' && event.data?.operation === 'dispatch')) {
    resolveDispatchBlocked?.()
    await new Promise<void>(() => {})
  }
  await appendBatch(meta, events, isMaterialized)
}

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

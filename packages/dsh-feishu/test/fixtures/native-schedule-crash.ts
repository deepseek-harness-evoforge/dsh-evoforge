import { join } from 'node:path'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { bootLatestDshProfile } from '../latest-dsh-test-runtime.ts'

const [root, config, dshSourceDir] = process.argv.slice(2)
if (root === undefined || config === undefined || dshSourceDir === undefined) {
  throw new Error('usage: native-schedule-crash <root> <config> <dsh-source-dir>')
}

process.chdir(root)
const ctx = await bootLatestDshProfile({
  binName: 'dsh-feishu-schedule-crash-seed',
  configPath: config,
  dshSourceDir,
  home: process.env.DSH_HOME ?? join(root, '.dsh-home'),
})
const agent = ctx.agents.get('main')
if (agent === undefined) throw new Error('Feishu crash fixture Agent did not load')
await agent.whenIdle()
if (ctx.tools.get('schedule_create', agent) === undefined) {
  throw new Error('Feishu crash fixture Schedule Tool did not load')
}
const scheduled = await ctx.agents.withInitiator(agent, () => ctx.tools.execute({
  signal: new AbortController().signal,
  callId: ToolCallId('feishu-schedule-before-sigkill'),
  name: 'schedule_create',
  arguments: {
    prompt: 'Deliver this durable reminder after the DSH Host process is killed.',
    after_seconds: 1,
  },
  agent,
}))
if (scheduled.isError) throw new Error('Feishu crash fixture failed to create the native Schedule')
if (agent.session.snapshotEvents().some((event: unknown) => {
  if (typeof event !== 'object' || event === null) return false
  const value = event as { readonly type?: unknown; readonly data?: { readonly operation?: unknown } }
  return value.type === 'schedule/change' && value.data?.operation === 'dispatch'
})) {
  throw new Error('Feishu crash fixture reminder dispatched before the crash boundary')
}
await ctx.sessions.flush(agent.session)
process.stdout.write('READY\n')
setInterval(() => {}, 60_000)

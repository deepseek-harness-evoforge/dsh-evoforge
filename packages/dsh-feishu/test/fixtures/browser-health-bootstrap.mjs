export const name = 'evoforge-feishu-browser-health-bootstrap'
export const inject = ['agents', 'commands', 'evoforge.feishuTest']

/** Make the test-owned route Session visible without sending a message or invoking a model. */
export async function apply(ctx, config) {
  const agent = ctx.agents.get(config.sessionId)
  if (agent === undefined) throw new Error(`browser health Session ${config.sessionId} is unavailable`)
  const execution = await ctx.commands.execute(agent, '/feishu', new AbortController().signal)
  if (execution?.result.kind !== 'success') {
    throw new Error(`browser health seed Command failed: ${execution?.result.text ?? 'no result'}`)
  }
  if (!agent.session.snapshotEvents().some(event => event.type === 'turn/start')) {
    // DSH intentionally hides non-current blank Sessions. A completed empty
    // acceptance-only turn makes this route selectable without a provider call.
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  }
  ctx.provide('evoforge.feishuBrowserHealthTest', Object.freeze({ execution }))
}

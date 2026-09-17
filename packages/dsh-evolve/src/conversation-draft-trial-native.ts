import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage, isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SkillRegistration } from '@deepseek-ai/dsh-skill'
import { deadline } from '@deepseek-ai/dsh-timeout'
import { installConversationDraftTrialGuard } from './conversation-draft-trial-guard.ts'

export interface ConversationDraftTrialLegInput {
  readonly sessionId: SessionId
  readonly cwd: string
  /** Only the task, never expectations, negative answers, or judge feedback. */
  readonly input: string
  readonly provider: string
  readonly model: string
  readonly draft?: { readonly name: string; readonly description: string; readonly markdown: string; readonly contentHash: string }
  readonly signal: AbortSignal
  readonly beforeDispatch: (call: number) => Promise<void>
}

export const CONVERSATION_TRIAL_PROVIDER = 'evoforge-conversation-draft-trial'

/**
 * One bounded native leg, not a promotion or evaluation verdict. The caller
 * owns plan reservation, Job cancellation/drain, results and crash recovery.
 * Events remain private; they contain the task and native model composition.
 */
export async function runConversationDraftTrialLeg(
  ctx: Context,
  input: ConversationDraftTrialLegInput,
): Promise<{ readonly events: readonly SessionEvent[]; readonly requestSnapshots: readonly string[];
  readonly dispatchMarkers: number; readonly elapsedMs: number }> {
  const frozen = { ...input, draft: input.draft === undefined ? undefined : { ...input.draft } }
  if (!frozen.input.trim() || frozen.input.length > 4000) throw new Error('invalid conversation trial input')
  let registration: SkillRegistration | undefined
  if (frozen.draft !== undefined) {
    const draft = frozen.draft
    const prefix = `---\nname: ${draft.name}\ndescription: ${JSON.stringify(draft.description)}\n---\n\n`
    if (!draft.markdown.startsWith(prefix)
      || createHash('sha256').update(draft.markdown).digest('hex') !== draft.contentHash) {
      throw new Error('conversation trial draft identity mismatch')
    }
    registration = { name: draft.name, description: draft.description, content: draft.markdown.slice(prefix.length),
      source: 'runtime', provider: CONVERSATION_TRIAL_PROVIDER,
      invocation: { modelInvocable: true, userInvocable: false } }
  }
  let dispatchMarkers = 0
  const started = Date.now()
  using limit = deadline(frozen.signal, 90_000, 'EVOFORGE_CONVERSATION_TRIAL_TIMEOUT')
  limit.signal.throwIfAborted()
  if (ctx.agents.get(frozen.sessionId) !== undefined || ctx.sessions.get(frozen.sessionId) !== undefined) {
    throw new Error('conversation trial requires a fresh Session identity')
  }
  const requestSnapshots: string[] = []
  // This native event is unscoped. Exact fresh Session identity is essential:
  // no other Agent's requests or auxiliary work may be observed or changed.
  const detachRequest = ctx.on('llm/stream', async function* (options, next) {
    if (options.sessionId !== frozen.sessionId) { yield* next(); return }
    if (!isAgentLoopRequest(options) || options.purpose !== undefined
      || options.provider !== frozen.provider || options.model !== frozen.model || options.maxTokens !== 2000
      || requestSnapshots.length >= dispatchMarkers || requestSnapshots.length >= 3 || limit.signal.aborted) {
      throw new Error('conversation trial received an unreserved model request')
    }
    const tasks = options.messages.filter(message => message.role === 'user'
      && message.source.kind === 'plugin' && message.source.plugin === 'dsh-evolve')
    if (tasks.length !== 1 || JSON.stringify(tasks[0]?.content) !== JSON.stringify([{ type: 'text', text: frozen.input }])) {
      throw new Error('conversation trial task composition changed')
    }
    const { signal: _signal, ...snapshot } = options
    const serialized = JSON.stringify(snapshot)
    if (Buffer.byteLength(serialized) > 128_000) throw new Error('conversation trial request exceeds trace bound')
    requestSnapshots.push(serialized)
    yield* next()
  }, { prepend: true })
  let handle: AgentHandle | undefined
  let cancel: (() => void) | undefined
  try {
    handle = await ctx.agents.create({
      sessionId: frozen.sessionId, meta: { cwd: frozen.cwd }, signal: limit.signal,
      agentOptions: { provider: frozen.provider, model: frozen.model, maxTokens: 2000 },
      async setup(scoped, agent) {
        let ready = false
        await scoped.inject(['skills', 'tools'], async scoped => {
          if (registration !== undefined) {
            const existing = await scoped.skills.list({ cwd: frozen.cwd, scope: agent, signal: limit.signal })
            if (existing.some(skill => skill.name === registration.name)) throw new Error('conversation trial draft name collision')
            scoped.skills.register(registration)
          }
          installConversationDraftTrialGuard(scoped, agent, {
            provider: frozen.provider, model: frozen.model, maxTokens: 2000, maxCalls: 3,
            async beforeDispatch(call) {
              await frozen.beforeDispatch(call)
              dispatchMarkers = call
            },
          })
          ready = true
        })
        if (!ready) throw new Error('conversation trial dependencies unavailable')
      },
    })
    cancel = (): void => { handle?.agent.cancel({ kind: 'hook', reason: 'conversation trial cancelled or timed out' }) }
    limit.signal.addEventListener('abort', cancel, { once: true })
    limit.signal.throwIfAborted()
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: frozen.input }], source: { kind: 'plugin', plugin: 'dsh-evolve' },
    }))
    await handle.agent.whenIdle()
    // The native Session owns all request, Skill, usage, and terminal facts.
    // An idle or interrupted Agent is not automatically a completed answer.
    const events = handle.agent.session.snapshotEvents()
    return { events, requestSnapshots, dispatchMarkers, elapsedMs: Date.now() - started }
  } finally {
    if (cancel !== undefined) limit.signal.removeEventListener('abort', cancel)
    try { await handle?.dispose() } finally { detachRequest() }
  }
}

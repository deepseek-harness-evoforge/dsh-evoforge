import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SkillRegistration } from '@deepseek-ai/dsh-skill'
import { deadline } from '@deepseek-ai/dsh-timeout'
import { installConversationDraftTrialGuard } from './conversation-draft-trial-guard.ts'
import { prepareConversationFileTrial, FILE_TRIAL_MAX_CALLS, FILE_TRIAL_MAX_TOKENS, FILE_TRIAL_DEADLINE_MS,
  type FileTrialBounds, type FileTrialEvidence } from './conversation-file-trial.ts'

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
  /** Sealed input bytes and output names only; never expected answers or oracle code. */
  readonly fileWorkflow?: FileTrialBounds
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
  readonly dispatchMarkers: number; readonly elapsedMs: number; readonly fileEvidence?: FileTrialEvidence }> {
  const frozen = { ...input, draft: input.draft === undefined ? undefined : { ...input.draft },
    fileWorkflow: input.fileWorkflow === undefined ? undefined : structuredClone(input.fileWorkflow) }
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
  let requestSignal: AbortSignal | undefined
  const started = Date.now()
  const maxCalls = frozen.fileWorkflow === undefined ? 3 : FILE_TRIAL_MAX_CALLS
  const maxTokens = frozen.fileWorkflow === undefined ? 2000 : FILE_TRIAL_MAX_TOKENS
  using limit = deadline(frozen.signal, frozen.fileWorkflow === undefined ? 90_000 : FILE_TRIAL_DEADLINE_MS, 'EVOFORGE_CONVERSATION_TRIAL_TIMEOUT')
  limit.signal.throwIfAborted()
  if (ctx.agents.get(frozen.sessionId) !== undefined || ctx.sessions.get(frozen.sessionId) !== undefined) {
    throw new Error('conversation trial requires a fresh Session identity')
  }
  const fileTrial = frozen.fileWorkflow === undefined ? undefined
    : await prepareConversationFileTrial(ctx, frozen.cwd, frozen.fileWorkflow, limit.signal)
  const requestSnapshots: string[] = []
  // This native event is unscoped. Exact fresh Session identity is essential:
  // no other Agent's requests or auxiliary work may be observed or changed.
  const detachRequest = ctx.on('llm/stream', async function* (options, next) {
    if (options.sessionId !== frozen.sessionId) { yield* next(); return }
    // Correlate with the actual Agent request hook. A package-local WeakSet
    // marker cannot cross independently resolved Host/plugin module instances.
    if (requestSignal === undefined || options.signal !== requestSignal || options.purpose !== undefined
      || options.provider !== frozen.provider || options.model !== frozen.model || options.maxTokens !== maxTokens
      || requestSnapshots.length >= dispatchMarkers || requestSnapshots.length >= maxCalls || limit.signal.aborted) {
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
      agentOptions: { provider: frozen.provider, model: frozen.model, maxTokens },
      async setup(scoped, agent) {
        let ready = false
        await scoped.inject(['skills', 'tools'], async scoped => {
          if (registration !== undefined) {
            const existing = await scoped.skills.list({ cwd: frozen.cwd, scope: agent, signal: limit.signal })
            if (existing.some(skill => skill.name === registration.name)) throw new Error('conversation trial draft name collision')
            scoped.skills.register(registration)
          }
          await installConversationDraftTrialGuard(scoped, agent, {
            provider: frozen.provider, model: frozen.model, maxTokens, maxCalls,
            ...(fileTrial === undefined ? {} : { fileTrial }),
            async beforeDispatch(call, signal) {
              await frozen.beforeDispatch(call)
              dispatchMarkers = call
              requestSignal = signal
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
    return { events, requestSnapshots, dispatchMarkers, elapsedMs: Date.now() - started,
      ...(fileTrial === undefined ? {} : { fileEvidence: await fileTrial.snapshot(events) }) }
  } finally {
    if (cancel !== undefined) limit.signal.removeEventListener('abort', cancel)
    try { await handle?.dispose() } finally { detachRequest() }
  }
}

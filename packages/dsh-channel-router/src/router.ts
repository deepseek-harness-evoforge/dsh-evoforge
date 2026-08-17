import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { parseCommand } from '@deepseek-ai/dsh-commands'
import { freezeMessage, MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent, type SessionHeader, type UserMessage } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { WorkspaceId, type Workspace } from '@deepseek-ai/dsh-workspace'
import type {
  ChannelCommandResult,
  ChannelIngressRecord,
  ChannelIngressStore,
} from './ingress-store.js'
import type {
  ChannelEndpoint,
  ResolvedChannelRoute,
  ResolvedChannelRoutes,
} from './routes.js'

export interface ChannelDispatchInput {
  readonly endpoint: ChannelEndpoint
  /** Adapter-owned stable id for one inbound event. */
  readonly eventId: string
  readonly text: string
  readonly signal?: AbortSignal
}

interface ChannelDispatchBase {
  readonly route: ResolvedChannelRoute
  readonly agent: Agent
  readonly duplicate: boolean
  readonly ingressId: string
}

export type ChannelDispatchResult =
  | (ChannelDispatchBase & { readonly kind: 'message' })
  | (ChannelDispatchBase & { readonly kind: 'command'; readonly result: ChannelCommandResult })

/** An accepted external event crossed an effect boundary whose outcome cannot be proven. */
export class ChannelIngressUncertainError extends Error {
  constructor(readonly ingressId: string, message: string) {
    super(`channel ingress '${ingressId}' is uncertain: ${message}`)
    this.name = 'ChannelIngressUncertainError'
  }
}

/**
 * The shared Host-side routing seam used by platform adapters. It owns no
 * network transport: adapters authenticate and poll, then submit an exact
 * endpoint tuple here for native Workspace/Session/Agent dispatch.
 */
export class ChannelRouter {
  private readonly ownedHandles = new Map<string, AgentHandle>()
  private readonly resolutions = new Map<string, Promise<Agent>>()
  private readonly ingressTails = new Map<string, Promise<void>>()
  private started = false
  private stopping?: Promise<void>

  constructor(
    private readonly ctx: Context,
    private readonly configured: ResolvedChannelRoutes,
    private readonly ingress: ChannelIngressStore,
  ) {}

  /** Validate the complete static binding table before any adapter accepts traffic. */
  async start(): Promise<void> {
    if (this.started) return
    if (this.stopping !== undefined) throw new Error('channel router is stopping')
    await this.ingress.recoverInflight(Date.now())
    const persisted = await this.ctx.sessionPersistence.list()
    const persistedById = new Map(persisted.map(header => [String(header.id), header]))
    for (const route of this.configured.routes) {
      const workspace = await this.requireWorkspace(route)
      await this.requirePreset(route)
      const live = this.ctx.agents.get(SessionId(route.sessionId))
      if (live !== undefined) {
        this.assertLiveIdentity(route, workspace, live)
        continue
      }
      if (persistedById.has(route.sessionId)) {
        const inspected = await this.ctx.sessionPersistence.inspect(SessionId(route.sessionId))
        this.assertPersistedIdentity(route, workspace, inspected.meta, inspected.events)
      }
    }
    this.started = true
  }

  route(id: string): ResolvedChannelRoute | undefined {
    return this.configured.byId.get(id)
  }

  match(endpoint: ChannelEndpoint): ResolvedChannelRoute | undefined {
    return this.configured.match(endpoint)
  }

  /** Stable native MessageId an adapter can use to correlate inbox/turn events before dispatch. */
  messageIdFor(endpoint: ChannelEndpoint, eventId: string): string {
    const route = this.configured.match(endpoint)
    if (route === undefined) throw new Error('no configured channel route for the exact external endpoint')
    const exactEventId = exactIngressText(eventId, 'eventId', 1_024)
    const eventHash = hash(`${route.endpointKey}\0${exactEventId}`)
    return `channel:${hash(`${route.id}\0${eventHash}`)}`
  }

  /** Resolve the exact configured native Agent without dispatching user input. */
  async resolve(routeOrId: ResolvedChannelRoute | string, signal?: AbortSignal): Promise<Agent> {
    this.assertRunning()
    const route = typeof routeOrId === 'string' ? this.configured.byId.get(routeOrId) : routeOrId
    if (route === undefined) throw new Error(`unknown channel route '${String(routeOrId)}'`)
    signal?.throwIfAborted()
    let pending = this.resolutions.get(route.sessionId)
    if (pending === undefined) {
      pending = this.resolveNativeAgent(route, signal).finally(() => {
        this.resolutions.delete(route.sessionId)
      })
      this.resolutions.set(route.sessionId, pending)
    }
    return await pending
  }

  dispatch(input: ChannelDispatchInput): Promise<ChannelDispatchResult> {
    this.assertRunning()
    const route = this.configured.match(input.endpoint)
    if (route === undefined) return Promise.reject(new Error('no configured channel route for the exact external endpoint'))
    const eventId = exactIngressText(input.eventId, 'eventId', 1_024)
    const text = exactIngressText(input.text, 'text', 1_048_576)
    const eventHash = hash(`${route.endpointKey}\0${eventId}`)
    const ingressId = hash(`${route.id}\0${eventHash}`)
    const contentHash = hash(text)
    const prior = this.ingressTails.get(ingressId) ?? Promise.resolve()
    const operation = prior.then(() => this.dispatchSerial({
      route, eventHash, ingressId, contentHash, text,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }))
    const tail = operation.then(() => {}, () => {})
    this.ingressTails.set(ingressId, tail)
    void tail.finally(() => {
      if (this.ingressTails.get(ingressId) === tail) this.ingressTails.delete(ingressId)
    })
    return operation
  }

  stop(): Promise<void> {
    this.stopping ??= (async () => {
      await Promise.allSettled(this.ingressTails.values())
      const handles = [...this.ownedHandles.values()]
      this.ownedHandles.clear()
      await Promise.allSettled(handles.map(handle => handle.dispose()))
      await this.ingress.close()
    })()
    return this.stopping
  }

  private async dispatchSerial(input: {
    route: ResolvedChannelRoute
    eventHash: string
    ingressId: string
    contentHash: string
    text: string
    signal?: AbortSignal
  }): Promise<ChannelDispatchResult> {
    input.signal?.throwIfAborted()
    const agent = await this.resolve(input.route, input.signal)
    const kind = this.commandIsRegistered(agent, input.text) ? 'command' : 'message'
    const prepared = await this.ingress.prepare({
      id: input.ingressId,
      routeId: input.route.id,
      workspaceId: input.route.workspaceId,
      sessionId: input.route.sessionId,
      eventHash: input.eventHash,
      contentHash: input.contentHash,
      kind,
      now: Date.now(),
    })
    if (!prepared.created) return this.replaySettled(input.route, agent, prepared.record)

    await this.ingress.begin(input.ingressId, Date.now())
    if (kind === 'message') {
      const messageId = `channel:${input.ingressId}`
      try {
        if (!messageSeen(agent, messageId)) {
          agent.followup(freezeMessage({
            id: MessageId(messageId),
            role: 'user',
            content: [{ type: 'text', text: input.text }],
            source: { kind: 'user' },
          } satisfies UserMessage))
        }
      } catch (error: unknown) {
        await this.ingress.markUncertain(input.ingressId, safeMessage(error), Date.now())
        throw error
      }
      await this.ingress.settleMessage(input.ingressId, Date.now())
      return Object.freeze({
        kind: 'message', route: input.route, agent, duplicate: false, ingressId: input.ingressId,
      })
    }

    let result: ChannelCommandResult
    try {
      const execution = await this.ctx.commands.execute(agent, input.text, input.signal ?? new AbortController().signal)
      result = execution === undefined
        ? { kind: 'error', text: 'The command is no longer registered.' }
        : boundedCommandResult(execution.result)
    } catch (error: unknown) {
      result = { kind: 'error', text: boundedText(safeMessage(error), 16_384) }
    }
    await this.ingress.settleCommand(input.ingressId, result, Date.now())
    return Object.freeze({
      kind: 'command', route: input.route, agent, duplicate: false, ingressId: input.ingressId, result,
    })
  }

  private replaySettled(
    route: ResolvedChannelRoute,
    agent: Agent,
    record: ChannelIngressRecord,
  ): ChannelDispatchResult {
    if (record.status === 'uncertain') {
      throw new ChannelIngressUncertainError(record.id, record.error ?? 'outcome is unknown')
    }
    if (record.status !== 'settled') {
      throw new ChannelIngressUncertainError(record.id, `retained state is ${record.status}`)
    }
    if (record.kind === 'command') {
      if (record.commandResult === undefined) throw new Error(`settled command ingress '${record.id}' has no result`)
      return Object.freeze({ kind: 'command', route, agent, duplicate: true, ingressId: record.id, result: record.commandResult })
    }
    return Object.freeze({ kind: 'message', route, agent, duplicate: true, ingressId: record.id })
  }

  private commandIsRegistered(agent: Agent, line: string): boolean {
    const parsed = parseCommand(line)
    return parsed !== undefined && this.ctx.commands.list(agent).some(command => command.name === parsed.name)
  }

  private async resolveNativeAgent(route: ResolvedChannelRoute, signal?: AbortSignal): Promise<Agent> {
    const workspace = await this.requireWorkspace(route)
    await this.requirePreset(route)
    const sessionId = SessionId(route.sessionId)
    const live = this.ctx.agents.get(sessionId)
    if (live !== undefined) {
      this.assertLiveIdentity(route, workspace, live)
      await workspace.attachSession(sessionId)
      return live
    }

    const header = (await this.ctx.sessionPersistence.list(signal)).find(item => item.id === sessionId)
    let handle: AgentHandle
    try {
      if (header === undefined) {
        handle = await this.ctx.agents.create({
          sessionId,
          meta: { cwd: workspace.path, agentPreset: route.agentPreset },
          agentOptions: routeAgentOptions(route),
          ...(signal === undefined ? {} : { signal }),
          setup: agentCtx => this.ctx.agentPresets.mount(agentCtx, route.agentPreset).then(() => undefined),
        })
      } else {
        const inspected = await this.ctx.sessionPersistence.inspect(sessionId, signal)
        this.assertPersistedIdentity(route, workspace, inspected.meta, inspected.events)
        handle = await this.ctx.agents.resume({
          resumeSessionId: sessionId,
          agentOptions: routeAgentOptions(route),
          ...(signal === undefined ? {} : { signal }),
          setup: agentCtx => this.ctx.agentPresets.mount(agentCtx, route.agentPreset).then(() => undefined),
        })
      }
    } catch (error: unknown) {
      const raced = this.ctx.agents.get(sessionId)
      if (raced === undefined) throw error
      this.assertLiveIdentity(route, workspace, raced)
      await workspace.attachSession(sessionId)
      return raced
    }

    try {
      this.assertLiveIdentity(route, workspace, handle.agent)
      await workspace.attachSession(sessionId)
    } catch (error: unknown) {
      await handle.dispose()
      throw error
    }
    this.ownedHandles.set(route.sessionId, handle)
    return handle.agent
  }

  private async requireWorkspace(route: ResolvedChannelRoute): Promise<Workspace> {
    const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(route.workspaceId))
    if (workspace === undefined) throw new Error(`channel route '${route.id}' names unknown Workspace '${route.workspaceId}'`)
    if (await workspace.status() !== 'ok') {
      throw new Error(`channel route '${route.id}' Workspace '${route.workspaceId}' directory is missing`)
    }
    return workspace
  }

  private async requirePreset(route: ResolvedChannelRoute): Promise<void> {
    const preset = await this.ctx.agentPresets.resolve(route.agentPreset)
    if (preset.broken !== undefined) {
      throw new Error(`channel route '${route.id}' Agent preset '${route.agentPreset}' is broken: ${preset.broken}`)
    }
  }

  private assertLiveIdentity(route: ResolvedChannelRoute, workspace: Workspace, agent: Agent): void {
    this.assertSessionIdentity(route, workspace, agent.session.header, agent.session.events)
    if (agent.options.provider !== route.provider || agent.options.model !== route.model
      || (route.maxTokens !== undefined && agent.options.maxTokens !== route.maxTokens)) {
      throw new Error(`channel session '${route.sessionId}' live Agent model does not match route '${route.provider}/${route.model}'`)
    }
    const composed = this.ctx.agentPresets.composedPreset(agent.ctx)
    if (composed !== route.agentPreset) {
      throw new Error(`channel session '${route.sessionId}' live Agent preset is '${String(composed)}', expected '${route.agentPreset}'`)
    }
  }

  private assertPersistedIdentity(
    route: ResolvedChannelRoute,
    workspace: Workspace,
    header: SessionHeader,
    events: readonly SessionEvent[],
  ): void {
    this.assertSessionIdentity(route, workspace, header, events)
  }

  private assertSessionIdentity(
    route: ResolvedChannelRoute,
    workspace: Workspace,
    header: SessionHeader,
    events: readonly SessionEvent[],
  ): void {
    if (String(header.id) !== route.sessionId) {
      throw new Error(`channel persistence returned session '${String(header.id)}', expected '${route.sessionId}'`)
    }
    if (header.cwd !== workspace.path) {
      throw new Error(`channel session '${route.sessionId}' cwd is '${String(header.cwd)}', expected Workspace path '${workspace.path}'`)
    }
    const preset = sessionPreset(header, events)
    if (preset !== route.agentPreset) {
      throw new Error(`channel session '${route.sessionId}' preset is '${String(preset)}', expected '${route.agentPreset}'`)
    }
  }

  private assertRunning(): void {
    if (!this.started) throw new Error('channel router has not started')
    if (this.stopping !== undefined) throw new Error('channel router is stopping')
  }
}

function messageSeen(agent: Agent, messageId: string): boolean {
  if (agent.inbox.nextTurn.some(message => message.id === messageId)
    || agent.inbox.nextStep.some(message => message.id === messageId)) return true
  return agent.session.events.some((event) => {
    if (event.type === 'user/message') return event.data.id === messageId
    return event.type === 'agent/inbox/spliced'
      && event.data.inserted.some(message => message.id === messageId)
  })
}

function sessionPreset(header: SessionHeader, events: readonly SessionEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'agent-preset/selected') return event.data.agentPreset
  }
  return header.agentPreset
}

function boundedCommandResult(result: { kind: 'success' | 'error'; text?: string }): ChannelCommandResult {
  return Object.freeze({
    kind: result.kind,
    ...(result.text === undefined ? {} : { text: boundedText(result.text, 16_384) }),
  })
}

function routeAgentOptions(route: ResolvedChannelRoute): {
  provider: string
  model: string
  maxTokens?: number
} {
  return {
    provider: route.provider,
    model: route.model,
    ...(route.maxTokens === undefined ? {} : { maxTokens: route.maxTokens }),
  }
}

function boundedText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars - 1)}…`
}

function exactIngressText(value: string, label: string, maxBytes: number): string {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > maxBytes
    || (label === 'eventId' && (value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)))) {
    throw new Error(`channel ${label} is invalid or exceeds ${maxBytes} bytes`)
  }
  return value
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown channel failure'
}

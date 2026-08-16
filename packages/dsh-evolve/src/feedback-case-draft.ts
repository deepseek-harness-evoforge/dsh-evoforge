import { createHash, randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, readFile, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { MessageFeedbackService } from '@deepseek-ai/dsh-message-feedback'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import type { EvolutionStore, SessionIdentity, SkillGenerationArtifact } from './generation-store.ts'
import type { GitSkillSource } from './git-skill-source.ts'
import type { FeedbackSignalStore } from './feedback-signal-monitor.ts'
import { hashTree } from './hash.ts'

const CONTENT_ID = /^[a-f0-9]{64}$/
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_USER_TEXT_BYTES = 8 * 1024
const MAX_CORRECTION_BYTES = 4 * 1024
const MAX_DRAFT_FILE_BYTES = 32 * 1024

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const gitObjectSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
const draftContentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  status: z.literal('draft'),
  source: z.strictObject({
    signalId: hashSchema,
    sessionId: z.string().min(1).max(256),
    messageId: z.string().min(1).max(512),
    feedbackVersion: z.uuid(),
    generationId: hashSchema,
    assistantSeq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    turn: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    prefixHash: hashSchema,
  }),
  target: z.strictObject({
    kind: z.literal('skill'),
    name: z.string().regex(SKILL_NAME),
    artifact: z.strictObject({
      kind: z.literal('skill'),
      name: z.string().regex(SKILL_NAME),
      gitCommit: gitObjectSchema,
      treeHash: gitObjectSchema,
    }),
    contentHash: hashSchema,
  }),
  sample: z.strictObject({
    userText: z.string(),
    correction: z.string(),
  }),
  limitations: z.array(z.string().min(1).max(512)).min(1).max(8),
})
const draftSchema = draftContentSchema.extend({ id: hashSchema })

export interface FeedbackCaseDraft {
  readonly schemaVersion: 1
  readonly id: string
  readonly status: 'draft'
  readonly source: {
    readonly signalId: string
    readonly sessionId: string
    readonly messageId: string
    readonly feedbackVersion: string
    readonly generationId: string
    readonly assistantSeq: number
    readonly turn: number
    readonly prefixHash: string
  }
  readonly target: {
    readonly kind: 'skill'
    readonly name: string
    readonly artifact: SkillGenerationArtifact
    readonly contentHash: string
  }
  readonly sample: {
    readonly userText: string
    readonly correction: string
  }
  readonly limitations: readonly string[]
}

export interface FeedbackCaseDraftResult {
  readonly created: boolean
  readonly draft: FeedbackCaseDraft
  readonly path: string
}

/**
 * Convert one exact, still-current feedback signal into a private Case Draft.
 * This is deliberately not a generic Case store or evaluator.
 */
export class FeedbackCaseDraftBuilder {
  private readonly root: string
  private readonly signals: Pick<FeedbackSignalStore, 'get'>
  private readonly evolution: Pick<EvolutionStore, 'getSessionGeneration'>
  private readonly source: Pick<GitSkillSource, 'resolveArtifact'>
  private readonly feedback: Pick<MessageFeedbackService, 'list'>
  private readonly persistence: Pick<SessionPersistence, 'readFrom'>

  constructor(
    root: string,
    signals: Pick<FeedbackSignalStore, 'get'>,
    evolution: Pick<EvolutionStore, 'getSessionGeneration'>,
    source: Pick<GitSkillSource, 'resolveArtifact'>,
    feedback: Pick<MessageFeedbackService, 'list'>,
    persistence: Pick<SessionPersistence, 'readFrom'>,
  ) {
    this.root = resolve(root)
    this.signals = signals
    this.evolution = evolution
    this.source = source
    this.feedback = feedback
    this.persistence = persistence
    if (dirname(this.root) === this.root) {
      throw new Error('feedbackDraftRoot must not be a filesystem root')
    }
  }

  async create(signalId: string, skillName: string): Promise<FeedbackCaseDraftResult> {
    if (!CONTENT_ID.test(signalId)) throw new Error('feedback signal id must be a full 64-character id')
    if (!SKILL_NAME.test(skillName)) throw new Error(`invalid Skill name '${skillName}'`)

    const signal = this.signals.get(signalId)
    if (signal === undefined) throw staleSignal()
    if (signal.generationId === undefined) {
      throw new Error('feedback signal is not backed by an exact EvoForge Generation')
    }

    const current = await this.currentFeedback(signal.sessionId, signal.messageId, signal.feedbackVersion)
    const stored = await this.persistence.readFrom(signal.sessionId as SessionId, 0)
    if (String(stored.meta.id) !== signal.sessionId) throw staleSignal()

    const identity: SessionIdentity = {
      sessionId: signal.sessionId,
      createdAt: stored.meta.createdAt,
      ...(stored.meta.cwd === undefined ? {} : { cwd: stored.meta.cwd }),
    }
    const generation = this.evolution.getSessionGeneration(identity)
    if (generation?.id !== signal.generationId) {
      throw new Error('feedback signal no longer resolves to its exact pinned Generation')
    }
    const artifacts = generation.artifacts.filter(artifact => artifact.name === skillName)
    if (artifacts.length !== 1) {
      throw new Error(`pinned Generation does not contain exactly one Skill '${skillName}'`)
    }
    const artifact = artifacts[0]!
    const resolvedArtifact = await this.source.resolveArtifact(skillName, artifact)

    const assistantEvents = stored.events.filter((event): event is SessionEvent<'assistant/message'> =>
      event.type === 'assistant/message' && String(event.data.message.id) === signal.messageId)
    if (assistantEvents.length !== 1) throw new Error('feedback target is ambiguous in durable Session history')
    const assistant = assistantEvents[0]!
    const turnStart = [...stored.events].reverse().find(event =>
      event.seq < assistant.seq
      && event.type === 'turn/start'
      && event.data.turn === assistant.data.turn)
    if (turnStart === undefined) throw new Error('feedback target has no durable turn boundary')
    const turnEvents = stored.events.filter(event => event.seq > turnStart.seq && event.seq <= assistant.seq)
    const direct = turnEvents.filter((event): event is SessionEvent<'user/message'> =>
      event.type === 'user/message' && sourceKind(event.data.source) === 'user')
    if (direct.length !== 1) {
      throw new Error('feedback target turn must contain exactly one direct user message')
    }
    const userText = singleTextBlock(direct[0]!.data.content)
    const invoked = turnEvents.filter((event): event is SessionEvent<'user/message'> =>
      event.type === 'user/message' && sourceKind(event.data.source) === 'skill-invocation')
    if (invoked.length !== 1 || sourceName(invoked[0]!.data.source) !== skillName) {
      throw new Error(`feedback target turn must contain exactly one explicit invocation of Skill '${skillName}'`)
    }
    enforceBound('direct user text', userText, MAX_USER_TEXT_BYTES)
    enforceBound('feedback correction', current.note, MAX_CORRECTION_BYTES)

    const content = {
      schemaVersion: 1 as const,
      status: 'draft' as const,
      source: {
        signalId: signal.id,
        sessionId: signal.sessionId,
        messageId: signal.messageId,
        feedbackVersion: signal.feedbackVersion,
        generationId: generation.id,
        assistantSeq: assistant.seq,
        turn: assistant.data.turn,
        prefixHash: hashJson(stored.events.filter(event => event.seq <= assistant.seq)),
      },
      target: {
        kind: 'skill' as const,
        name: skillName,
        artifact,
        contentHash: await hashTree(resolvedArtifact.resourceBase),
      },
      sample: {
        userText,
        correction: current.note,
      },
      limitations: [
        'Draft only: no replay result or evaluator score exists yet.',
        'Contains the direct user text and correction, never the assistant response, Tool output, or Skill body.',
      ],
    }
    const id = hashJson(content)
    const draft: FeedbackCaseDraft = immutableCopy({ ...content, id })
    const bytes = `${JSON.stringify(draft, null, 2)}\n`

    // Recheck native authority after the potentially slower Git integrity read.
    await this.currentFeedback(signal.sessionId, signal.messageId, signal.feedbackVersion)
    await ensurePrivateDirectory(this.root)
    const path = join(this.root, `${id}.json`)
    const created = await installContentAddressedFile(this.root, path, bytes)
    return { created, draft, path }
  }

  private async currentFeedback(sessionId: string, messageId: string, version: string) {
    const result = await this.feedback.list({ sessionId: sessionId as SessionId })
    if (!result.ok) throw staleSignal()
    const item = result.value.items.find(candidate => String(candidate.messageId) === messageId)
    if (item === undefined
      || String(item.version) !== version
      || item.rating !== 'negative'
      || item.note === undefined
      || item.note.trim() === '') {
      throw staleSignal()
    }
    return { note: item.note }
  }
}

/** Read and authenticate one explicitly selected private draft for offline Shadow use. */
export async function readPrivateFeedbackCaseDraft(path: string): Promise<FeedbackCaseDraft> {
  const requested = resolve(path)
  let handle
  try {
    handle = await open(requested, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ELOOP') {
      throw new Error('feedback draft must be a private regular file')
    }
    throw error
  }
  let value: unknown
  try {
    const info = await handle.stat()
    if (!info.isFile() || (info.mode & 0o077) !== 0) {
      throw new Error('feedback draft must be a private regular file')
    }
    if (info.size > MAX_DRAFT_FILE_BYTES) {
      throw new Error(`feedback draft exceeds ${MAX_DRAFT_FILE_BYTES} bytes`)
    }
    try {
      value = JSON.parse(await handle.readFile('utf8'))
    } catch (error) {
      throw new Error('feedback draft is not valid JSON', { cause: error })
    }
  } finally {
    await handle.close()
  }
  const draft = draftSchema.parse(value)
  const { id, ...content } = draft
  if (hashJson(content) !== id) throw new Error('feedback draft id does not match its content')
  if (draft.target.artifact.name !== draft.target.name) {
    throw new Error('feedback draft target does not match its Git artifact')
  }
  enforceBound('direct user text', draft.sample.userText, MAX_USER_TEXT_BYTES)
  enforceBound('feedback correction', draft.sample.correction, MAX_CORRECTION_BYTES)
  return immutableCopy(draft)
}

function staleSignal(): Error {
  return new Error('feedback signal is no longer current')
}

function sourceKind(source: unknown): string | undefined {
  if (source === null || typeof source !== 'object') return undefined
  const kind = (source as { kind?: unknown }).kind
  return typeof kind === 'string' ? kind : undefined
}

function sourceName(source: unknown): string | undefined {
  if (source === null || typeof source !== 'object') return undefined
  const name = (source as { name?: unknown }).name
  return typeof name === 'string' ? name : undefined
}

function singleTextBlock(blocks: readonly unknown[]): string {
  if (blocks.length !== 1) throw new Error('direct user message must contain exactly one text block')
  const block = blocks[0]
  if (block === null || typeof block !== 'object'
    || (block as { type?: unknown }).type !== 'text'
    || typeof (block as { text?: unknown }).text !== 'string') {
    throw new Error('direct user message must contain exactly one text block')
  }
  return (block as { text: string }).text
}

function enforceBound(label: string, value: string, maxBytes: number): void {
  const bytes = Buffer.byteLength(value)
  if (bytes > maxBytes) throw new Error(`${label} exceeds ${maxBytes} UTF-8 bytes`)
}

async function ensurePrivateDirectory(root: string): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 })
  const info = await lstat(root)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('feedbackDraftRoot must resolve to a real directory')
  }
  if ((info.mode & 0o077) !== 0) {
    throw new Error('feedbackDraftRoot must not grant group or world permissions')
  }
}

async function installContentAddressedFile(root: string, path: string, bytes: string): Promise<boolean> {
  const temporary = join(root, `.draft-${process.pid}-${cryptoRandomSuffix()}`)
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
  try {
    await handle.writeFile(bytes, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    try {
      await link(temporary, path)
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
      await verifyExistingFile(path, bytes)
      return false
    }
    await verifyExistingFile(path, bytes)
    return true
  } finally {
    await unlink(temporary).catch(error => {
      if (!isMissing(error)) throw error
    })
  }
}

async function verifyExistingFile(path: string, expected: string): Promise<void> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
    throw new Error('existing Feedback Case Draft is not a private regular file')
  }
  if (await readFile(path, 'utf8') !== expected) {
    throw new Error('existing Feedback Case Draft does not match its content-derived id')
  }
}

function cryptoRandomSuffix(): string {
  return randomBytes(8).toString('hex')
}

function isAlreadyExists(error: unknown): boolean {
  return isNodeError(error) && error.code === 'EEXIST'
}

function isMissing(error: unknown): boolean {
  return isNodeError(error) && error.code === 'ENOENT'
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) throw new Error('value is not canonical JSON')
    return encoded
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`
}

function immutableCopy<T>(value: T): T {
  return deepFreeze(structuredClone(value))
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

import { createHash } from 'node:crypto'
import {
  defineDomain,
  domainTable,
  type Domain,
  type DomainFacility,
} from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

export interface SkillGenerationArtifact {
  kind: 'skill'
  name: string
  gitCommit: string
  treeHash: string
}

export interface GenerationInput {
  parentId?: string | undefined
  createdAt: number
  artifacts: SkillGenerationArtifact[]
  evaluatorVersion: string
  policyVersion: string
  compositionFingerprint: string
}

export interface CapabilityGeneration extends GenerationInput {
  id: string
  schemaVersion: 1
}

export interface SessionIdentity {
  sessionId: string
  createdAt: number
  cwd?: string | undefined
}

export interface EvolutionStore {
  publishGeneration(input: GenerationInput): Promise<{
    created: boolean
    generation: CapabilityGeneration
  }>
  getGeneration(id: string): CapabilityGeneration | undefined
  getActiveGeneration(): CapabilityGeneration | undefined
  promoteGeneration(id: string): Promise<{
    previousId: string | undefined
    generation: CapabilityGeneration
  }>
  rollbackGeneration(): Promise<{
    previousId: string
    generation: CapabilityGeneration | undefined
  }>
  pinSession(
    identity: SessionIdentity,
    options?: { parentSessionId?: string },
  ): Promise<CapabilityGeneration | undefined>
  fallbackSessionToNative(identity: SessionIdentity): Promise<void>
  getSessionGeneration(identity: SessionIdentity): CapabilityGeneration | undefined
  isRecoveryPaused(): boolean
  setRecoveryPaused(paused: boolean): Promise<{ changed: boolean; paused: boolean }>
  close(): Promise<void>
}

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const gitObjectSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
const gitCommitSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
const artifactSchema = z.strictObject({
  kind: z.literal('skill'),
  name: z.string().min(1),
  gitCommit: gitCommitSchema,
  treeHash: gitObjectSchema,
})
const generationContentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  parentId: hashSchema.optional(),
  createdAt: z.number().int().nonnegative(),
  artifacts: z.array(artifactSchema).min(1),
  evaluatorVersion: z.string().min(1),
  policyVersion: z.string().min(1),
  compositionFingerprint: hashSchema,
})
const generationSchema = generationContentSchema.extend({ id: hashSchema })
const generationPointerSchema = z.strictObject({
  activeGenerationId: hashSchema.optional(),
  recoveryPaused: z.boolean().optional(),
})
type GenerationPointer = z.infer<typeof generationPointerSchema>
const sessionIdentitySchema = z.strictObject({
  sessionId: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  cwd: z.string().min(1).optional(),
})
const sessionPinSchema = z.strictObject({
  identity: sessionIdentitySchema,
  generationId: hashSchema.optional(),
})
const evolutionDomainSpec = defineDomain({
  name: 'evoforge_evolution',
  version: 1,
  global: {
    schema: generationPointerSchema,
    initial: {} as GenerationPointer,
  },
  tables: {
    generations: domainTable<string, CapabilityGeneration>(generationSchema),
    session_pins: domainTable<string, {
      identity: SessionIdentity
      generationId?: string | undefined
    }>(sessionPinSchema),
  },
})

type EvolutionDomain = Domain<typeof evolutionDomainSpec>

class DomainEvolutionStore implements EvolutionStore {
  private writeTail: Promise<void> = Promise.resolve()
  private closing?: Promise<void>
  private readonly domain: EvolutionDomain

  constructor(domain: EvolutionDomain) {
    this.domain = domain
  }

  publishGeneration(input: GenerationInput): Promise<{
    created: boolean
    generation: CapabilityGeneration
  }> {
    const result = this.writeTail.then(() => this.publishNow(input))
    this.writeTail = result.then(() => {}, () => {})
    return result
  }

  getGeneration(id: string): CapabilityGeneration | undefined {
    const stored = this.domain.table('generations').get(id)
    return stored === undefined ? undefined : immutableCopy(stored)
  }

  getActiveGeneration(): CapabilityGeneration | undefined {
    const id = this.domain.global.get().activeGenerationId
    if (id === undefined) return undefined
    const generation = this.getGeneration(id)
    if (generation === undefined) {
      throw new Error(`active Generation '${id}' is missing`)
    }
    return generation
  }

  isRecoveryPaused(): boolean {
    return this.domain.global.get().recoveryPaused === true
  }

  setRecoveryPaused(paused: boolean): Promise<{ changed: boolean; paused: boolean }> {
    const result = this.writeTail.then(() => this.setRecoveryPausedNow(paused))
    this.writeTail = result.then(() => {}, () => {})
    return result
  }

  promoteGeneration(id: string): Promise<{
    previousId: string | undefined
    generation: CapabilityGeneration
  }> {
    const result = this.writeTail.then(() => this.promoteNow(id))
    this.writeTail = result.then(() => {}, () => {})
    return result
  }

  rollbackGeneration(): Promise<{
    previousId: string
    generation: CapabilityGeneration | undefined
  }> {
    const result = this.writeTail.then(() => this.rollbackNow())
    this.writeTail = result.then(() => {}, () => {})
    return result
  }

  pinSession(
    identity: SessionIdentity,
    options?: { parentSessionId?: string },
  ): Promise<CapabilityGeneration | undefined> {
    const result = this.writeTail.then(() => this.pinNow(identity, options))
    this.writeTail = result.then(() => {}, () => {})
    return result
  }

  fallbackSessionToNative(identity: SessionIdentity): Promise<void> {
    const result = this.writeTail.then(() => this.fallbackToNativeNow(identity))
    this.writeTail = result.then(() => {}, () => {})
    return result
  }

  getSessionGeneration(identity: SessionIdentity): CapabilityGeneration | undefined {
    const normalized = sessionIdentitySchema.parse(identity)
    const pin = this.domain.table('session_pins').get(normalized.sessionId)
    if (pin === undefined) return undefined
    if (canonicalJson(pin.identity) !== canonicalJson(normalized)) {
      return undefined
    }
    if (pin.generationId === undefined) return undefined
    const generation = this.getGeneration(pin.generationId)
    if (generation === undefined) {
      throw new Error(
        `Session pin '${normalized.sessionId}' references missing Generation '${pin.generationId}'`,
      )
    }
    return generation
  }

  close(): Promise<void> {
    this.closing ??= this.writeTail.then(() => this.domain.close())
    return this.closing
  }

  private async publishNow(input: GenerationInput): Promise<{
    created: boolean
    generation: CapabilityGeneration
  }> {
    const content = generationContentSchema.parse({ schemaVersion: 1, ...input })
    const id = createHash('sha256').update(canonicalJson(content)).digest('hex')
    const generation = immutableCopy(generationSchema.parse({ ...content, id }))
    const table = this.domain.table('generations')
    const existing = table.get(id)
    if (existing !== undefined) {
      if (canonicalJson(existing) !== canonicalJson(generation)) {
        throw new Error(`Generation '${id}' does not match its content-derived id`)
      }
      return { created: false, generation: immutableCopy(existing) }
    }
    await table.put(id, generation)
    return { created: true, generation }
  }

  private async promoteNow(id: string): Promise<{
    previousId: string | undefined
    generation: CapabilityGeneration
  }> {
    const generation = this.getGeneration(id)
    if (generation === undefined) throw new Error(`Generation '${id}' does not exist`)
    const previousId = this.domain.global.get().activeGenerationId
    if (previousId !== id && generation.parentId !== previousId) {
      throw new Error(
        previousId === undefined
          ? `root Generation '${id}' must not declare a parent`
          : `Generation '${id}' is not a child of active Generation '${previousId}'`,
      )
    }
    if (previousId !== id) await this.domain.global.set(this.pointerWithActive(id))
    return { previousId, generation }
  }

  private async rollbackNow(): Promise<{
    previousId: string
    generation: CapabilityGeneration | undefined
  }> {
    const previousId = this.domain.global.get().activeGenerationId
    if (previousId === undefined) throw new Error('no active Generation to roll back')
    const active = this.getGeneration(previousId)
    if (active === undefined) throw new Error(`active Generation '${previousId}' is missing`)
    if (active.parentId === undefined) {
      await this.domain.global.set(this.pointerWithActive())
      return { previousId, generation: undefined }
    }
    const generation = this.getGeneration(active.parentId)
    if (generation === undefined) {
      throw new Error(`parent Generation '${active.parentId}' is missing`)
    }
    await this.domain.global.set(this.pointerWithActive(generation.id))
    return { previousId, generation }
  }

  private async setRecoveryPausedNow(
    paused: boolean,
  ): Promise<{ changed: boolean; paused: boolean }> {
    const current = this.domain.global.get()
    const changed = (current.recoveryPaused === true) !== paused
    if (changed) {
      await this.domain.global.set({
        ...current.activeGenerationId === undefined
          ? {}
          : { activeGenerationId: current.activeGenerationId },
        recoveryPaused: paused,
      })
    }
    return { changed, paused }
  }

  private pointerWithActive(activeGenerationId?: string): GenerationPointer {
    const recoveryPaused = this.domain.global.get().recoveryPaused
    return {
      ...activeGenerationId === undefined ? {} : { activeGenerationId },
      ...recoveryPaused === undefined ? {} : { recoveryPaused },
    }
  }

  private async pinNow(
    identity: SessionIdentity,
    options?: { parentSessionId?: string },
  ): Promise<CapabilityGeneration | undefined> {
    const normalized = sessionIdentitySchema.parse(identity)
    const pinTable = this.domain.table('session_pins')
    const existingPin = pinTable.get(normalized.sessionId)
    if (existingPin !== undefined
      && canonicalJson(existingPin.identity) === canonicalJson(normalized)) {
      if (existingPin.generationId === undefined) return undefined
      const existing = this.getGeneration(existingPin.generationId)
      if (existing === undefined) {
        throw new Error(
          `Session pin '${normalized.sessionId}' references missing Generation '${existingPin.generationId}'`,
        )
      }
      return existing
    }

    let generation: CapabilityGeneration | undefined
    if (options?.parentSessionId === undefined) {
      generation = this.getActiveGeneration()
    } else {
      const parentPin = this.domain.table('session_pins').get(options.parentSessionId)
      if (parentPin === undefined) {
        throw new Error(`parent Session '${options.parentSessionId}' has no Generation pin`)
      }
      generation = parentPin.generationId === undefined
        ? undefined
        : this.getGeneration(parentPin.generationId)
      if (parentPin.generationId !== undefined && generation === undefined) {
        throw new Error(
          `parent Session '${options.parentSessionId}' references missing Generation '${parentPin.generationId}'`,
        )
      }
    }

    await pinTable.put(normalized.sessionId, immutableCopy({
      identity: normalized,
      ...generation === undefined ? {} : { generationId: generation.id },
    }))
    return generation
  }

  private async fallbackToNativeNow(identity: SessionIdentity): Promise<void> {
    const normalized = sessionIdentitySchema.parse(identity)
    const table = this.domain.table('session_pins')
    const existing = table.get(normalized.sessionId)
    if (existing === undefined
      || canonicalJson(existing.identity) !== canonicalJson(normalized)) {
      throw new Error(
        `Session '${normalized.sessionId}' cannot fall back before its lifecycle pin is durable`,
      )
    }
    if (existing.generationId === undefined) return
    await table.put(normalized.sessionId, immutableCopy({ identity: normalized }))
  }
}

export async function openEvolutionStore(facility: DomainFacility): Promise<EvolutionStore> {
  return new DomainEvolutionStore(await facility.open(evolutionDomainSpec))
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value !== 'object') throw new Error(`unsupported Generation value: ${typeof value}`)
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

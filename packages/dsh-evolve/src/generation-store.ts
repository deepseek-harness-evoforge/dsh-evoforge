import { createHash } from 'node:crypto'
import {
  defineDomain,
  domainTable,
  type Domain,
  type DomainFacility,
} from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import {
  parseSkillCandidateLineage,
  type SkillCandidateLineage,
} from './skill-candidate-lineage.ts'
import { assembleSkillBundleArchive, decodeSkillBundleArchive } from './skill-bundle-archive.ts'

export interface GitSkillGenerationArtifact {
  kind: 'skill'
  name: string
  gitCommit: string
  treeHash: string
  lineage?: SkillCandidateLineage | undefined
}

export interface SkillBundleGenerationArtifact {
  kind: 'skill-bundle'
  name: string
  artifactDigest: string
  treeHash: string
  contentBase64: string
  lineage: SkillCandidateLineage
}

export type SkillGenerationArtifact = GitSkillGenerationArtifact | SkillBundleGenerationArtifact

export interface GenerationInput {
  workspaceId: string
  parentId?: string | undefined
  createdAt: number
  artifacts: SkillGenerationArtifact[]
  evaluatorVersion: string
  policyVersion: string
  compositionFingerprint: string
}

export interface CapabilityGeneration extends GenerationInput {
  id: string
  schemaVersion: 2
}

export interface SessionIdentity {
  workspaceId: string
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
  getActiveGeneration(workspaceId: string): CapabilityGeneration | undefined
  promoteGeneration(workspaceId: string, id: string): Promise<{
    previousId: string | undefined
    generation: CapabilityGeneration
  }>
  rollbackGeneration(workspaceId: string, expectedActiveId: string): Promise<{
    previousId: string
    generation: CapabilityGeneration | undefined
  }>
  pinSession(
    identity: SessionIdentity,
    options?: { parentSessionId?: string },
  ): Promise<CapabilityGeneration | undefined>
  fallbackSessionToNative(identity: SessionIdentity): Promise<void>
  getSessionGeneration(identity: SessionIdentity): CapabilityGeneration | undefined
  isRecoveryPaused(workspaceId: string): boolean
  setRecoveryPaused(workspaceId: string, paused: boolean): Promise<{ changed: boolean; paused: boolean }>
  close(): Promise<void>
}

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const workspaceIdSchema = z.uuid()
const gitObjectSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
const gitCommitSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
const lineageSchema = z.custom<SkillCandidateLineage>((value) => {
  try {
    parseSkillCandidateLineage(value)
    return true
  } catch {
    return false
  }
}, 'invalid Skill Candidate lineage').transform(value => parseSkillCandidateLineage(value))
const gitArtifactSchema = z.strictObject({
  kind: z.literal('skill'),
  name: z.string().min(1),
  gitCommit: gitCommitSchema,
  treeHash: gitObjectSchema,
  lineage: lineageSchema.optional(),
})
const skillBundleArtifactSchema = z.strictObject({
  kind: z.literal('skill-bundle'),
  name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  artifactDigest: hashSchema,
  treeHash: hashSchema,
  contentBase64: z.string().base64().min(1).max(2 * 1024 * 1024),
  lineage: lineageSchema,
}).superRefine((artifact, context) => {
  if (artifact.name !== artifact.lineage.skillName
    || artifact.artifactDigest !== artifact.lineage.contentHash
    || artifact.treeHash !== artifact.lineage.candidateTreeHash) {
    context.addIssue({ code: 'custom', message: 'Skill bundle artifact does not match its Candidate lineage' })
  }
})
const artifactSchema = z.discriminatedUnion('kind', [gitArtifactSchema, skillBundleArtifactSchema])
const generationContentSchema = z.strictObject({
  schemaVersion: z.literal(2),
  workspaceId: workspaceIdSchema,
  parentId: hashSchema.optional(),
  createdAt: z.number().int().nonnegative(),
  artifacts: z.array(artifactSchema).min(1),
  evaluatorVersion: z.string().min(1),
  policyVersion: z.string().min(1),
  compositionFingerprint: hashSchema,
})
const generationSchema = generationContentSchema.extend({ id: hashSchema })
const evolutionGlobalSchema = z.strictObject({
  schemaVersion: z.literal(2),
})
const workspaceStateSchema = z.strictObject({
  workspaceId: workspaceIdSchema,
  activeGenerationId: hashSchema.optional(),
  recoveryPaused: z.boolean().optional(),
})
type WorkspaceEvolutionState = z.infer<typeof workspaceStateSchema>
const sessionIdentitySchema = z.strictObject({
  workspaceId: workspaceIdSchema,
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
  version: 2,
  global: {
    schema: evolutionGlobalSchema,
    initial: { schemaVersion: 2 },
  },
  tables: {
    generations: domainTable<string, CapabilityGeneration>(generationSchema),
    workspace_states: domainTable<string, WorkspaceEvolutionState>(workspaceStateSchema),
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

  getActiveGeneration(workspaceId: string): CapabilityGeneration | undefined {
    const exactWorkspaceId = workspaceIdSchema.parse(workspaceId)
    const id = this.domain.table('workspace_states').get(exactWorkspaceId)?.activeGenerationId
    if (id === undefined) return undefined
    const generation = this.getGeneration(id)
    if (generation === undefined) {
      throw new Error(`Workspace '${exactWorkspaceId}' active Generation '${id}' is missing`)
    }
    if (generation.workspaceId !== exactWorkspaceId) {
      throw new Error(`active Generation '${id}' belongs to Workspace '${generation.workspaceId}'`)
    }
    return generation
  }

  isRecoveryPaused(workspaceId: string): boolean {
    const exactWorkspaceId = workspaceIdSchema.parse(workspaceId)
    return this.domain.table('workspace_states').get(exactWorkspaceId)?.recoveryPaused === true
  }

  setRecoveryPaused(workspaceId: string, paused: boolean): Promise<{ changed: boolean; paused: boolean }> {
    const exactWorkspaceId = workspaceIdSchema.parse(workspaceId)
    const result = this.writeTail.then(() => this.setRecoveryPausedNow(exactWorkspaceId, paused))
    this.writeTail = result.then(() => {}, () => {})
    return result
  }

  promoteGeneration(workspaceId: string, id: string): Promise<{
    previousId: string | undefined
    generation: CapabilityGeneration
  }> {
    const exactWorkspaceId = workspaceIdSchema.parse(workspaceId)
    const result = this.writeTail.then(() => this.promoteNow(exactWorkspaceId, id))
    this.writeTail = result.then(() => {}, () => {})
    return result
  }

  rollbackGeneration(workspaceId: string, expectedActiveId: string): Promise<{
    previousId: string
    generation: CapabilityGeneration | undefined
  }> {
    const exactWorkspaceId = workspaceIdSchema.parse(workspaceId)
    const exactExpectedActiveId = hashSchema.parse(expectedActiveId)
    const result = this.writeTail.then(() => this.rollbackNow(exactWorkspaceId, exactExpectedActiveId))
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
    if (generation.workspaceId !== normalized.workspaceId) {
      throw new Error(
        `Session pin '${normalized.sessionId}' references Generation '${pin.generationId}' from Workspace '${generation.workspaceId}'`,
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
    const content = generationContentSchema.parse({ schemaVersion: 2, ...input })
    for (const artifact of content.artifacts) {
      if (artifact.kind === 'skill-bundle') {
        await verifySkillBundleArtifact(artifact, content.workspaceId)
      }
    }
    if (content.parentId !== undefined) {
      const parent = this.getGeneration(content.parentId)
      if (parent === undefined) throw new Error(`parent Generation '${content.parentId}' is missing`)
      if (parent.workspaceId !== content.workspaceId) {
        throw new Error(
          `parent Generation '${content.parentId}' belongs to Workspace '${parent.workspaceId}', not '${content.workspaceId}'`,
        )
      }
    }
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

  private async promoteNow(workspaceId: string, id: string): Promise<{
    previousId: string | undefined
    generation: CapabilityGeneration
  }> {
    const generation = this.getGeneration(id)
    if (generation === undefined) throw new Error(`Generation '${id}' does not exist`)
    if (generation.workspaceId !== workspaceId) {
      throw new Error(`Generation '${id}' belongs to Workspace '${generation.workspaceId}', not '${workspaceId}'`)
    }
    const previousId = this.workspaceState(workspaceId).activeGenerationId
    if (previousId !== id && generation.parentId !== previousId) {
      throw new Error(
        previousId === undefined
          ? `root Generation '${id}' must not declare a parent`
          : `Generation '${id}' is not a child of active Generation '${previousId}'`,
      )
    }
    if (previousId !== id) await this.putWorkspaceState(workspaceId, id)
    return { previousId, generation }
  }

  private async rollbackNow(workspaceId: string, expectedActiveId: string): Promise<{
    previousId: string
    generation: CapabilityGeneration | undefined
  }> {
    const previousId = this.workspaceState(workspaceId).activeGenerationId
    if (previousId === undefined) throw new Error(`Workspace '${workspaceId}' has no active Generation to roll back`)
    if (previousId !== expectedActiveId) {
      throw new Error(`active Generation changed from expected '${expectedActiveId}' to '${previousId}'`)
    }
    const active = this.getGeneration(previousId)
    if (active === undefined) throw new Error(`active Generation '${previousId}' is missing`)
    if (active.workspaceId !== workspaceId) {
      throw new Error(`active Generation '${previousId}' belongs to Workspace '${active.workspaceId}'`)
    }
    if (active.parentId === undefined) {
      await this.putWorkspaceState(workspaceId)
      return { previousId, generation: undefined }
    }
    const generation = this.getGeneration(active.parentId)
    if (generation === undefined) {
      throw new Error(`parent Generation '${active.parentId}' is missing`)
    }
    if (generation.workspaceId !== workspaceId) {
      throw new Error(`parent Generation '${generation.id}' belongs to Workspace '${generation.workspaceId}'`)
    }
    await this.putWorkspaceState(workspaceId, generation.id)
    return { previousId, generation }
  }

  private async setRecoveryPausedNow(
    workspaceId: string,
    paused: boolean,
  ): Promise<{ changed: boolean; paused: boolean }> {
    const current = this.workspaceState(workspaceId)
    const changed = (current.recoveryPaused === true) !== paused
    if (changed) {
      await this.domain.table('workspace_states').put(workspaceId, {
        workspaceId,
        ...(current.activeGenerationId === undefined ? {} : { activeGenerationId: current.activeGenerationId }),
        recoveryPaused: paused,
      })
    }
    return { changed, paused }
  }

  private workspaceState(workspaceId: string): WorkspaceEvolutionState {
    return this.domain.table('workspace_states').get(workspaceId) ?? { workspaceId }
  }

  private async putWorkspaceState(workspaceId: string, activeGenerationId?: string): Promise<void> {
    const recoveryPaused = this.workspaceState(workspaceId).recoveryPaused
    await this.domain.table('workspace_states').put(workspaceId, {
      workspaceId,
      ...(activeGenerationId === undefined ? {} : { activeGenerationId }),
      ...(recoveryPaused === undefined ? {} : { recoveryPaused }),
    })
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
      if (existing.workspaceId !== normalized.workspaceId) {
        throw new Error(
          `Session pin '${normalized.sessionId}' references Generation '${existing.id}' from Workspace '${existing.workspaceId}'`,
        )
      }
      return existing
    }

    let generation: CapabilityGeneration | undefined
    if (options?.parentSessionId === undefined) {
      generation = this.getActiveGeneration(normalized.workspaceId)
    } else {
      const parentPin = this.domain.table('session_pins').get(options.parentSessionId)
      if (parentPin === undefined) {
        throw new Error(`parent Session '${options.parentSessionId}' has no Generation pin`)
      }
      if (parentPin.identity.workspaceId !== normalized.workspaceId) {
        throw new Error(
          `parent Session '${options.parentSessionId}' belongs to a different Workspace '${parentPin.identity.workspaceId}'`,
        )
      }
      generation = parentPin.generationId === undefined
        ? undefined
        : this.getGeneration(parentPin.generationId)
      if (parentPin.generationId !== undefined && generation === undefined) {
        throw new Error(
          `parent Session '${options.parentSessionId}' references missing Generation '${parentPin.generationId}'`,
        )
      }
      if (generation !== undefined && generation.workspaceId !== normalized.workspaceId) {
        throw new Error(`parent Session Generation '${generation.id}' belongs to a different Workspace`)
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

async function verifySkillBundleArtifact(
  artifact: SkillBundleGenerationArtifact,
  workspaceId: string,
): Promise<void> {
  const content = Buffer.from(artifact.contentBase64, 'base64')
  if (content.toString('base64') !== artifact.contentBase64
    || artifact.lineage.workspaceId !== workspaceId) {
    throw new Error(`Skill bundle artifact '${artifact.name}' has invalid ownership or encoding`)
  }
  const decoded = await decodeSkillBundleArchive(content)
  const assembled = await assembleSkillBundleArchive(decoded.files.map(file => ({
    path: file.path,
    content: decodeCanonicalUtf8(file.content),
  })))
  if (!assembled.content.equals(content)
    || assembled.artifactDigest !== artifact.artifactDigest
    || assembled.treeHash !== artifact.treeHash) {
    throw new Error(`Skill bundle artifact '${artifact.name}' failed content identity verification`)
  }
}

function decodeCanonicalUtf8(content: Buffer): string {
  const value = content.toString('utf8')
  if (!Buffer.from(value).equals(content)) {
    throw new Error('Skill bundle artifact contains non-canonical UTF-8 text')
  }
  return value
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

import { randomUUID } from 'node:crypto'
import { link, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import {
  parseSkillCandidateLineage,
  type SkillCandidateLineage,
} from './skill-candidate-lineage.ts'

export interface ShadowRunIdentity {
  workspaceId: string
  baseTreeHash: string
  casePackHash: string
  dshRevision: string
  evaluatorVersion: string
  modelConfigHash: string
  modelRoute: string
  skillName: string
  baselineKind?: 'capability-absent'
  feedbackDraftId?: string
  skillCandidateLineage?: SkillCandidateLineage
}

export interface PersistedProposal {
  claim: string
  files: Array<{ path: string; content: string }>
}

export interface PersistedModelUsage {
  inputTokens: number
  outputTokens: number
}

export interface ShadowRunState {
  schemaVersion: 1
  runId: string
  phase: 'prepared' | 'proposal-pending' | 'candidate-ready' | 'trial-running' | 'complete' | 'incomplete'
  startedAt: string
  updatedAt: string
  identity: ShadowRunIdentity
  /** Reference-only source id used to distinguish crash reentry from a newer automatic signal. */
  feedbackSignalId?: string
  /** Host-only provenance used by conservative review-retention policy. */
  feedbackLaunchMode?: 'human' | 'automatic'
  /** Exact, non-secret inputs required for a resident DSH process to resume a sealed Trial. */
  resumeInputs?: {
    skillDir: string
    casePackDir: string
    baselineKind?: 'capability-absent'
    baselineSkillName?: string
    candidateSkillDir?: string
    feedbackDraftPath?: string
  }
  proposalEffect?: {
    id: string
    requestedAt: string
  }
  proposal?: PersistedProposal
  proposalHash?: string
  modelUsage?: PersistedModelUsage
  outcome?:
    | { kind: 'complete'; reportPath: string; summary: string }
    | { kind: 'incomplete'; reportPath: string; reason: string }
}

const STATE_FILENAME = 'run-state.json'
const LOCK_FILENAME = '.run.lock'

export async function acquireShadowRunLock(outputDir: string): Promise<() => Promise<void>> {
  const path = join(outputDir, LOCK_FILENAME)
  const marker = {
    schemaVersion: 1,
    nonce: randomUUID(),
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const owner = join(outputDir, `.run-lock-owner-${randomUUID()}.tmp`)
    try {
      const handle = await open(owner, 'wx', 0o600)
      try {
        await handle.writeFile(`${JSON.stringify(marker)}\n`, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await link(owner, path)
      await rm(owner, { force: true }).catch(() => undefined)
      await syncDirectory(outputDir)
      return async () => {
        const current = await readLock(path)
        if (current?.nonce !== marker.nonce) {
          throw new Error('Shadow run lock ownership changed before release')
        }
        await rm(path)
        await syncDirectory(outputDir)
      }
    } catch (error) {
      await rm(owner, { force: true }).catch(() => undefined)
      if (!isRecord(error) || error.code !== 'EEXIST') throw error
      const existing = await readLock(path)
      if (existing === undefined) continue
      if (processIsAlive(existing.pid)) {
        throw new Error(`Shadow run is already owned by live process ${existing.pid}`)
      }
      const stale = join(outputDir, `.run-lock-stale-${randomUUID()}`)
      try {
        await rename(path, stale)
        await rm(stale)
      } catch (renameError) {
        if (!isRecord(renameError) || renameError.code !== 'ENOENT') throw renameError
      }
    }
  }
  throw new Error('Shadow run lock changed concurrently; retry resume')
}

export async function loadShadowRunState(outputDir: string): Promise<ShadowRunState> {
  let value: unknown
  try {
    value = JSON.parse(await readFile(join(outputDir, STATE_FILENAME), 'utf8'))
  } catch (error) {
    throw new Error('Shadow resume requires a readable run-state.json', { cause: error })
  }
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || typeof value.runId !== 'string'
    || typeof value.phase !== 'string'
    || typeof value.startedAt !== 'string'
    || typeof value.updatedAt !== 'string'
    || !isRecord(value.identity)) {
    throw new Error('Shadow run state has an invalid shape')
  }
  if (typeof value.identity.workspaceId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.identity.workspaceId)) {
    throw new Error('Shadow run state has an invalid Workspace id')
  }
  if (!['prepared', 'proposal-pending', 'candidate-ready', 'trial-running', 'complete', 'incomplete']
    .includes(value.phase)) {
    throw new Error(`Shadow run state has unsupported phase '${value.phase}'`)
  }
  if (value.feedbackSignalId !== undefined
    && (typeof value.feedbackSignalId !== 'string'
      || !/^[a-f0-9]{64}$/.test(value.feedbackSignalId))) {
    throw new Error('Shadow run state has an invalid feedback Signal id')
  }
  if (value.feedbackLaunchMode !== undefined
    && !['human', 'automatic'].includes(String(value.feedbackLaunchMode))) {
    throw new Error('Shadow run state has an invalid feedback launch mode')
  }
  if (value.identity.skillCandidateLineage !== undefined) {
    const lineage = parseSkillCandidateLineage(value.identity.skillCandidateLineage)
    if (lineage.workspaceId !== value.identity.workspaceId
      || lineage.skillName !== value.identity.skillName) {
      throw new Error('Shadow run state Skill Candidate lineage does not match its identity')
    }
  }
  if (value.identity.baselineKind !== undefined
    && value.identity.baselineKind !== 'capability-absent') {
    throw new Error('Shadow run state has an invalid baseline kind')
  }
  if (value.resumeInputs !== undefined
    && (!isRecord(value.resumeInputs)
      || typeof value.resumeInputs.skillDir !== 'string'
      || !isAbsolute(value.resumeInputs.skillDir)
      || typeof value.resumeInputs.casePackDir !== 'string'
      || !isAbsolute(value.resumeInputs.casePackDir)
      || (value.resumeInputs.baselineKind !== undefined
        && value.resumeInputs.baselineKind !== 'capability-absent')
      || (value.resumeInputs.baselineSkillName !== undefined
        && (typeof value.resumeInputs.baselineSkillName !== 'string'
          || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.resumeInputs.baselineSkillName)))
      || ((value.resumeInputs.baselineKind === 'capability-absent')
        !== (value.resumeInputs.baselineSkillName !== undefined))
      || (value.resumeInputs.candidateSkillDir !== undefined
        && (typeof value.resumeInputs.candidateSkillDir !== 'string'
          || !isAbsolute(value.resumeInputs.candidateSkillDir)))
      || (value.resumeInputs.feedbackDraftPath !== undefined
        && (typeof value.resumeInputs.feedbackDraftPath !== 'string'
          || !isAbsolute(value.resumeInputs.feedbackDraftPath))))) {
    throw new Error('Shadow run state has invalid resume inputs')
  }
  return value as unknown as ShadowRunState
}

export async function saveShadowRunState(
  outputDir: string,
  state: ShadowRunState,
): Promise<void> {
  await writeDurableJson(join(outputDir, STATE_FILENAME), state)
}

export async function writeDurableJson(target: string, value: unknown): Promise<void> {
  const outputDir = dirname(target)
  const temporary = join(outputDir, `.run-state-${process.pid}-${randomUUID()}.tmp`)
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporary, target)
    await syncDirectory(outputDir)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

export function assertShadowRunIdentity(
  actual: ShadowRunIdentity,
  expected: ShadowRunIdentity,
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('Shadow resume inputs do not match the durable run identity')
  }
}

async function syncDirectory(path: string): Promise<void> {
  let handle
  try {
    handle = await open(path, 'r')
    await handle.sync()
  } catch (error) {
    if (!isRecord(error) || !['EINVAL', 'EISDIR', 'EBADF'].includes(String(error.code))) throw error
  } finally {
    await handle?.close()
  }
}

async function readLock(path: string): Promise<{ nonce: string; pid: number } | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (!isRecord(value)
      || value.schemaVersion !== 1
      || typeof value.nonce !== 'string'
      || !Number.isSafeInteger(value.pid)
      || (value.pid as number) <= 0) {
      throw new Error('Shadow run lock has an invalid owner marker')
    }
    return { nonce: value.nonce, pid: value.pid as number }
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return undefined
    throw error
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (isRecord(error) && error.code === 'ESRCH') return false
    if (isRecord(error) && error.code === 'EPERM') return true
    throw error
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

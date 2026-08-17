import { lstat, mkdir, readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { writeDurableJson } from './shadow-run-state.ts'

const CONTENT_ID = /^[a-f0-9]{64}$/
const MAX_TARGETS = 20
const MAX_DAILY_ATTEMPTS = 20
const JOURNAL_DIR = '.automatic-evolution-budget-v1'
const JOURNAL_FILE = 'current.json'
const DAY_MS = 24 * 60 * 60 * 1_000

export interface AutomaticEvolutionBudgetTarget {
  readonly id: string
  readonly workspaceId: string
  readonly skill: string
  readonly runRoot: string
  readonly maxAttemptsPerUtcDay: number
}

export interface AutomaticEvolutionBudgetSnapshot {
  readonly targetId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly utcDay: string
  readonly used: number
  readonly limit: number
  readonly remaining: number
}

export interface AutomaticEvolutionBudgetReservation {
  readonly allowed: boolean
  readonly newlyReserved: boolean
  readonly retryAt?: number
  readonly snapshot: AutomaticEvolutionBudgetSnapshot
}

interface AutomaticEvolutionBudgetOptions {
  readonly now?: () => number
}

interface ReservationMarker {
  readonly signalId: string
  readonly reservedAt: string
}

interface BudgetJournal {
  readonly schemaVersion: 2
  readonly targetId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly utcDay: string
  readonly reservations: readonly ReservationMarker[]
}

/** Durable fail-closed cap applied before one automatic action may reach a paid proposer. */
export class AutomaticEvolutionBudget {
  private readonly now: () => number
  private tail: Promise<void> = Promise.resolve()

  constructor(options: AutomaticEvolutionBudgetOptions = {}) {
    this.now = options.now ?? Date.now
  }

  assertTargets(targets: readonly AutomaticEvolutionBudgetTarget[]): void {
    if (targets.length === 0 || targets.length > MAX_TARGETS) {
      throw new Error(`automatic evolution budget requires 1-${MAX_TARGETS} static targets`)
    }
    if (targets.some(target => !isAbsolute(target.runRoot))) {
      throw new Error('automatic evolution budget run roots must be absolute')
    }
    if (targets.some(target => dirname(resolve(target.runRoot)) === resolve(target.runRoot))) {
      throw new Error('automatic evolution budget run roots must not be filesystem roots')
    }
    if (targets.some(target => !Number.isInteger(target.maxAttemptsPerUtcDay)
      || target.maxAttemptsPerUtcDay < 1
      || target.maxAttemptsPerUtcDay > MAX_DAILY_ATTEMPTS)) {
      throw new Error(
        `automatic evolution budget daily attempt limits must be integers between 1 and ${MAX_DAILY_ATTEMPTS}`,
      )
    }
    if (targets.some(target => target.id.trim() === '' || target.skill.trim() === '')
      || targets.some(target => !isWorkspaceId(target.workspaceId))
      || new Set(targets.map(target => target.id)).size !== targets.length
      || new Set(targets.map(target => resolve(target.runRoot))).size !== targets.length) {
      throw new Error('automatic evolution budget Target ids and run roots must be unique')
    }
  }

  reserve(
    target: AutomaticEvolutionBudgetTarget,
    signalId: string,
  ): Promise<AutomaticEvolutionBudgetReservation> {
    if (!CONTENT_ID.test(signalId)) {
      return Promise.reject(new Error('automatic evolution budget signal id must be exact'))
    }
    this.assertTargets([target])
    return this.enqueue(() => this.reserveNow(target, signalId))
  }

  inspect(target: AutomaticEvolutionBudgetTarget): Promise<AutomaticEvolutionBudgetSnapshot> {
    this.assertTargets([target])
    return this.enqueue(async () => {
      const instant = this.now()
      const utcDay = dayOf(instant)
      const journal = await this.readJournal(target, utcDay, false)
      return snapshot(target, utcDay, journal.reservations.length)
    })
  }

  private async reserveNow(
    target: AutomaticEvolutionBudgetTarget,
    signalId: string,
  ): Promise<AutomaticEvolutionBudgetReservation> {
    const instant = this.now()
    const utcDay = dayOf(instant)
    const journal = await this.readJournal(target, utcDay, true)
    if (journal.reservations.some(entry => entry.signalId === signalId)) {
      return Object.freeze({
        allowed: true,
        newlyReserved: false,
        snapshot: snapshot(target, utcDay, journal.reservations.length),
      })
    }
    if (journal.reservations.length >= target.maxAttemptsPerUtcDay) {
      return Object.freeze({
        allowed: false,
        newlyReserved: false,
        retryAt: Date.parse(`${utcDay}T00:00:00.000Z`) + DAY_MS,
        snapshot: snapshot(target, utcDay, journal.reservations.length),
      })
    }

    const journalRoot = await this.journalRoot(target, true)
    const marker: ReservationMarker = Object.freeze({
      signalId,
      reservedAt: new Date(instant).toISOString(),
    })
    const next: BudgetJournal = Object.freeze({
      schemaVersion: 2,
      targetId: target.id,
      workspaceId: target.workspaceId,
      skillName: target.skill,
      utcDay,
      reservations: [...journal.reservations, marker],
    })
    await writeDurableJson(join(journalRoot, JOURNAL_FILE), next)
    return Object.freeze({
      allowed: true,
      newlyReserved: true,
      snapshot: snapshot(target, utcDay, next.reservations.length),
    })
  }

  private async readJournal(
    target: AutomaticEvolutionBudgetTarget,
    utcDay: string,
    create: boolean,
  ): Promise<BudgetJournal> {
    let journalRoot: string
    try {
      journalRoot = await this.journalRoot(target, create)
    } catch (error) {
      if (!create && isMissingPathError(error)) return emptyJournal(target, utcDay)
      throw error
    }
    let value: unknown
    try {
      value = JSON.parse(await readFile(join(journalRoot, JOURNAL_FILE), 'utf8'))
    } catch (error) {
      if (isMissingPathError(error)) return emptyJournal(target, utcDay)
      throw invalidJournal()
    }
    if (!isBudgetJournal(value)
      || value.targetId !== target.id
      || value.workspaceId !== target.workspaceId
      || value.skillName !== target.skill
      || value.utcDay > utcDay) throw invalidJournal()
    return value.utcDay === utcDay ? value : emptyJournal(target, utcDay)
  }

  private async journalRoot(
    target: AutomaticEvolutionBudgetTarget,
    create: boolean,
  ): Promise<string> {
    const requestedRunRoot = resolve(target.runRoot)
    if (create) await mkdir(requestedRunRoot, { recursive: true, mode: 0o700 })
    const runRootInfo = await lstat(requestedRunRoot)
    if (!runRootInfo.isDirectory() || runRootInfo.isSymbolicLink()) {
      throw new Error('automatic evolution budget run root must be a real directory')
    }
    const runRoot = await realpath(requestedRunRoot)
    const journalRoot = join(runRoot, JOURNAL_DIR)
    if (create) await mkdir(journalRoot, { recursive: true, mode: 0o700 })
    const exactJournalRoot = await realpath(journalRoot)
    if (exactJournalRoot !== journalRoot) {
      throw new Error('automatic evolution budget journal path is not exact')
    }
    return journalRoot
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation)
    this.tail = result.then(() => {}, () => {})
    return result
  }
}

function snapshot(
  target: AutomaticEvolutionBudgetTarget,
  utcDay: string,
  used: number,
): AutomaticEvolutionBudgetSnapshot {
  return Object.freeze({
    targetId: target.id,
    workspaceId: target.workspaceId,
    skillName: target.skill,
    utcDay,
    used,
    limit: target.maxAttemptsPerUtcDay,
    remaining: Math.max(0, target.maxAttemptsPerUtcDay - used),
  })
}

function dayOf(instant: number): string {
  if (!Number.isSafeInteger(instant) || instant < 0) {
    throw new Error('automatic evolution budget clock is invalid')
  }
  return new Date(instant).toISOString().slice(0, 10)
}

function emptyJournal(
  target: AutomaticEvolutionBudgetTarget,
  utcDay: string,
): BudgetJournal {
  return Object.freeze({
    schemaVersion: 2,
    targetId: target.id,
    workspaceId: target.workspaceId,
    skillName: target.skill,
    utcDay,
    reservations: [],
  })
}

function isBudgetJournal(value: unknown): value is BudgetJournal {
  return isRecord(value)
    && value.schemaVersion === 2
    && typeof value.targetId === 'string'
    && typeof value.workspaceId === 'string'
    && isWorkspaceId(value.workspaceId)
    && typeof value.skillName === 'string'
    && typeof value.utcDay === 'string'
    && /^\d{4}-\d{2}-\d{2}$/u.test(value.utcDay)
    && Array.isArray(value.reservations)
    && value.reservations.length <= MAX_DAILY_ATTEMPTS
    && value.reservations.every(entry => isReservationMarker(entry, value.utcDay as string))
    && new Set(value.reservations.map(entry => (entry as ReservationMarker).signalId)).size
      === value.reservations.length
    && Object.keys(value).length === 6
}

function isReservationMarker(value: unknown, utcDay: string): value is ReservationMarker {
  if (!isRecord(value)
    || typeof value.signalId !== 'string'
    || !CONTENT_ID.test(value.signalId)
    || typeof value.reservedAt !== 'string'
    || Object.keys(value).length !== 2) return false
  const instant = Date.parse(value.reservedAt)
  return Number.isSafeInteger(instant) && dayOf(instant) === utcDay
}

function invalidJournal(): Error {
  return new Error('automatic evolution budget journal is invalid; inspect it before retrying')
}

function isMissingPathError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isWorkspaceId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
}

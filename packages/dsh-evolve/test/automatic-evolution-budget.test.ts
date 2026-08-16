import { mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  AutomaticEvolutionBudget,
  type AutomaticEvolutionBudgetTarget,
} from '../src/automatic-evolution-budget.ts'

describe('AutomaticEvolutionBudget', () => {
  it('creates a missing statically configured owned root privately before the first reservation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-automatic-budget-new-root-'))
    const runRoot = join(root, 'new-owned-root')
    const budget = new AutomaticEvolutionBudget({ now: () => Date.UTC(2026, 7, 17, 12) })

    await expect(budget.reserve(budgetTarget(runRoot, 1), '9'.repeat(64)))
      .resolves.toMatchObject({ allowed: true, newlyReserved: true })

    expect((await stat(runRoot)).mode & 0o777).toBe(0o700)
    expect((await stat(join(runRoot, '.automatic-evolution-budget-v1', 'current.json'))).mode & 0o777)
      .toBe(0o600)
  })

  it('durably reserves a bounded number of automatic attempts per UTC day', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-automatic-budget-'))
    const runRoot = join(root, 'runs')
    await mkdir(runRoot)
    let now = Date.UTC(2026, 7, 17, 23, 59)
    const target = budgetTarget(runRoot, 2)
    const first = new AutomaticEvolutionBudget({ now: () => now })

    await expect(first.reserve(target, '1'.repeat(64))).resolves.toMatchObject({
      allowed: true,
      newlyReserved: true,
      snapshot: { utcDay: '2026-08-17', used: 1, limit: 2, remaining: 1 },
    })
    await expect(first.reserve(target, '1'.repeat(64))).resolves.toMatchObject({
      allowed: true,
      newlyReserved: false,
      snapshot: { used: 1, remaining: 1 },
    })
    await expect(first.reserve(target, '2'.repeat(64))).resolves.toMatchObject({
      allowed: true,
      newlyReserved: true,
      snapshot: { used: 2, remaining: 0 },
    })
    const denied = await first.reserve(target, '3'.repeat(64))
    expect(denied).toMatchObject({
      allowed: false,
      newlyReserved: false,
      snapshot: { used: 2, remaining: 0 },
    })
    expect(denied.retryAt).toBe(Date.UTC(2026, 7, 18))

    const afterRestart = new AutomaticEvolutionBudget({ now: () => now })
    await expect(afterRestart.reserve(target, '3'.repeat(64))).resolves.toMatchObject({
      allowed: false,
      snapshot: { used: 2, remaining: 0 },
    })

    now = Date.UTC(2026, 7, 18, 0, 1)
    await expect(afterRestart.reserve(target, '3'.repeat(64))).resolves.toMatchObject({
      allowed: true,
      newlyReserved: true,
      snapshot: { utcDay: '2026-08-18', used: 1, remaining: 1 },
    })

    const marker = join(
      runRoot,
      '.automatic-evolution-budget-v1',
      'current.json',
    )
    expect((await stat(marker)).mode & 0o777).toBe(0o600)
    expect(await readFile(marker, 'utf8')).not.toContain('/private')

    now = Date.UTC(2026, 7, 17, 23)
    await expect(new AutomaticEvolutionBudget({ now: () => now }).inspect(target))
      .rejects.toThrow('automatic evolution budget journal is invalid')
  })

  it('fails closed when a current-day reservation cannot be trusted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-automatic-budget-corrupt-'))
    const runRoot = join(root, 'runs')
    const journalRoot = join(runRoot, '.automatic-evolution-budget-v1')
    await mkdir(journalRoot, { recursive: true })
    await writeFile(join(journalRoot, 'current.json'), '{"schemaVersion":1}\n', { mode: 0o600 })
    const budget = new AutomaticEvolutionBudget({ now: () => Date.UTC(2026, 7, 17, 12) })

    await expect(budget.reserve(budgetTarget(runRoot, 2), '2'.repeat(64)))
      .rejects.toThrow('automatic evolution budget journal is invalid')
  })

  it('rejects mutable, unbounded, or ambiguous Target policy', () => {
    const budget = new AutomaticEvolutionBudget()
    expect(() => budget.assertTargets([])).toThrow('requires 1-20 static targets')
    expect(() => budget.assertTargets([budgetTarget('relative', 1)]))
      .toThrow('run roots must be absolute')
    expect(() => budget.assertTargets([budgetTarget('/', 1)]))
      .toThrow('run roots must not be filesystem roots')
    expect(() => budget.assertTargets([budgetTarget('/private/runs', 0)]))
      .toThrow('daily attempt limits must be integers between 1 and 20')
    expect(() => budget.assertTargets([
      budgetTarget('/private/one', 1),
      { ...budgetTarget('/private/two', 1), runRoot: '/private/one' },
    ])).toThrow('Target ids and run roots must be unique')
  })

  it('refuses a journal directory redirected outside the owned run root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-automatic-budget-symlink-'))
    const runRoot = join(root, 'runs')
    const outside = join(root, 'outside')
    await Promise.all([mkdir(runRoot), mkdir(outside)])
    await symlink(outside, join(runRoot, '.automatic-evolution-budget-v1'), 'dir')
    const budget = new AutomaticEvolutionBudget({ now: () => Date.UTC(2026, 7, 17) })

    await expect(budget.reserve(budgetTarget(runRoot, 1), '1'.repeat(64)))
      .rejects.toThrow('automatic evolution budget journal path is not exact')
  })

  it('refuses a configured run root that is itself a symbolic link', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-automatic-budget-root-symlink-'))
    const runRoot = join(root, 'runs')
    const outside = join(root, 'outside')
    await mkdir(outside)
    await symlink(outside, runRoot, 'dir')

    await expect(new AutomaticEvolutionBudget().reserve(
      budgetTarget(runRoot, 1),
      '1'.repeat(64),
    )).rejects.toThrow('run root must be a real directory')
  })
})

function budgetTarget(runRoot: string, maxAttemptsPerUtcDay: number): AutomaticEvolutionBudgetTarget {
  return {
    id: 'plugin-delivery',
    skill: 'stable-skill',
    runRoot,
    maxAttemptsPerUtcDay,
  }
}

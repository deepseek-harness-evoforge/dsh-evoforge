import { describe, expect, it, vi } from 'vitest'
import type { CapabilityGeneration, EvolutionStore } from '../src/generation-store.js'
import { executeEvolutionCommand } from '../src/evolve-command.js'

const rootId = '1'.repeat(64)
const childId = '2'.repeat(64)

describe('/evolve host command', () => {
  it('shows native status without invoking a model or creating state', async () => {
    const store = fakeStore()

    await expect(executeEvolutionCommand(store, '')).resolves.toEqual({
      kind: 'success',
      text: [
        'Evolution status',
        'Active: native DSH',
        'Future Sessions will use native capabilities.',
        '',
        'Commands: /evolve promote <64-char-generation-id>',
      ].join('\n'),
    })
    expect(store.promoteGeneration).not.toHaveBeenCalled()
    expect(store.rollbackGeneration).not.toHaveBeenCalled()
  })

  it('explains the active immutable Generation and exact rollback target', async () => {
    const root = generation(rootId)
    const store = fakeStore(root)

    const result = await executeEvolutionCommand(store, 'status')

    expect(result).toEqual({
      kind: 'success',
      text: [
        'Evolution status',
        `Active: ${rootId}`,
        'Rollback target: native DSH',
        'Artifacts:',
        `- skill stable-skill tree ${'a'.repeat(64)} commit ${'b'.repeat(40)}`,
        'Existing Sessions keep their pinned Generation.',
        '',
        'Commands: /evolve rollback',
      ].join('\n'),
    })
  })

  it('promotes a full content id only for future Sessions and is idempotent', async () => {
    const root = generation(rootId)
    const promoteGeneration = vi.fn<
      (id: string) => Promise<{ previousId: string | undefined; generation: CapabilityGeneration }>
    >(async () => ({ previousId: undefined, generation: root }))
    const store = fakeStore(undefined, { promoteGeneration })

    await expect(executeEvolutionCommand(store, `promote ${rootId}`)).resolves.toEqual({
      kind: 'success',
      text: [
        'Generation promoted for future Sessions.',
        'Previous: native DSH',
        `Active: ${rootId}`,
        'Existing Sessions were not changed.',
        `Rollback: /evolve rollback`,
      ].join('\n'),
    })
    expect(promoteGeneration).toHaveBeenCalledWith(rootId)

    promoteGeneration.mockResolvedValue({ previousId: rootId, generation: root })
    await expect(executeEvolutionCommand(store, `promote ${rootId}`)).resolves.toMatchObject({
      kind: 'success',
      text: `Generation ${rootId} is already active. Existing Sessions remain pinned.`,
    })
  })

  it('rolls a child to its parent and a root to native DSH', async () => {
    const root = generation(rootId)
    const child = generation(childId, rootId)
    const rollbackGeneration = vi.fn()
      .mockResolvedValueOnce({ previousId: childId, generation: root })
      .mockResolvedValueOnce({ previousId: rootId, generation: undefined })
    const store = fakeStore(child, { rollbackGeneration })

    await expect(executeEvolutionCommand(store, 'rollback')).resolves.toMatchObject({
      kind: 'success',
      text: [
        'Generation rolled back for future Sessions.',
        `Previous: ${childId}`,
        `Active: ${rootId}`,
        'Existing Sessions were not changed.',
      ].join('\n'),
    })
    await expect(executeEvolutionCommand(store, 'rollback')).resolves.toMatchObject({
      kind: 'success',
      text: [
        'Generation rolled back for future Sessions.',
        `Previous: ${rootId}`,
        'Active: native DSH',
        'Existing Sessions were not changed.',
      ].join('\n'),
    })
  })

  it('rejects ambiguous ids and unknown actions without touching release state', async () => {
    const store = fakeStore()

    for (const input of ['promote', 'promote abc', `promote ${rootId} extra`, 'review']) {
      await expect(executeEvolutionCommand(store, input)).resolves.toMatchObject({
        kind: 'error',
        text: 'Usage: /evolve [status|promote <64-char-generation-id>|rollback]',
      })
    }
    expect(store.promoteGeneration).not.toHaveBeenCalled()
    expect(store.rollbackGeneration).not.toHaveBeenCalled()
  })

  it('returns an actionable host error instead of throwing an implementation stack', async () => {
    const store = fakeStore(undefined, {
      promoteGeneration: vi.fn(async () => { throw new Error(`Generation '${rootId}' does not exist`) }),
    })

    await expect(executeEvolutionCommand(store, `promote ${rootId}`)).resolves.toEqual({
      kind: 'error',
      text: `Evolution action failed: Generation '${rootId}' does not exist`,
    })
  })
})

function generation(id: string, parentId?: string): CapabilityGeneration {
  return {
    id,
    schemaVersion: 1,
    ...(parentId === undefined ? {} : { parentId }),
    createdAt: 1_723_456_789_000,
    artifacts: [{
      kind: 'skill',
      name: 'stable-skill',
      gitCommit: 'b'.repeat(40),
      treeHash: 'a'.repeat(64),
    }],
    evaluatorVersion: 'fixture',
    policyVersion: 'human-p0c.1',
    compositionFingerprint: 'c'.repeat(64),
  }
}

function fakeStore(
  active?: CapabilityGeneration,
  overrides: Partial<EvolutionStore> = {},
): EvolutionStore & {
  promoteGeneration: ReturnType<typeof vi.fn>
  rollbackGeneration: ReturnType<typeof vi.fn>
} {
  return {
    publishGeneration: vi.fn(),
    getGeneration: vi.fn(),
    getActiveGeneration: vi.fn(() => active),
    promoteGeneration: vi.fn(),
    rollbackGeneration: vi.fn(),
    pinSession: vi.fn(),
    fallbackSessionToNative: vi.fn(),
    getSessionGeneration: vi.fn(),
    close: vi.fn(),
    ...overrides,
  } as unknown as EvolutionStore & {
    promoteGeneration: ReturnType<typeof vi.fn>
    rollbackGeneration: ReturnType<typeof vi.fn>
  }
}

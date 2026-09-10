import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyCapabilityGenerationIdentityV2 } from '../src/generation-store.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

describe('Capability Generation identity verifier', () => {
  it('returns an immutable exact content-addressed Generation for its Workspace', () => {
    const generation = generationFixture()

    const verified = verifyCapabilityGenerationIdentityV2(generation, WORKSPACE_ID)

    expect(verified).toEqual(generation)
    expect(Object.isFrozen(verified)).toBe(true)
    expect(Object.isFrozen(verified.artifacts)).toBe(true)
    expect(Object.isFrozen(verified.artifacts[0])).toBe(true)
  })

  it.each([
    ['wrong id', (generation: Record<string, unknown>) => ({ ...generation, id: 'f'.repeat(64) })],
    ['wrong Workspace', (generation: Record<string, unknown>) => generation],
    ['unknown field', (generation: Record<string, unknown>) => ({ ...generation, extra: true })],
  ])('rejects %s', (_name, mutate) => {
    const generation = generationFixture() as unknown as Record<string, unknown>
    const candidate = mutate(generation)
    const expectedWorkspaceId = _name === 'wrong Workspace'
      ? '66eec664-6d5c-4cba-b5eb-1ab680201134'
      : WORKSPACE_ID

    expect(() => verifyCapabilityGenerationIdentityV2(candidate, expectedWorkspaceId)).toThrow()
  })

  it('does not invoke hostile accessors or proxy coercion', () => {
    let getterInvoked = false
    const accessor = Object.create(null) as Record<string, unknown>
    Object.defineProperty(accessor, 'schemaVersion', {
      enumerable: true,
      get() {
        getterInvoked = true
        throw new Error('must not run')
      },
    })
    let proxyTrapInvoked = false
    const proxy = new Proxy(generationFixture(), {
      ownKeys() {
        proxyTrapInvoked = true
        throw new Error('must not run')
      },
    })

    expect(() => verifyCapabilityGenerationIdentityV2(accessor, WORKSPACE_ID)).toThrow()
    expect(getterInvoked).toBe(false)
    expect(() => verifyCapabilityGenerationIdentityV2(proxy, WORKSPACE_ID)).toThrow()
    expect(proxyTrapInvoked).toBe(true)
  })
})

function generationFixture() {
  const content = {
    schemaVersion: 2 as const,
    workspaceId: WORKSPACE_ID,
    createdAt: 1_777_000_000_000,
    artifacts: [{
      kind: 'skill' as const,
      name: 'release-proof',
      gitCommit: '0123456789abcdef0123456789abcdef01234567',
      treeHash: 'a'.repeat(64),
    }],
    evaluatorVersion: 'capability-absent-v1',
    policyVersion: 'human-review-v1',
    compositionFingerprint: 'b'.repeat(64),
  }
  return {
    ...content,
    id: createHash('sha256').update(canonicalJson(content)).digest('hex'),
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number'
    || typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value !== 'object') throw new TypeError('unsupported test value')
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

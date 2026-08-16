import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FeedbackCaseDraftBuilder } from '../src/feedback-case-draft.js'
import type { CapabilityGeneration } from '../src/generation-store.js'

const roots: string[] = []
const signalId = '1'.repeat(64)
const generationId = '2'.repeat(64)
const messageId = 'assistant-message'
const feedbackVersion = '2ac7603f-c2f4-4f38-a091-f86bded520b1'

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { force: true, recursive: true })))
})

describe('FeedbackCaseDraftBuilder rejection gates', () => {
  it('rejects a turn with more than one explicitly invoked Skill', async () => {
    const root = await temporaryRoot()
    const builder = fixtureBuilder(join(root, 'drafts'), [
      directUser('/stable-skill do the work'),
      invokedSkill('stable-skill', 2),
      invokedSkill('other-skill', 3),
    ])

    await expect(builder.create(signalId, 'stable-skill')).rejects.toThrow(
      "feedback target turn must contain exactly one explicit invocation of Skill 'stable-skill'",
    )
  })

  it('refuses to write into a group- or world-readable draft root', async () => {
    const root = await temporaryRoot()
    const draftRoot = join(root, 'drafts')
    await mkdir(draftRoot, { mode: 0o755 })
    await chmod(draftRoot, 0o755)
    const builder = fixtureBuilder(draftRoot, [
      directUser('/stable-skill do the work'),
      invokedSkill('stable-skill', 2),
    ])

    await expect(builder.create(signalId, 'stable-skill')).rejects.toThrow(
      'feedbackDraftRoot must not grant group or world permissions',
    )
  })

  it('rejects a stale native feedback version even if its derived signal has not retracted yet', async () => {
    const root = await temporaryRoot()
    const builder = fixtureBuilder(join(root, 'drafts'), [
      directUser('/stable-skill do the work'),
      invokedSkill('stable-skill', 2),
    ], { currentVersion: '6836c43f-721a-4be8-9fca-89403b39095b' })

    await expect(builder.create(signalId, 'stable-skill')).rejects.toThrow(
      'feedback signal is no longer current',
    )
  })
})

function fixtureBuilder(
  root: string,
  userEvents: unknown[],
  options: { currentVersion?: string } = {},
): FeedbackCaseDraftBuilder {
  const generation: CapabilityGeneration = {
    schemaVersion: 1,
    id: generationId,
    createdAt: 1,
    artifacts: [{
      kind: 'skill',
      name: 'stable-skill',
      gitCommit: 'a'.repeat(40),
      treeHash: 'b'.repeat(64),
    }],
    evaluatorVersion: 'fixture',
    policyVersion: 'fixture',
    compositionFingerprint: 'c'.repeat(64),
  }
  const events = [
    event('turn/start', 0, { turn: 1 }),
    ...userEvents,
    event('assistant/message', 4, {
      turn: 1,
      step: 0,
      message: {
        id: messageId,
        role: 'assistant',
        source: { kind: 'model', provider: 'fixed', model: 'fixed' },
        content: [{ type: 'text', text: 'answer must never enter the draft' }],
      },
    }),
  ]
  return new FeedbackCaseDraftBuilder(
    root,
    {
      get: vi.fn(() => ({
        schemaVersion: 1 as const,
        id: signalId,
        observedAt: 3,
        sessionId: 'session-1',
        messageId,
        feedbackVersion,
        sourceUpdatedAt: 2,
        generationId,
      })),
    },
    { getSessionGeneration: vi.fn(() => generation) },
    { resolveArtifact: vi.fn(async (_name, artifact) => ({ artifact })) } as never,
    {
      list: vi.fn(async () => ({
        ok: true,
        value: {
          items: [{
            messageId,
            rating: 'negative',
            note: 'Use the exact verification flow.',
            version: options.currentVersion ?? feedbackVersion,
            createdAt: 1,
            updatedAt: 2,
          }],
        },
      })),
    } as never,
    {
      readFrom: vi.fn(async () => ({
        meta: { version: 0, id: 'session-1', createdAt: 1, cwd: '/private/project' },
        events,
      })),
    } as never,
  )
}

function directUser(text: string): unknown {
  return event('user/message', 1, {
    id: 'direct-user',
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text }],
  })
}

function invokedSkill(name: string, seq: number): unknown {
  return event('user/message', seq, {
    id: `invoked-${name}`,
    role: 'user',
    source: { kind: 'skill-invocation', name, form: 'instructions' },
    content: [{ type: 'text', text: `private body for ${name}` }],
  })
}

function event(type: string, seq: number, data: unknown): unknown {
  return { type, seq, time: seq + 1, data }
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-feedback-draft-unit-'))
  roots.push(root)
  return root
}

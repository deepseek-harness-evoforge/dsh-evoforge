import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FeedbackCaseDraftBuilder,
  readPrivateFeedbackCaseDraft,
} from '../src/feedback-case-draft.js'
import type { CapabilityGeneration } from '../src/generation-store.js'
import { WORKSPACE_ID } from './workspace-fixture.ts'

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
    const builder = await fixtureBuilder(root, join(root, 'drafts'), [
      directUser('/stable-skill do the work'),
      invokedSkill('stable-skill', 2),
      invokedSkill('other-skill', 3),
    ])

    await expect(builder.create(WORKSPACE_ID, signalId, 'stable-skill')).rejects.toThrow(
      "feedback target turn must contain exactly one explicit invocation of Skill 'stable-skill'",
    )
  })

  it('refuses to write into a group- or world-readable draft root', async () => {
    const root = await temporaryRoot()
    const draftRoot = join(root, 'drafts')
    await mkdir(draftRoot, { mode: 0o755 })
    await chmod(draftRoot, 0o755)
    const builder = await fixtureBuilder(root, draftRoot, [
      directUser('/stable-skill do the work'),
      invokedSkill('stable-skill', 2),
    ])

    await expect(builder.create(WORKSPACE_ID, signalId, 'stable-skill')).rejects.toThrow(
      'feedbackDraftRoot must not grant group or world permissions',
    )
  })

  it('rejects a stale native feedback version even if its derived signal has not retracted yet', async () => {
    const root = await temporaryRoot()
    const builder = await fixtureBuilder(root, join(root, 'drafts'), [
      directUser('/stable-skill do the work'),
      invokedSkill('stable-skill', 2),
    ], { currentVersion: '6836c43f-721a-4be8-9fca-89403b39095b' })

    await expect(builder.create(WORKSPACE_ID, signalId, 'stable-skill')).rejects.toThrow(
      'feedback signal is no longer current',
    )
  })

  it('authenticates a private draft and rejects content changed under the same id', async () => {
    const root = await temporaryRoot()
    const builder = await fixtureBuilder(root, join(root, 'drafts'), [
      directUser('/stable-skill do the work'),
      invokedSkill('stable-skill', 2),
    ])
    const created = await builder.create(WORKSPACE_ID, signalId, 'stable-skill')

    await expect(readPrivateFeedbackCaseDraft(created.path)).resolves.toEqual(created.draft)
    const tampered = JSON.parse(JSON.stringify(created.draft))
    tampered.sample.correction = 'silently changed correction'
    await writeFile(created.path, `${JSON.stringify(tampered, null, 2)}\n`)
    await expect(readPrivateFeedbackCaseDraft(created.path)).rejects.toThrow(
      'feedback draft id does not match its content',
    )
  })

  it('rejects a group-readable draft before parsing its content', async () => {
    const root = await temporaryRoot()
    const path = join(root, 'public-draft.json')
    await writeFile(path, '{}\n', { mode: 0o600 })
    await chmod(path, 0o640)

    await expect(readPrivateFeedbackCaseDraft(path)).rejects.toThrow(
      'feedback draft must be a private regular file',
    )
  })

  it('never follows a symlink selected as a private draft', async () => {
    const root = await temporaryRoot()
    const target = join(root, 'target.json')
    const path = join(root, 'linked-draft.json')
    await writeFile(target, '{}\n', { mode: 0o600 })
    await symlink(target, path)

    await expect(readPrivateFeedbackCaseDraft(path)).rejects.toThrow(
      'feedback draft must be a private regular file',
    )
  })
})

async function fixtureBuilder(
  root: string,
  draftRoot: string,
  userEvents: unknown[],
  options: { currentVersion?: string } = {},
): Promise<FeedbackCaseDraftBuilder> {
  const resourceBase = join(root, 'materialized-skill')
  await mkdir(resourceBase, { recursive: true })
  await writeFile(join(resourceBase, 'SKILL.md'), 'private materialized fixture\n')
  const generation: CapabilityGeneration = {
    schemaVersion: 2,
    workspaceId: WORKSPACE_ID,
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
    draftRoot,
    {
      get: vi.fn(() => ({
        schemaVersion: 2 as const,
        workspaceId: WORKSPACE_ID,
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
    { resolveArtifact: vi.fn(async (_name, artifact) => ({ artifact, resourceBase })) } as never,
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

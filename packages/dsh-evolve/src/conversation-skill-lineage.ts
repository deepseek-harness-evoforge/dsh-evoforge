import { createHash } from 'node:crypto'
import { z } from 'zod'
import { assembleSealedSkillBundleArchive, type SkillBundleArchiveFile } from './skill-bundle-archive.ts'

const hash = z.string().regex(/^[a-f0-9]{64}$/u)
export const conversationTrialBaselineSchema = z.strictObject({
  selectionSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  generationId: hash.optional(),
})
export type ConversationTrialBaseline = z.infer<typeof conversationTrialBaselineSchema>

const lineageSchema = z.strictObject({
  kind: z.literal('conversation-skill-lineage-v1'),
  workspaceId: z.uuid(), skillName: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(64),
  draftId: hash, trialId: hash, sourceDigest: hash, governanceDigest: hash,
  trialDigest: hash, draftContentHash: hash,
  contentHash: hash, candidateTreeHash: hash,
  baseline: conversationTrialBaselineSchema,
  releaseAuthority: z.literal('none'),
})

/** Provenance of an ordinary conversation proposal, never a fabricated Goal Candidate. */
export type ConversationSkillLineage = z.infer<typeof lineageSchema>
export function parseConversationSkillLineage(value: unknown): ConversationSkillLineage {
  return lineageSchema.parse(value)
}

/** The exact one-file instructions tested by the native trial, without invented references. */
export async function assembleConversationSkillArchive(files: readonly SkillBundleArchiveFile[], expectedHash: string) {
  const file = files[0]
  if (files.length !== 1 || file?.path !== 'SKILL.md' || file.mode !== '100644'
    || file.content.byteLength > 48_000 || file.content.byteLength === 0
    || !Buffer.from(file.content.toString('utf8')).equals(file.content)
    || file.content.includes(0)
    || createHash('sha256').update(file.content).digest('hex') !== expectedHash) {
    throw new Error('conversation Skill archive differs from its evaluated instructions')
  }
  return assembleSealedSkillBundleArchive(files)
}

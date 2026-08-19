import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

const CONTENT_ID = /^[a-f0-9]{64}$/
const PUBLIC_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const subjectSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('internal-capability-absent-subject-v1'),
  workspaceId: z.uuid(),
  opportunityId: z.string().regex(CONTENT_ID),
  skillName: z.string().regex(PUBLIC_ID),
})

export interface CapabilityAbsentSubject {
  readonly schemaVersion: 1
  readonly kind: 'internal-capability-absent-subject-v1'
  readonly workspaceId: string
  readonly opportunityId: string
  readonly skillName: string
}

/** Read the one canonical descriptor shared by Envelope, Retention, and Canary. */
export async function readCapabilityAbsentSubject(root: string): Promise<CapabilityAbsentSubject> {
  const entries = await readdir(root, { withFileTypes: true })
  if (entries.length !== 1 || entries[0]?.name !== 'subject.json' || !entries[0].isFile()) {
    throw new Error('capability-absent baseline must contain only subject.json')
  }
  const path = join(root, 'subject.json')
  const [info, actual] = await Promise.all([lstat(path), realpath(path)])
  if (!info.isFile() || info.isSymbolicLink() || actual !== path) {
    throw new Error('capability-absent baseline subject must be an exact real file')
  }
  return Object.freeze(subjectSchema.parse(JSON.parse(await readFile(path, 'utf8'))))
}

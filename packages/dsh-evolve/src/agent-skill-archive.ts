import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { gunzipSync } from 'node:zlib'
import { extract } from 'tar-stream'
import { fromBufferPromise, type Entry as ZipEntry } from 'yauzl'

export type AgentSkillArchiveFormat = 'tar.gz' | 'zip'
export type AgentSkillArchiveFileMode = '100644' | '100755'

export interface AgentSkillArchiveFile {
  readonly path: string
  readonly mode: AgentSkillArchiveFileMode
  readonly content: Buffer
}

export interface DecodedAgentSkillArchive {
  readonly files: readonly AgentSkillArchiveFile[]
  readonly treeHash: string
  readonly totalBytes: number
}

export const AGENT_SKILL_ARCHIVE_LIMITS = Object.freeze({
  maxEntries: 512,
  maxFiles: 256,
  maxFileBytes: 8 * 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
})

const TAR_CONTAINER_OVERHEAD = (AGENT_SKILL_ARCHIVE_LIMITS.maxEntries + 4) * 1024
const UNIX_FILE_TYPE_MASK = 0o170000
const UNIX_REGULAR_FILE = 0o100000
const UNIX_DIRECTORY = 0o040000

export async function decodeAgentSkillArchive(
  content: Uint8Array,
  format: AgentSkillArchiveFormat,
): Promise<DecodedAgentSkillArchive> {
  const bytes = Buffer.from(content)
  const files = format === 'tar.gz'
    ? await decodeTarGzip(bytes)
    : await decodeZip(bytes)
  return finalize(files)
}

async function decodeTarGzip(content: Buffer): Promise<AgentSkillArchiveFile[]> {
  let tar: Buffer
  try {
    tar = gunzipSync(content, {
      maxOutputLength: AGENT_SKILL_ARCHIVE_LIMITS.maxTotalBytes + TAR_CONTAINER_OVERHEAD,
    })
  } catch (error) {
    throw new Error(`invalid or excessive tar.gz archive: ${errorMessage(error)}`)
  }

  const parser = extract()
  Readable.from(tar).pipe(parser)
  const files: AgentSkillArchiveFile[] = []
  let entryCount = 0
  let totalBytes = 0

  try {
    for await (const entry of parser) {
      entryCount += 1
      if (entryCount > AGENT_SKILL_ARCHIVE_LIMITS.maxEntries) {
        throw new Error('archive entry count exceeds safety limit')
      }
      const header = entry.header
      const type = header.type ?? 'file'
      if (type === 'directory') {
        validateArchivePath(header.name, true)
        for await (const _chunk of entry) {
          // Drain directory payloads; tar directories should be empty.
        }
        continue
      }
      if (type !== 'file' && type !== 'contiguous-file') {
        throw new Error(`non-regular entry is not allowed: ${header.name}`)
      }

      const path = validateArchivePath(header.name, false)
      const declaredSize = header.size ?? 0
      assertFileBudget(path, declaredSize, totalBytes, files.length)
      const file = await readBounded(entry, path, declaredSize, totalBytes)
      totalBytes += file.length
      files.push(Object.freeze({
        path,
        mode: normalizeMode(header.mode),
        content: file,
      }))
    }
  } catch (error) {
    parser.destroy()
    throw error
  }

  return files
}

async function decodeZip(content: Buffer): Promise<AgentSkillArchiveFile[]> {
  const archive = await fromBufferPromise(content, {
    autoClose: true,
    decodeStrings: true,
    lazyEntries: true,
    strictFileNames: true,
    validateEntrySizes: true,
  })
  const files: AgentSkillArchiveFile[] = []
  let totalBytes = 0

  try {
    if (archive.entryCount > AGENT_SKILL_ARCHIVE_LIMITS.maxEntries) {
      throw new Error('archive entry count exceeds safety limit')
    }
    for await (const entry of archive.eachEntry()) {
      const directory = entry.fileName.endsWith('/')
      const unixType = zipUnixFileType(entry)
      if (directory) {
        validateArchivePath(entry.fileName, true)
        if (unixType !== 0 && unixType !== UNIX_DIRECTORY) {
          throw new Error(`non-regular entry is not allowed: ${entry.fileName}`)
        }
        continue
      }
      if (entry.isEncrypted()) throw new Error(`encrypted entry is not allowed: ${entry.fileName}`)
      if (unixType !== 0 && unixType !== UNIX_REGULAR_FILE) {
        throw new Error(`non-regular entry is not allowed: ${entry.fileName}`)
      }

      const path = validateArchivePath(entry.fileName, false)
      assertFileBudget(path, entry.uncompressedSize, totalBytes, files.length)
      const stream = await archive.openReadStreamPromise(entry)
      const file = await readBounded(stream, path, entry.uncompressedSize, totalBytes)
      totalBytes += file.length
      files.push(Object.freeze({
        path,
        mode: normalizeMode(zipUnixMode(entry)),
        content: file,
      }))
    }
  } finally {
    archive.close()
  }

  return files
}

function finalize(input: AgentSkillArchiveFile[]): DecodedAgentSkillArchive {
  if (input.length === 0) throw new Error('archive contains no regular files')
  if (input.length > AGENT_SKILL_ARCHIVE_LIMITS.maxFiles) {
    throw new Error('archive file count exceeds safety limit')
  }

  const files = [...input].sort((left, right) => compareTreePaths(left.path, right.path))
  const paths = new Set(input.map(file => file.path))
  if (paths.size !== input.length) {
    const duplicate = input.find((file, index) => input.findIndex(item => item.path === file.path) !== index)
    throw new Error(`duplicate path in archive: ${duplicate?.path ?? '[unknown]'}`)
  }
  const portablePaths = new Map<string, string>()
  for (const file of files) {
    const segments = file.path.split('/')
    for (let depth = 1; depth <= segments.length; depth += 1) {
      const path = segments.slice(0, depth).join('/')
      const portablePath = path.toLocaleLowerCase('en-US')
      const collision = portablePaths.get(portablePath)
      if (collision !== undefined && collision !== path) {
        throw new Error(`portable path collision in archive: ${collision} and ${path}`)
      }
      portablePaths.set(portablePath, path)
    }
    for (let depth = 1; depth < segments.length; depth += 1) {
      const parent = segments.slice(0, depth).join('/')
      if (paths.has(parent)) {
        throw new Error(`file and directory path collision in archive: ${parent}`)
      }
    }
  }

  const hash = createHash('sha256')
  let totalBytes = 0
  for (const file of files) {
    hash.update(file.path)
    hash.update('\0')
    hash.update(file.content)
    hash.update('\0')
    totalBytes += file.content.length
  }

  return Object.freeze({
    files: Object.freeze(files),
    treeHash: hash.digest('hex'),
    totalBytes,
  })
}

function validateArchivePath(input: string, directory: boolean): string {
  const path = directory && input.endsWith('/') ? input.slice(0, -1) : input
  if (path.length === 0
    || path.length > 1_024
    || path !== path.normalize('NFC')
    || /[\u0000-\u001F\u007F]/u.test(path)
    || path.includes('\\')
    || path.startsWith('/')
    || /^[A-Za-z]:/.test(path)) {
    throw new Error(`unsafe path in archive: ${input}`)
  }
  const segments = path.split('/')
  if (segments.some(segment => segment === ''
    || segment === '.'
    || segment === '..'
    || Buffer.byteLength(segment) > 255)) {
    throw new Error(`unsafe path in archive: ${input}`)
  }
  return path
}

function compareTreePaths(left: string, right: string): number {
  const leftParts = left.split('/')
  const rightParts = right.split('/')
  const length = Math.min(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const order = leftParts[index]!.localeCompare(rightParts[index]!)
    if (order !== 0) return order
  }
  return leftParts.length - rightParts.length
}

function assertFileBudget(path: string, size: number, totalBytes: number, fileCount: number): void {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error(`invalid file size in archive: ${path}`)
  if (fileCount >= AGENT_SKILL_ARCHIVE_LIMITS.maxFiles) {
    throw new Error('archive file count exceeds safety limit')
  }
  if (size > AGENT_SKILL_ARCHIVE_LIMITS.maxFileBytes) {
    throw new Error(`archive file exceeds safety limit: ${path}`)
  }
  if (totalBytes + size > AGENT_SKILL_ARCHIVE_LIMITS.maxTotalBytes) {
    throw new Error('archive total bytes exceed safety limit')
  }
}

async function readBounded(
  stream: NodeJS.ReadableStream,
  path: string,
  declaredSize: number,
  priorTotalBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk)
    length += bytes.length
    if (length > declaredSize
      || length > AGENT_SKILL_ARCHIVE_LIMITS.maxFileBytes
      || priorTotalBytes + length > AGENT_SKILL_ARCHIVE_LIMITS.maxTotalBytes) {
      throw new Error(`archive file exceeds declared or safety limit: ${path}`)
    }
    chunks.push(bytes)
  }
  if (length !== declaredSize) throw new Error(`archive file size mismatch: ${path}`)
  return Buffer.concat(chunks, length)
}

function normalizeMode(mode: number | undefined): AgentSkillArchiveFileMode {
  return mode !== undefined && (mode & 0o111) !== 0 ? '100755' : '100644'
}

function zipUnixMode(entry: ZipEntry): number {
  return (entry.externalFileAttributes >>> 16) & 0xffff
}

function zipUnixFileType(entry: ZipEntry): number {
  const creatorSystem = entry.versionMadeBy >>> 8
  return creatorSystem === 3 ? zipUnixMode(entry) & UNIX_FILE_TYPE_MASK : 0
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

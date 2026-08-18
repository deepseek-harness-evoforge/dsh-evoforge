import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { gunzipSync, gzipSync } from 'node:zlib'
import { extract, pack } from 'tar-stream'
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

export interface AgentSkillTextManifestFile {
  readonly path: string
  readonly content: string
}

export interface AssembledAgentSkillTextArchive extends DecodedAgentSkillArchive {
  readonly format: 'tar.gz'
  readonly content: Buffer
  readonly artifactDigest: string
}

export const AGENT_SKILL_ARCHIVE_LIMITS = Object.freeze({
  maxEntries: 512,
  maxFiles: 256,
  maxFileBytes: 8 * 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
})

export const AUTHORED_AGENT_SKILL_TEXT_LIMITS = Object.freeze({
  maxFiles: 32,
  maxFileBytes: 64 * 1024,
  maxTotalBytes: 256 * 1024,
})

const TAR_CONTAINER_OVERHEAD = (AGENT_SKILL_ARCHIVE_LIMITS.maxEntries + 4) * 1024
const UNIX_FILE_TYPE_MASK = 0o170000
const UNIX_REGULAR_FILE = 0o100000
const UNIX_DIRECTORY = 0o040000

/**
 * Assemble one canonical, text-only whole-Skill package. The caller supplies
 * text files, never archive bytes; this host-owned codec fixes paths, modes,
 * ordering, tar metadata, and gzip output before the candidate is hashed.
 */
export async function assembleAgentSkillTextArchive(
  input: readonly AgentSkillTextManifestFile[],
): Promise<AssembledAgentSkillTextArchive> {
  const files = validateAuthoredTextManifest(input)
  const decoded = finalize(files)
  const archive = pack()
  const output = collect(archive)
  for (const file of decoded.files) {
    await new Promise<void>((resolve, reject) => {
      archive.entry({
        name: file.path,
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        uname: '',
        gname: '',
        mtime: new Date(0),
      }, file.content, error => error === null ? resolve() : reject(error))
    })
  }
  archive.finalize()
  const content = gzipSync(await output, { level: 9 })
  return Object.freeze({
    ...decoded,
    format: 'tar.gz',
    content,
    artifactDigest: createHash('sha256').update(content).digest('hex'),
  })
}

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

function validateAuthoredTextManifest(
  input: readonly AgentSkillTextManifestFile[],
): AgentSkillArchiveFile[] {
  if (input.length < 2 || input.length > AUTHORED_AGENT_SKILL_TEXT_LIMITS.maxFiles) {
    throw new Error('authored whole-Skill requires SKILL.md and 1-31 one-level references')
  }
  const files: AgentSkillArchiveFile[] = []
  const paths = new Set<string>()
  let totalBytes = 0
  for (const item of input) {
    if (typeof item !== 'object' || item === null
      || Object.keys(item).sort().join(',') !== 'content,path'
      || typeof item.path !== 'string'
      || typeof item.content !== 'string') {
      throw new Error('authored whole-Skill text manifest has an invalid shape')
    }
    const path = validateArchivePath(item.path, false)
    if (path !== 'SKILL.md' && !/^references\/[^/]+\.md$/u.test(path)) {
      throw new Error('authored whole-Skill is text-only and permits only one-level references/*.md')
    }
    if (paths.has(path)) throw new Error(`duplicate path in authored whole-Skill: ${path}`)
    paths.add(path)
    if (item.content.includes('\0') || /\r(?!\n)/u.test(item.content)) {
      throw new Error(`authored whole-Skill file is not canonical text: ${path}`)
    }
    const normalized = item.content.replaceAll('\r\n', '\n')
    const content = Buffer.from(normalized)
    if (content.toString('utf8') !== normalized) {
      throw new Error(`authored whole-Skill file is not canonical UTF-8 text: ${path}`)
    }
    if (content.byteLength === 0
      || content.byteLength > AUTHORED_AGENT_SKILL_TEXT_LIMITS.maxFileBytes
      || totalBytes + content.byteLength > AUTHORED_AGENT_SKILL_TEXT_LIMITS.maxTotalBytes) {
      throw new Error('authored whole-Skill text exceeds its byte budget')
    }
    totalBytes += content.byteLength
    files.push(Object.freeze({ path, mode: '100644', content }))
  }
  const skill = files.find(file => file.path === 'SKILL.md')
  if (skill === undefined) throw new Error('authored whole-Skill has no root SKILL.md')
  const referencePaths = new Set(files
    .filter(file => file.path.startsWith('references/'))
    .map(file => file.path))
  const linked = new Set<string>()
  for (const target of markdownLinkTargets(skill.content.toString('utf8'))) {
    if (isExternalOrFragmentLink(target)) continue
    const path = target.split('#', 1)[0]!
    if (!referencePaths.has(path)) {
      throw new Error(`authored whole-Skill has a missing reference: ${path}`)
    }
    linked.add(path)
  }
  for (const file of files) {
    if (file.path === 'SKILL.md') continue
    if (markdownLinkTargets(file.content.toString('utf8'))
      .some(target => !isExternalOrFragmentLink(target))) {
      throw new Error('authored whole-Skill reference chains are not allowed')
    }
  }
  const unreferenced = [...referencePaths].find(path => !linked.has(path))
  if (unreferenced !== undefined) {
    throw new Error(`authored whole-Skill has an unreferenced file: ${unreferenced}`)
  }
  return files
}

function markdownLinkTargets(content: string): string[] {
  return [...content.matchAll(/\[[^\]\r\n]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/gu)]
    .map(match => match[1]!)
}

function isExternalOrFragmentLink(target: string): boolean {
  return target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/iu.test(target)
}

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
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

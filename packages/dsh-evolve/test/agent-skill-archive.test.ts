import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { pack } from 'tar-stream'
import { ZipFile } from 'yazl'
import { describe, expect, it } from 'vitest'
import {
  decodeAgentSkillArchive,
  type AgentSkillArchiveFormat,
} from '../src/agent-skill-archive.ts'

describe('Agent Skill archive safety', () => {
  it('uses the same component-wise order as a materialized DSH file tree', async () => {
    const decoded = await decodeAgentSkillArchive(await makeTar([
      { path: 'a/z', content: 'nested' },
      { path: 'a-b', content: 'sibling' },
    ]), 'tar.gz')
    expect(decoded.files.map(file => file.path)).toEqual(['a/z', 'a-b'])
    expect(decoded.treeHash).toBe(createHash('sha256')
      .update('a/z').update('\0').update('nested').update('\0')
      .update('a-b').update('\0').update('sibling').update('\0')
      .digest('hex'))
  })

  for (const format of ['tar.gz', 'zip'] as const) {
    it(`decodes a bounded regular-file ${format} package without writing it`, async () => {
      const skill = '---\nname: archived-skill\ndescription: Use one archived Skill.\n---\n\nRead references/checks.md.\n'
      const archive = await makeArchive(format, [
        { path: 'SKILL.md', content: skill },
        { path: 'references/checks.md', content: 'Check the exact result.\n' },
        { path: 'scripts/verify.sh', content: '#!/bin/sh\nexit 0\n', executable: true },
      ])

      await expect(decodeAgentSkillArchive(archive, format)).resolves.toMatchObject({
        files: [
          { path: 'references/checks.md', mode: '100644', content: expect.any(Buffer) },
          { path: 'scripts/verify.sh', mode: '100755', content: expect.any(Buffer) },
          { path: 'SKILL.md', mode: '100644', content: Buffer.from(skill) },
        ],
        treeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        totalBytes: Buffer.byteLength(skill) + 24 + 17,
      })
    })
  }

  it('rejects traversal, duplicate paths, links, special files, and excessive entry counts', async () => {
    await expect(decodeAgentSkillArchive(await makeTar([
      { path: '../escape', content: 'bad' },
    ]), 'tar.gz')).rejects.toThrow('unsafe path')

    await expect(decodeAgentSkillArchive(await makeTar([
      { path: 'SKILL.md', content: 'first' },
      { path: 'SKILL.md', content: 'second' },
    ]), 'tar.gz')).rejects.toThrow('duplicate path')

    await expect(decodeAgentSkillArchive(await makeTar([
      { path: 'a', content: 'file' },
      { path: 'a-b', content: 'decoy' },
      { path: 'a/b', content: 'nested' },
    ]), 'tar.gz')).rejects.toThrow('path collision')

    await expect(decodeAgentSkillArchive(await makeTar([
      { path: 'README.md', content: 'first' },
      { path: 'readme.md', content: 'second' },
    ]), 'tar.gz')).rejects.toThrow('portable path collision')

    await expect(decodeAgentSkillArchive(await makeTar([
      { path: 'Assets/first.txt', content: 'first' },
      { path: 'assets/second.txt', content: 'second' },
    ]), 'tar.gz')).rejects.toThrow('portable path collision')

    await expect(decodeAgentSkillArchive(await makeTar([
      { path: 'SKILL.md', content: '', type: 'symlink', linkname: '/etc/passwd' },
    ]), 'tar.gz')).rejects.toThrow('non-regular entry')

    await expect(decodeAgentSkillArchive(await makeTar(
      Array.from({ length: 257 }, (_, index) => ({ path: `file-${index}`, content: '' })),
    ), 'tar.gz')).rejects.toThrow('file count')
  })
})

interface ArchiveFixture {
  readonly path: string
  readonly content: string
  readonly executable?: boolean
  readonly type?: 'file' | 'symlink'
  readonly linkname?: string
}

async function makeArchive(
  format: AgentSkillArchiveFormat,
  files: readonly ArchiveFixture[],
): Promise<Buffer> {
  return format === 'tar.gz' ? makeTar(files) : makeZip(files)
}

async function makeTar(files: readonly ArchiveFixture[]): Promise<Buffer> {
  const archive = pack()
  const output = collect(archive)
  for (const file of files) {
    await new Promise<void>((resolve, reject) => {
      archive.entry({
        name: file.path,
        type: file.type ?? 'file',
        mode: file.executable ? 0o755 : 0o644,
        ...(file.linkname === undefined ? {} : { linkname: file.linkname }),
      }, file.content, error => error === null ? resolve() : reject(error))
    })
  }
  archive.finalize()
  return gzipSync(await output)
}

async function makeZip(files: readonly ArchiveFixture[]): Promise<Buffer> {
  const archive = new ZipFile()
  const output = collect(archive.outputStream)
  for (const file of files) {
    archive.addBuffer(Buffer.from(file.content), file.path, {
      mode: file.executable ? 0o100755 : 0o100644,
    })
  }
  archive.end()
  return output
}

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

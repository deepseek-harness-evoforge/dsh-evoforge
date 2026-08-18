import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { pack } from 'tar-stream'
import { ZipFile } from 'yazl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CapabilityGap } from '../src/capability-gap-store.ts'
import {
  TrustedSkillDiscovery,
  type DiscoveredSkillCandidateInput,
  type SkillDiscoveryStore,
} from '../src/trusted-skill-discovery.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const SCHEMA = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json'
const temporaryRoots: string[] = []
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error === undefined ? resolve() : reject(error))
  })))
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('Agent Skills well-known index discovery', () => {
  it('finds, verifies, and durably quarantines one semantic skill-md candidate', async () => {
    const skill = [
      '---',
      'name: release-native-extension',
      'description: Publish and verify a native extension release.',
      'license: MIT',
      'allowed-tools: Read',
      '---',
      '',
      'Follow the bounded release checks.',
      '',
    ].join('\n')
    const artifactDigest = sha256(skill)
    let index = ''
    const endpoint = await serve((path) => {
      if (path === '/.well-known/agent-skills/index.json') {
        return { type: 'application/json', body: index }
      }
      if (path === '/skills/release-native-extension/SKILL.md') {
        return { type: 'text/markdown', body: skill }
      }
      return undefined
    })
    index = JSON.stringify({
      $schema: SCHEMA,
      skills: [
        {
          name: 'summarize-document',
          type: 'skill-md',
          description: 'Summarize a document into concise notes.',
          url: '/skills/summarize-document/SKILL.md',
          digest: `sha256:${'1'.repeat(64)}`,
        },
        {
          name: 'release-native-extension',
          type: 'skill-md',
          description: 'Publish and verify a native extension release.',
          url: '/skills/release-native-extension/SKILL.md',
          digest: `sha256:${artifactDigest}`,
        },
      ],
    })
    const store = fakeStore()
    const discovery = new TrustedSkillDiscovery([], store, {
      now: () => 1_786_896_100_000,
      agentSkillIndexes: [{
        id: 'public-agent-skills',
        indexUrl: `${endpoint.origin}/.well-known/agent-skills/index.json`,
      }],
    })

    await expect(discovery.discover(gap())).resolves.toEqual({
      status: 'candidate-found',
      candidateCount: 1,
    })

    const input = store.recordCandidate.mock.calls[0]?.[0]
    expect(input).toMatchObject({
      requestedSkill: 'release-native-extension',
      description: 'Publish and verify a native extension release.',
      match: {
        kind: 'deterministic-lexical-v1',
        requestedSkill: 'missing-release-skill',
        score: expect.any(Number),
        runnerUpScore: 0,
        queryHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      source: {
        id: 'public-agent-skills',
        kind: 'agent-skills-index',
        trust: 'explicit-deployer-config',
        origin: endpoint.origin,
      },
      version: {
        kind: 'agent-skills-index-v0.2',
        indexDigest: sha256(index),
        artifactDigest,
        treeHash: skillTreeHash(skill),
      },
      contentHash: artifactDigest,
      package: {
        path: 'release-native-extension/SKILL.md',
        fileCount: 1,
        totalBytes: Buffer.byteLength(skill),
        hasScripts: false,
        hasReferences: false,
      },
      permissions: {
        declared: true,
        executableContent: false,
        externalEffects: 'unknown',
      },
      license: { status: 'declared', value: 'MIT' },
      safety: {
        status: 'quarantined',
        checks: [
          { name: 'artifact-digest-integrity', status: 'passed' },
          { name: 'regular-files-only', status: 'passed' },
          { name: 'skill-identity', status: 'passed' },
          { name: 'effect-review', status: 'required' },
        ],
      },
      artifact: { kind: 'skill-md', content: skill },
      lifecycle: 'inactive',
      verification: 'unevaluated',
      execution: 'never',
    })
    expect(store.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({
      reasons: [],
      sources: [{
        id: 'public-agent-skills',
        status: 'candidate',
        revision: sha256(index),
      }],
    }))

    const outputParent = await mkdtemp(join(tmpdir(), 'dsh-evolve-agent-index-'))
    temporaryRoots.push(outputParent)
    const candidate = {
      ...input!,
      schemaVersion: 1 as const,
      id: discoveredCandidateId(input!),
    }
    const beforeMaterialize = endpoint.requests.length
    const materialized = await discovery.materialize(candidate, join(outputParent, 'candidate'))
    expect(materialized).toMatchObject({
      candidateId: candidate.id,
      contentHash: artifactDigest,
      treeHash: skillTreeHash(skill),
      files: [{ path: 'SKILL.md', mode: '100644', size: Buffer.byteLength(skill) }],
    })
    expect(await readFile(join(materialized.path, 'SKILL.md'), 'utf8')).toBe(skill)
    expect(endpoint.requests).toHaveLength(beforeMaterialize)
  })

  it('verifies, safely expands, and privately persists one whole archive candidate', async () => {
    const skill = [
      '---',
      'name: missing-release-skill',
      'description: Release safely with packaged evidence.',
      'license: Apache-2.0',
      '---',
      '',
      'Read references/checks.md. Never run scripts by default.',
      '',
    ].join('\n')
    const files = [
      { path: 'SKILL.md', content: skill, mode: '100644' as const },
      { path: 'references/checks.md', content: 'Verify the exact artifact digest.\n', mode: '100644' as const },
      { path: 'scripts/verify.sh', content: '#!/bin/sh\nexit 0\n', mode: '100755' as const },
    ]
    const archive = await makeTarGzip(files)
    const artifactDigest = sha256(archive)
    let index = ''
    const endpoint = await serve((path) => {
      if (path.endsWith('index.json')) return { type: 'application/json', body: index }
      if (path.endsWith('.tar.gz')) return { type: 'application/gzip', body: archive }
      return undefined
    })
    index = JSON.stringify({
      $schema: SCHEMA,
      skills: [{
        name: 'missing-release-skill',
        type: 'archive',
        description: 'Release safely with packaged evidence.',
        url: '/skills/missing-release-skill.tar.gz',
        digest: `sha256:${artifactDigest}`,
      }],
    })
    const store = fakeStore()
    const discovery = new TrustedSkillDiscovery([], store, {
      agentSkillIndexes: [{ id: 'archive-test', indexUrl: `${endpoint.origin}/.well-known/agent-skills/index.json` }],
    })

    await expect(discovery.discover(gap())).resolves.toEqual({
      status: 'candidate-found',
      candidateCount: 1,
    })
    const input = store.recordCandidate.mock.calls[0]?.[0]
    expect(input).toMatchObject({
      requestedSkill: 'missing-release-skill',
      description: 'Release safely with packaged evidence.',
      distribution: { kind: 'archive', format: 'tar.gz' },
      version: {
        kind: 'agent-skills-index-v0.2',
        artifactDigest,
        treeHash: archiveTreeHash(files),
      },
      contentHash: artifactDigest,
      package: {
        path: 'missing-release-skill',
        fileCount: 3,
        totalBytes: files.reduce((total, file) => total + Buffer.byteLength(file.content), 0),
        hasScripts: true,
        hasReferences: true,
      },
      permissions: {
        declared: false,
        executableContent: true,
        externalEffects: 'unknown',
      },
      license: { status: 'declared', value: 'Apache-2.0' },
      artifact: {
        kind: 'archive',
        format: 'tar.gz',
        contentBase64: archive.toString('base64'),
      },
      lifecycle: 'inactive',
      verification: 'unevaluated',
      execution: 'never',
    })

    const outputParent = await mkdtemp(join(tmpdir(), 'dsh-evolve-agent-archive-'))
    temporaryRoots.push(outputParent)
    const candidate = {
      ...input!,
      schemaVersion: 1 as const,
      id: discoveredCandidateId(input!),
    }
    const beforeMaterialize = endpoint.requests.length
    const materialized = await discovery.materialize(candidate, join(outputParent, 'candidate'))
    expect(materialized).toMatchObject({
      candidateId: candidate.id,
      contentHash: artifactDigest,
      treeHash: archiveTreeHash(files),
      files: files.map(file => ({
        path: file.path,
        mode: file.mode,
        size: Buffer.byteLength(file.content),
      })).sort((left, right) => left.path.localeCompare(right.path)),
    })
    expect(await readFile(join(materialized.path, 'SKILL.md'), 'utf8')).toBe(skill)
    expect(await readFile(join(materialized.path, 'references/checks.md'), 'utf8'))
      .toBe('Verify the exact artifact digest.\n')
    expect(endpoint.requests).toHaveLength(beforeMaterialize)
  })

  it('falls back to a zip URL extension for a generic archive media type', async () => {
    const skill = '---\nname: missing-release-skill\ndescription: Release safely from zip.\n---\n\nRead references/checks.md.\n'
    const files = [
      { path: 'SKILL.md', content: skill, mode: '100644' as const },
      { path: 'references/checks.md', content: 'Check it.\n', mode: '100644' as const },
    ]
    const archive = await makeZip(files)
    let index = ''
    const endpoint = await serve(path => path.endsWith('index.json')
      ? { type: 'application/json', body: index }
      : { type: 'application/octet-stream', body: archive })
    index = JSON.stringify({
      $schema: SCHEMA,
      skills: [{
        name: 'missing-release-skill',
        type: 'archive',
        description: 'Release safely from zip.',
        url: '/skills/missing-release-skill.zip',
        digest: `sha256:${sha256(archive)}`,
      }],
    })
    const store = fakeStore()
    const discovery = new TrustedSkillDiscovery([], store, {
      agentSkillIndexes: [{ id: 'zip-fallback', indexUrl: `${endpoint.origin}/.well-known/agent-skills/index.json` }],
    })

    await expect(discovery.discover(gap())).resolves.toEqual({
      status: 'candidate-found',
      candidateCount: 1,
    })
    expect(store.recordCandidate.mock.calls[0]?.[0]).toMatchObject({
      distribution: { kind: 'archive', format: 'zip' },
      version: { treeHash: archiveTreeHash(files) },
      package: { fileCount: 2, hasReferences: true },
      artifact: { kind: 'archive', format: 'zip', contentBase64: archive.toString('base64') },
    })
  })

  it('rejects a digest mismatch and never records a candidate', async () => {
    const skill = '---\nname: missing-release-skill\ndescription: Release safely.\n---\n\nDo it.\n'
    let index = ''
    const endpoint = await serve(path => path.endsWith('index.json')
      ? { type: 'application/json', body: index }
      : { type: 'text/markdown', body: skill })
    index = JSON.stringify({
      $schema: SCHEMA,
      skills: [{
        name: 'missing-release-skill',
        type: 'skill-md',
        description: 'Release safely.',
        url: '/skills/missing-release-skill/SKILL.md',
        digest: `sha256:${'0'.repeat(64)}`,
      }],
    })
    const store = fakeStore()
    const discovery = new TrustedSkillDiscovery([], store, {
      agentSkillIndexes: [{ id: 'digest-test', indexUrl: `${endpoint.origin}/.well-known/agent-skills/index.json` }],
    })

    await expect(discovery.discover(gap())).resolves.toEqual({
      status: 'abstained',
      candidateCount: 0,
      reasons: ['artifact-digest-mismatch'],
    })
    expect(store.recordCandidate).not.toHaveBeenCalled()
    expect(store.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({
      sources: [{ id: 'digest-test', status: 'digest-mismatch', revision: sha256(index) }],
    }))
  })

  it('checks archive digests before decoding and rejects a verified unsafe archive', async () => {
    let artifact: Buffer<ArrayBufferLike> = Buffer.from('not an archive')
    let index = ''
    const endpoint = await serve(path => path.endsWith('index.json')
      ? { type: 'application/json', body: index }
      : { type: 'application/gzip', body: artifact })
    const store = fakeStore()
    const discovery = new TrustedSkillDiscovery([], store, {
      agentSkillIndexes: [{ id: 'archive-safety', indexUrl: `${endpoint.origin}/.well-known/agent-skills/index.json` }],
    })
    index = JSON.stringify({
      $schema: SCHEMA,
      skills: [{
        name: 'missing-release-skill',
        type: 'archive',
        description: 'Release safely.',
        url: '/skills/missing-release-skill.tar.gz',
        digest: `sha256:${'0'.repeat(64)}`,
      }],
    })

    await expect(discovery.discover(gap())).resolves.toEqual({
      status: 'abstained',
      candidateCount: 0,
      reasons: ['artifact-digest-mismatch'],
    })

    artifact = await makeTarGzip([{ path: '../escape', content: 'bad', mode: '100644' }])
    index = JSON.stringify({
      $schema: SCHEMA,
      skills: [{
        name: 'missing-release-skill',
        type: 'archive',
        description: 'Release safely.',
        url: '/skills/missing-release-skill.tar.gz',
        digest: `sha256:${sha256(artifact)}`,
      }],
    })
    await expect(discovery.discover(gap())).resolves.toEqual({
      status: 'abstained',
      candidateCount: 0,
      reasons: ['invalid-skill-package'],
    })
    expect(store.recordCandidate).not.toHaveBeenCalled()
  })

  it('rejects cross-origin artifacts without contacting their server', async () => {
    const attacker = await serve(() => ({ type: 'text/markdown', body: 'must not be fetched' }))
    let index = ''
    const endpoint = await serve(path => path.endsWith('index.json')
      ? { type: 'application/json', body: index }
      : undefined)
    index = JSON.stringify({
      $schema: SCHEMA,
      skills: [{
        name: 'missing-release-skill',
        type: 'skill-md',
        description: 'Release safely.',
        url: `${attacker.origin}/SKILL.md`,
        digest: `sha256:${'0'.repeat(64)}`,
      }],
    })
    const store = fakeStore()
    const discovery = new TrustedSkillDiscovery([], store, {
      agentSkillIndexes: [{ id: 'origin-test', indexUrl: `${endpoint.origin}/.well-known/agent-skills/index.json` }],
    })

    await expect(discovery.discover(gap())).resolves.toEqual({
      status: 'abstained',
      candidateCount: 0,
      reasons: ['untrusted-artifact-origin'],
    })
    expect(attacker.requests).toEqual([])
  })

  it('fails closed on unknown schemas, artifact types, and non-loopback plain HTTP configuration', async () => {
    expect(() => new TrustedSkillDiscovery([], fakeStore(), {
      agentSkillIndexes: [{
        id: 'unsafe-http',
        indexUrl: 'http://example.com/.well-known/agent-skills/index.json',
      }],
    })).toThrow('must use HTTPS')

    let index = ''
    const endpoint = await serve(path => path.endsWith('index.json')
      ? { type: 'application/json', body: index }
      : undefined)
    const store = fakeStore()
    const discovery = new TrustedSkillDiscovery([], store, {
      agentSkillIndexes: [{ id: 'schema-test', indexUrl: `${endpoint.origin}/.well-known/agent-skills/index.json` }],
    })
    index = JSON.stringify({ $schema: 'https://example.com/future.json', skills: [] })
    await expect(discovery.discover(gap())).resolves.toEqual({
      status: 'abstained',
      candidateCount: 0,
      reasons: ['unsupported-index-schema'],
    })

    index = JSON.stringify({
      $schema: SCHEMA,
      skills: [{
        name: 'missing-release-skill',
        type: 'future-bundle',
        description: 'Release safely.',
        url: '/skills/missing-release-skill.tar.gz',
        digest: `sha256:${'0'.repeat(64)}`,
      }],
    })
    await expect(discovery.discover(gap())).resolves.toEqual({
      status: 'abstained',
      candidateCount: 0,
      reasons: ['unsupported-artifact-type'],
    })
  })
})

function fakeStore() {
  return {
    recordCandidate: vi.fn<SkillDiscoveryStore['recordCandidate']>(async input => ({
      created: true,
      candidate: { ...input, schemaVersion: 1, id: discoveredCandidateId(input) } as never,
    })),
    recordAttempt: vi.fn<SkillDiscoveryStore['recordAttempt']>(async input => ({
      created: true,
      attempt: { ...input, schemaVersion: 1, id: 'd'.repeat(64) } as never,
    })),
    listCandidates: vi.fn(() => []),
    listAttempts: vi.fn(() => []),
    close: vi.fn(),
  }
}

function discoveredCandidateId(input: DiscoveredSkillCandidateInput): string {
  const versionIdentity = input.version.kind === 'git-tree'
    ? [input.version.commit, input.version.treeHash]
    : input.version.kind === 'agent-skills-index-v0.2'
      ? [input.version.indexDigest, input.version.artifactDigest, input.version.treeHash]
      : [
          input.version.modelIdentityHash,
          input.version.inputDigest,
          input.version.artifactDigest,
          input.version.treeHash,
        ]
  return createHash('sha256').update(JSON.stringify([
    input.workspaceId,
    input.gapId,
    input.source.id,
    ...versionIdentity,
    input.contentHash,
  ])).digest('hex')
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function skillTreeHash(skill: string): string {
  return createHash('sha256').update('SKILL.md').update('\0').update(skill).update('\0').digest('hex')
}

function gap(): CapabilityGap {
  return {
    schemaVersion: 1,
    id: '5'.repeat(64),
    observedAt: 1_786_896_000_000,
    workspaceId: WORKSPACE_ID,
    sessionId: 'session-1',
    requestedSkill: 'missing-release-skill',
    catalogHash: '6'.repeat(64),
    catalogSize: 3,
    goal: {
      id: 'goal-1',
      revision: 3,
      objective: 'Publish a verified native DSH plugin.',
    },
    status: 'confirmed',
    evidence: {
      kind: 'native-skill-miss',
      catalog: 'complete',
      routing: 'requested-skill-absent',
      providers: 'settled',
    },
  }
}

async function serve(
  route: (path: string) => { readonly type: string; readonly body: string | Buffer } | undefined,
): Promise<{ readonly origin: string; readonly requests: string[] }> {
  const requests: string[] = []
  const server = createServer((request, response) => {
    const path = request.url ?? '/'
    requests.push(path)
    const found = route(path)
    if (found === undefined) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': found.type })
    response.end(found.body)
  })
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('test server has no TCP address')
  return { origin: `http://127.0.0.1:${address.port}`, requests }
}

async function makeTarGzip(
  files: readonly { readonly path: string; readonly content: string; readonly mode: '100644' | '100755' }[],
): Promise<Buffer> {
  const archive = pack()
  const output = collect(archive)
  for (const file of files) {
    await new Promise<void>((resolve, reject) => {
      archive.entry({
        name: file.path,
        type: 'file',
        mode: file.mode === '100755' ? 0o755 : 0o644,
      }, file.content, error => error === null ? resolve() : reject(error))
    })
  }
  archive.finalize()
  return gzipSync(await output)
}

async function makeZip(
  files: readonly { readonly path: string; readonly content: string; readonly mode: '100644' | '100755' }[],
): Promise<Buffer> {
  const archive = new ZipFile()
  const output = collect(archive.outputStream)
  for (const file of files) {
    archive.addBuffer(Buffer.from(file.content), file.path, {
      mode: file.mode === '100755' ? 0o100755 : 0o100644,
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

function archiveTreeHash(
  files: readonly { readonly path: string; readonly content: string }[],
): string {
  const hash = createHash('sha256')
  for (const file of [...files].sort((left, right) => comparePaths(left.path, right.path))) {
    hash.update(file.path).update('\0').update(file.content).update('\0')
  }
  return hash.digest('hex')
}

function comparePaths(left: string, right: string): number {
  const leftParts = left.split('/')
  const rightParts = right.split('/')
  for (let index = 0; index < Math.min(leftParts.length, rightParts.length); index += 1) {
    const order = leftParts[index]!.localeCompare(rightParts[index]!)
    if (order !== 0) return order
  }
  return leftParts.length - rightParts.length
}

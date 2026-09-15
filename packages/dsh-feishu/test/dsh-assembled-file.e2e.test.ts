import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it, vi } from 'vitest'
import { sessionEvents } from 'dsh-evoforge-gateway'
import { bootLatestDshProfile } from './latest-dsh-test-runtime.ts'

const packageRoot = resolve(import.meta.dirname, '..')
const source = process.env.DSH_EVOLVE_DSH_SOURCE_DIR

// Explicit current-core acceptance. The supported image-only alpha.5 cohort cannot enable this feature.
it.skipIf(process.env.DSH_FEISHU_TEST_NATIVE_FILES !== '1').each(['approve', 'reject', 'wrong-user'] as const)(
  'runs native file delivery through a real DSH Agent, Approval and durable Gateway receipt: %s', async mode => {
  if (source === undefined) throw new Error('Set DSH_EVOLVE_DSH_SOURCE_DIR to the audited native-file Host')
  const root = await mkdtemp(join(tmpdir(), 'feishu-native-file-'))
  const home = join(root, '.dsh-home')
  const original = Buffer.from('Approved native file\n固定的文件验收内容\n')
  const expectedDigest = createHash('sha256').update(original).digest('hex')
  const presets = join(root, 'presets')
  await mkdir(join(presets, 'file-test'), { recursive: true })
  await writeFile(join(presets, 'file-test', 'preset.yml'), 'name: File Test\n')
  await writeFile(join(presets, 'file-test', 'agent.cordis.yml'), '[]\n')
  await writeFile(join(root, 'result.txt'), original)
  const configPath = join(root, 'cordis.json')
  const entry = (path: string) => join(source, path, 'lib/index.js')
  const config = [
    { id: 'file-llm', name: join(packageRoot, 'test/fixtures/content-llm.ts'), config: { fileMode: true } },
    { id: 'base', config: { patches: [
      { id: 'llm-deepseek', disabled: true },
      { id: 'agent-loop', config: { agents: [], workspaceContext: false, dshHome: home,
        skills: { filesystem: { agentsHome: join(root, '.agents') } },
        invariants: { package_blocklist: ['^@deepseek-ai/dsh-scope$'] }, persona: 'Keyless native file acceptance.' } },
      { id: 'session-persistence-jsonl', config: { root: join(root, 'sessions'), compression: 'none' } },
      { id: 'session-checkpoint-policy', disabled: true },
    ] } },
    { id: 'storage', name: entry('packages/storage/storage') },
    { id: 'storage-json', name: entry('packages/storage/storage-json'), config: { root: join(root, 'storage') } },
    { id: 'storage-domain', name: entry('packages/storage/storage-domain'), config: { backend: 'json' } },
    { id: 'attachment-local', name: entry('packages/attachment/attachment-local'), config: { dshHome: home } },
    { id: 'approval', name: entry('packages/interaction/user-approval') },
    { id: 'commands', name: entry('packages/interaction/commands') },
    { id: 'agent-presets', name: entry('packages/preset/agent-presets'),
      config: { default: 'file-test', roots: [{ path: presets, trust: 'system' }], includeUserRoot: false } },
    { id: 'workspace', name: entry('packages/workspace/workspace') },
    { id: 'gateway-bootstrap', name: join(packageRoot, 'test/fixtures/gateway-bootstrap.ts'), config: {
      gatewayEntry: pathToFileURL(join(packageRoot, '../dsh-gateway/dist/index.mjs')).href,
      workspacePath: root, routeId: 'file-route', accountId: 'cli_file_app', conversationId: 'oc_file', userId: 'ou_file',
      sessionId: 'main', agentPreset: 'file-test', provider: 'feishu-content-mock', model: 'feishu-content-mock',
    } },
    { id: 'feishu-runtime', name: join(packageRoot, 'test/fixtures/runtime-bootstrap.ts'), config: {
      feishuEntry: pathToFileURL(join(packageRoot, 'dist/index.mjs')).href,
      routeIds: ['file-route'], appIdEnv: 'DSH_FEISHU_FILE_TEST_ID', appSecretEnv: 'DSH_FEISHU_FILE_TEST_SECRET', fileDeliveryEnabled: true,
    } },
  ]
  await writeFile(configPath, JSON.stringify(config))
  vi.stubEnv('DSH_FEISHU_FILE_TEST_ID', 'cli_file_app')
  vi.stubEnv('DSH_FEISHU_FILE_TEST_SECRET', 'test-secret')
  vi.stubEnv('DSH_HOME', home)
  vi.stubEnv('DSH_AGENTS_HOME', join(root, '.agents'))
  vi.stubEnv('DSH_TELEMETRY_DISABLED', '1')
  const oldCwd = process.cwd()
  process.chdir(root)
  let ctx: any
  try {
    ctx = await bootLatestDshProfile({ binName: 'feishu-file-test', configPath, dshSourceDir: source, home })
    const { platform, runtime } = ctx.get('evoforge.feishuTest')
    const agent = ctx.agents.get('main')
    expect(ctx.tools.get('feishu_file_send', agent)).toBeDefined()
    await platform.emitMessage({ messageId: 'om_file_test', chatId: 'oc_file', chatType: 'p2p', senderId: 'ou_file',
      content: '把 result.txt 作为文件发给我。', rawContentType: 'text', resources: [] })
    await vi.waitFor(() => expect(platform.cards).toHaveLength(1), { timeout: 10_000 })
    expect(platform.files).toHaveLength(0)
    expect(JSON.stringify(platform.cards[0].card)).toContain(expectedDigest)
    // The approval applies to the stored snapshot, not bytes reread from a mutable path later.
    await writeFile(join(root, 'result.txt'), 'changed while approval was pending')
    const card = platform.cards[0]
    const value = card.card.body.elements[1].actions[mode === 'reject' ? 1 : 0].value
    if (mode === 'wrong-user') {
      await platform.emitApproval({ messageId: card.messageId, chatId: 'oc_file', operatorId: 'untrusted-user', value })
      expect(platform.files).toHaveLength(0)
      expect(sessionEvents(agent.session).some(event => event.type === 'approval/decided')).toBe(false)
    }
    await platform.emitApproval({ messageId: card.messageId, chatId: 'oc_file', operatorId: 'ou_file', value })
    if (mode === 'reject') {
      await vi.waitFor(() => expect(platform.texts.at(-1)?.text).toContain('Native Approval did not allow'), { timeout: 10_000 })
      expect(platform.files).toHaveLength(0)
      expect(sessionEvents(agent.session).some(event => event.type === 'approval/decided' && event.data.outcome === 'rejected')).toBe(true)
      await expect(readFile(join(root, 'storage/evoforge_gateway_file_outbound.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      await runtime.dispose()
      expect(ctx.tools.get('feishu_file_send', agent)).toBeUndefined()
      return
    }
    await vi.waitFor(() => expect(platform.texts.at(-1)?.text).toContain('"status":"delivered"'), { timeout: 10_000 })
    expect(platform.files).toHaveLength(1)
    expect(platform.files[0].snapshot).toEqual({ name: 'result.txt', data: original, sha256: expectedDigest })
    const events = sessionEvents(agent.session)
    expect(events.some(event => event.type === 'approval/decided' && event.data.outcome === 'allowed-once')).toBe(true)
    expect(events.some(event => event.type === 'tool/result'
      && event.data.message.content.some(block => block.content.some(item => item.type === 'text'
        && item.text.includes('"status":"delivered"'))))).toBe(true)
    const stored = JSON.parse(await readFile(join(root, 'storage/evoforge_gateway_file_outbound.json'), 'utf8'))
    expect(Object.values(stored.tables.files)).toEqual([expect.objectContaining({
      status: 'delivered', attempts: 1, file: { attachmentId: `sha256:${expectedDigest}`, bytes: original.length, name: 'result.txt' },
    })])
    const llm = ctx.get('evoforge.feishuContentLlm')
    const requests = llm.requests.filter((request: { tools?: unknown[] }) => request.tools !== undefined)
    expect(requests.length).toBeGreaterThanOrEqual(2)
    for (const request of requests) expect(request.tools).toEqual(requests[0].tools)
    await runtime.dispose()
    expect(ctx.tools.get('feishu_file_send', agent)).toBeUndefined()
  } finally {
    try { await ctx?.fiber.dispose() } finally {
      process.chdir(oldCwd)
      vi.unstubAllEnvs()
      await rm(root, { recursive: true, force: true })
    }
  }
}, 40_000)

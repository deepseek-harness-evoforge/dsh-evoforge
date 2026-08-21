import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  FeishuApprovalAction,
  FeishuContentReadRequest,
  FeishuContentReadResult,
  FeishuInboundMessage,
  FeishuSendOptions,
} from '../src/index.js'
import type { FeishuRuntime } from '../src/runtime.js'

const execFile = promisify(execFileCallback)
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const gatewayRoot = resolve(packageRoot, '../dsh-gateway')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR ?? resolve(suiteRoot, '../deepseek-harness')
const temporaryRoots: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform !== 'darwin')('DSH assembled Feishu content', () => {
  it('keeps one scoped schema stable and reads only after exact native Approval', async () => {
    await execFile('pnpm', ['run', 'build'], { cwd: packageRoot, encoding: 'utf8', timeout: 30_000 })
    const root = await mkdtemp(join(tmpdir(), 'dsh-feishu-content-'))
    temporaryRoots.push(root)
    const presetRoot = join(root, 'agent-presets')
    await mkdir(join(presetRoot, 'feishu-content'), { recursive: true })
    await writeFile(join(presetRoot, 'feishu-content', 'preset.yml'), 'name: Feishu Content\n')
    await writeFile(join(presetRoot, 'feishu-content', 'agent.cordis.yml'), '[]\n')
    const config = join(root, 'cordis.yml')
    await writeFile(config, JSON.stringify(hostConfig(root, presetRoot), null, 2))
    vi.stubEnv('DSH_FEISHU_CONTENT_APP_ID', 'cli_content_app')
    vi.stubEnv('DSH_FEISHU_CONTENT_APP_SECRET', 'test-secret')
    vi.stubEnv('DSH_AGENTS_HOME', join(root, '.agents-home'))
    vi.stubEnv('DSH_HOME', join(root, '.dsh-home'))
    vi.stubEnv('DSH_TELEMETRY_DISABLED', '1')

    const { boot } = await import(pathToFileURL(
      join(dshSourceDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js'),
    ).href)
    const previousCwd = process.cwd()
    process.chdir(root)
    const ctx = await boot('dsh-feishu-content-test', config)
    const service = ctx.get('evoforge.feishuTest') as {
      platform: {
        cards: Array<{ messageId: string; chatId: string; card: object; options?: FeishuSendOptions }>
        texts: Array<{ chatId: string; text: string; options?: FeishuSendOptions }>
        contentReads: FeishuContentReadRequest[]
        emitMessage(message: FeishuInboundMessage): Promise<void>
        emitApproval(action: FeishuApprovalAction): Promise<void>
        setContent(kind: FeishuContentReadRequest['kind'], token: string, value: FeishuContentReadResult): void
      }
      runtime: FeishuRuntime
    } | undefined
    if (service === undefined) throw new Error('Feishu content runtime did not load')
    try {
      const agent = ctx.agents.get('main')
      if (agent === undefined) throw new Error('Feishu content Agent did not load')
      expect(ctx.tools.get('feishu_content_read', agent)).toBeDefined()
      expect(ctx.tools.get('feishu_content_read')).toBeUndefined()
      expect(service.runtime.healthSnapshot()).toMatchObject({
        schemaVersion: 2,
        content: {
          status: 'ready',
          enabledCount: 1,
          toolAvailable: true,
          approvalAvailable: true,
          platformAccess: 'not-verified',
          permissions: [
            { name: 'document-read', enabled: true },
            { name: 'wiki-read', enabled: false },
            { name: 'drive-metadata-read', enabled: false },
            { name: 'bitable-records-read', enabled: false },
          ],
        },
        modelCalls: 0,
      })
      service.platform.setContent('document', 'doxcnApproved123', {
        schemaVersion: 1,
        kind: 'document',
        title: 'Approved Design',
        objectType: 'docx',
        contentFormat: 'text/plain',
        content: 'private assembled content',
        truncated: false,
      })

      await service.platform.emitMessage(message())
      await vi.waitFor(() => expect(service.platform.cards).toHaveLength(1), { timeout: 10_000, interval: 20 })
      expect(service.platform.contentReads).toHaveLength(0)
      const card = service.platform.cards[0]!
      const value = (card.card as {
        body?: { elements?: Array<{ actions?: Array<{ value?: unknown }> }> }
      }).body?.elements?.[1]?.actions?.[0]?.value
      await service.platform.emitApproval({
        messageId: card.messageId,
        chatId: 'oc_content',
        operatorId: 'ou_content',
        value,
      })
      await vi.waitFor(() => {
        expect(service.platform.texts.at(-1)?.text).toContain('private assembled content')
      }, { timeout: 10_000, interval: 20 })
      expect(service.platform.contentReads).toEqual([expect.objectContaining({
        kind: 'document', token: 'doxcnApproved123', maxContentChars: 20_000,
      })])

      const events = agent.session.events as readonly SessionEvent[]
      expect(events.some(event => event.type === 'approval/asked'
        && event.data.toolName === 'feishu_content_read')).toBe(true)
      expect(events.some(event => event.type === 'approval/decided'
        && event.data.outcome === 'allowed-once')).toBe(true)
      expect(events.some(event => event.type === 'tool/call'
        && event.data.name === 'feishu_content_read')).toBe(true)
      expect(events.some(event => event.type === 'tool/result'
        && event.data.message.content.some(block => block.content.some(item => item.type === 'text'
          && item.text.includes('private assembled content'))))).toBe(true)

      const llm = ctx.get('evoforge.feishuContentLlm') as {
        requests: Array<{ tools?: readonly unknown[]; system?: string }>
      }
      expect(llm.requests).toHaveLength(2)
      expect(llm.requests[0]?.tools).toEqual(llm.requests[1]?.tools)
      expect(llm.requests[0]?.tools?.filter((tool: unknown) =>
        typeof tool === 'object' && tool !== null && (tool as { name?: unknown }).name === 'feishu_content_read')).toHaveLength(1)
      expect(JSON.stringify(llm.requests)).not.toContain('test-secret')

      await service.runtime.dispose()
      expect(ctx.tools.get('feishu_content_read', agent)).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
      process.chdir(previousCwd)
    }
  }, 40_000)
})

function hostConfig(root: string, presetRoot: string): unknown[] {
  return [
    {
      id: 'feishu-content-llm',
      name: join(packageRoot, 'test', 'fixtures', 'content-llm.ts'),
    },
    {
      id: 'base',
      name: join(dshSourceDir, 'vendor', 'include', 'lib', 'index.js'),
      config: {
        path: join(dshSourceDir, 'examples', 'headless-agent', 'cordis.yml'),
        patches: [
          { id: 'llm-deepseek', name: '@deepseek-ai/dsh-llm-deepseek', disabled: true },
          {
            id: 'agent-spine',
            name: '@deepseek-ai/dsh-agent-spine-demo',
            config: {
              agents: [], workspaceContext: false, dshHome: join(root, '.dsh-home'),
              skills: { filesystem: { agentsHome: join(root, '.agents-home') } },
              invariants: { package_blocklist: ['^@deepseek-ai/dsh-scope$'] },
              persona: 'Keyless Feishu content assembled smoke.',
            },
          },
          {
            id: 'persistence', name: '@deepseek-ai/dsh-session-persistence-jsonl',
            config: { root: join(root, 'sessions'), compression: 'none' },
          },
          { id: 'checkpoint-policy', name: '@deepseek-ai/dsh-session-checkpoint-policy', disabled: true },
        ],
      },
    },
    { id: 'storage', name: join(dshSourceDir, 'packages', 'storage', 'storage', 'lib', 'index.js') },
    {
      id: 'storage-json', name: join(dshSourceDir, 'packages', 'storage', 'storage-json', 'lib', 'index.js'),
      config: { root: join(root, 'storage') },
    },
    {
      id: 'storage-domain', name: join(dshSourceDir, 'packages', 'storage', 'storage-domain', 'lib', 'index.js'),
      config: { backend: 'json' },
    },
    {
      id: 'attachment-local', name: join(dshSourceDir, 'packages', 'attachment', 'attachment-local', 'lib', 'index.js'),
      config: { dshHome: join(root, '.dsh-home') },
    },
    {
      id: 'approval',
      name: join(dshSourceDir, 'packages', 'interaction', 'user-approval', 'lib', 'index.js'),
    },
    { id: 'commands', name: join(dshSourceDir, 'packages', 'interaction', 'commands', 'lib', 'index.js') },
    {
      id: 'agent-presets', name: join(dshSourceDir, 'packages', 'preset', 'agent-presets', 'lib', 'index.js'),
      config: { default: 'feishu-content', roots: [{ path: presetRoot, trust: 'system' }], includeUserRoot: false },
    },
    { id: 'workspace', name: join(dshSourceDir, 'packages', 'workspace', 'workspace', 'lib', 'index.js') },
    {
      id: 'gateway-bootstrap', name: join(packageRoot, 'test', 'fixtures', 'gateway-bootstrap.ts'),
      config: {
        gatewayEntry: pathToFileURL(join(gatewayRoot, 'dist', 'index.mjs')).href,
        workspacePath: root, routeId: 'feishu-content', accountId: 'cli_content_app',
        conversationId: 'oc_content', userId: 'ou_content', sessionId: 'main',
        agentPreset: 'feishu-content', provider: 'feishu-content-mock', model: 'feishu-content-mock',
      },
    },
    {
      id: 'feishu-runtime', name: join(packageRoot, 'test', 'fixtures', 'runtime-bootstrap.ts'),
      config: {
        feishuEntry: pathToFileURL(join(packageRoot, 'dist', 'index.mjs')).href,
        routeIds: ['feishu-content'], appIdEnv: 'DSH_FEISHU_CONTENT_APP_ID',
        appSecretEnv: 'DSH_FEISHU_CONTENT_APP_SECRET', contentPermissions: ['document-read'],
      },
    },
  ]
}

function message(): FeishuInboundMessage {
  return Object.freeze({
    messageId: 'om_content', chatId: 'oc_content', chatType: 'p2p', senderId: 'ou_content',
    content: '读取这个飞书文档并总结', rawContentType: 'text', resources: [],
  })
}

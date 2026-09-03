import type { Agent } from '@deepseek-ai/dsh-agent'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { defineTool, type PreToolDecision } from '@deepseek-ai/dsh-tools'
import type { FeishuContentPermission } from './config.js'

export const FEISHU_CONTENT_TOOL = 'feishu_content_read'

export type FeishuContentKind = 'document' | 'wiki' | 'drive' | 'bitable'
export type FeishuDriveType = 'doc' | 'docx' | 'sheet' | 'bitable' | 'mindnote' | 'file'
  | 'wiki' | 'folder' | 'synced_block' | 'slides'

export interface FeishuContentReadRequest {
  readonly kind: FeishuContentKind
  readonly token: string
  readonly driveType?: FeishuDriveType
  readonly tableId?: string
  readonly pageSize?: number
  readonly maxContentChars: number
  readonly maxBitableRecords: number
}

export interface FeishuContentReadResult {
  readonly schemaVersion: 1
  readonly kind: FeishuContentKind
  readonly title?: string
  readonly objectType?: string
  readonly revision?: number
  readonly createdAt?: string
  readonly modifiedAt?: string
  readonly classification?: string
  readonly contentFormat?: 'text/plain' | 'application/json'
  readonly content?: string
  readonly returnedItems?: number
  readonly totalItems?: number
  readonly hasMore?: boolean
  readonly truncated: boolean
}

export interface FeishuContentReader {
  read(request: FeishuContentReadRequest, signal: AbortSignal): Promise<FeishuContentReadResult>
}

export interface FeishuContentPolicy {
  readonly permissions: ReadonlySet<FeishuContentPermission>
  readonly maxContentChars: number
  readonly maxBitableRecords: number
}

const KINDS = ['document', 'wiki', 'drive', 'bitable'] as const
const DRIVE_TYPES = [
  'doc', 'docx', 'sheet', 'bitable', 'mindnote', 'file', 'wiki', 'folder', 'synced_block', 'slides',
] as const

/** A prior request/header keeps the exact schema on resume; expansion starts only before a Session's first request. */
export function shouldInstallFeishuContentTool(
  agent: Agent,
  permissions: ReadonlySet<FeishuContentPermission>,
): boolean {
  const header = agent.session.requestHeader()
  if (header === undefined) return permissions.size > 0
  return header.tools?.some(tool => tool.name === FEISHU_CONTENT_TOOL) === true
}

/** Register one cache-stable, Agent-scoped read action plus native Approval policy. */
export function installFeishuContentTool(
  agent: Agent,
  policy: FeishuContentPolicy,
  reader: FeishuContentReader,
): () => void {
  const tool = defineTool({
    name: FEISHU_CONTENT_TOOL,
    description: 'Read one explicitly permitted Feishu document, Wiki node, Drive metadata object, or Bitable record page after native DSH approval.',
    parameters: {
      kind: {
        type: 'string', required: true, enum: [...KINDS],
        description: 'Feishu resource family: document, wiki, drive, or bitable.',
      },
      token_or_url: {
        type: 'string', required: true,
        description: 'Exact Feishu resource token or standard Feishu resource URL supplied in the Goal/materials.',
      },
      drive_type: {
        type: 'string', enum: [...DRIVE_TYPES],
        description: 'Required only for Drive metadata.',
      },
      table_id: {
        type: 'string',
        description: 'Optional Bitable table id; when present, read one bounded record page.',
      },
      page_size: {
        type: 'integer',
        description: 'Optional Bitable page size; deployment policy applies the final upper bound.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (exec.agent !== agent) {
        throw new HarnessError('Feishu content Tool is scoped to one exact Agent', 'FEISHU_CONTENT_AGENT_MISMATCH')
      }
      const permission = permissionFor(args.kind)
      if (!policy.permissions.has(permission)) {
        throw new HarnessError(
          `Feishu content permission ${permission} is disabled for this deployment`,
          'FEISHU_CONTENT_PERMISSION_DISABLED',
        )
      }
      const request = normalizeRequest(args, policy)
      try {
        const result = await reader.read(request, exec.signal)
        return result as unknown as JsonValue
      } catch (error: unknown) {
        exec.signal.throwIfAborted()
        throw new HarnessError(
          'Feishu content read failed; verify the App scope and exact resource access',
          'FEISHU_CONTENT_READ_FAILED',
          { cause: error },
        )
      }
    },
    presentCall: args => ({
      card: 'generic',
      title: `Read approved Feishu ${args.kind}`,
      kind: 'read',
      rawInput: { kind: args.kind },
    }),
  })

  const offTool = agent.ctx.tools.register(tool)
  const offPolicy = agent.ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (exec.name !== FEISHU_CONTENT_TOOL) return next()
    const kind = contentKind(exec.arguments)
    if (kind === undefined) return { kind: 'deny', reason: 'invalid Feishu content resource kind' }
    const permission = permissionFor(kind)
    if (!policy.permissions.has(permission)) {
      return { kind: 'deny', reason: `Feishu content permission ${permission} is disabled` }
    }
    return {
      kind: 'ask',
      reason: `Read one ${kind} resource into the current DSH Session and expose it to the configured model.`,
    }
  })
  const offGuard = agent.ctx.tools.guard((exec) => {
    if (exec.name !== FEISHU_CONTENT_TOOL) return undefined
    const kind = contentKind(exec.arguments)
    if (kind === undefined) return 'invalid Feishu content resource kind'
    const permission = permissionFor(kind)
    return policy.permissions.has(permission) ? undefined : `Feishu content permission ${permission} is disabled`
  })
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    offGuard()
    offPolicy()
    offTool()
  }
}

function normalizeRequest(
  args: {
    readonly kind: FeishuContentKind
    readonly token_or_url: string
    readonly drive_type?: FeishuDriveType
    readonly table_id?: string
    readonly page_size?: number
  },
  policy: FeishuContentPolicy,
): FeishuContentReadRequest {
  if (args.kind === 'drive' && args.drive_type === undefined) {
    throw new HarnessError('drive_type is required for a Drive metadata read', 'FEISHU_CONTENT_DRIVE_TYPE_REQUIRED')
  }
  if (args.kind !== 'drive' && args.drive_type !== undefined) {
    throw new HarnessError('drive_type is valid only for Drive metadata', 'FEISHU_CONTENT_DRIVE_TYPE_UNEXPECTED')
  }
  if (args.kind !== 'bitable' && (args.table_id !== undefined || args.page_size !== undefined)) {
    throw new HarnessError('table_id and page_size are valid only for Bitable', 'FEISHU_CONTENT_BITABLE_ARGS_UNEXPECTED')
  }
  if (args.page_size !== undefined
    && (!Number.isSafeInteger(args.page_size) || args.page_size < 1 || args.page_size > policy.maxBitableRecords)) {
    throw new HarnessError(
      `page_size must be an integer from 1 to ${policy.maxBitableRecords}`,
      'FEISHU_CONTENT_PAGE_SIZE_INVALID',
    )
  }
  const tableId = args.table_id === undefined ? undefined : exactIdentifier(args.table_id, 'table_id')
  return Object.freeze({
    kind: args.kind,
    token: resourceToken(args.token_or_url, args.kind),
    ...(args.drive_type === undefined ? {} : { driveType: args.drive_type }),
    ...(tableId === undefined ? {} : { tableId }),
    ...(args.page_size === undefined ? {} : { pageSize: args.page_size }),
    maxContentChars: policy.maxContentChars,
    maxBitableRecords: policy.maxBitableRecords,
  })
}

function resourceToken(value: string, kind: FeishuContentKind): string {
  if (value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new HarnessError('token_or_url must be an exact Feishu token or URL', 'FEISHU_CONTENT_TOKEN_INVALID')
  }
  if (/^[A-Za-z0-9_-]{4,256}$/u.test(value)) return value
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new HarnessError('token_or_url must be an exact Feishu token or URL', 'FEISHU_CONTENT_TOKEN_INVALID')
  }
  if (parsed.protocol !== 'https:' || !isFeishuHost(parsed.hostname)) {
    throw new HarnessError('token_or_url must use an official Feishu or Lark HTTPS host', 'FEISHU_CONTENT_URL_INVALID')
  }
  const segments = parsed.pathname.split('/').filter(Boolean)
  const markers = kind === 'document' ? ['docx'] : kind === 'wiki' ? ['wiki'] : kind === 'bitable'
    ? ['base', 'bitable'] : ['file', 'folder', 'docx', 'docs', 'sheets', 'base', 'mindnotes', 'slides']
  const marker = segments.findIndex(segment => markers.includes(segment))
  const token = marker < 0 ? undefined : segments[marker + 1]
  if (token === undefined || !/^[A-Za-z0-9_-]{4,256}$/u.test(token)) {
    throw new HarnessError('Feishu resource URL does not contain the expected token', 'FEISHU_CONTENT_URL_TOKEN_MISSING')
  }
  return token
}

function exactIdentifier(value: string, label: string): string {
  if (!/^[A-Za-z0-9_-]{4,256}$/u.test(value)) {
    throw new HarnessError(`${label} must be an exact Feishu identifier`, 'FEISHU_CONTENT_IDENTIFIER_INVALID')
  }
  return value
}

function isFeishuHost(hostname: string): boolean {
  const lower = hostname.toLowerCase()
  return lower === 'feishu.cn' || lower.endsWith('.feishu.cn')
    || lower === 'larksuite.com' || lower.endsWith('.larksuite.com')
}

function contentKind(value: unknown): FeishuContentKind | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const kind = (value as { kind?: unknown }).kind
  return KINDS.includes(kind as FeishuContentKind) ? kind as FeishuContentKind : undefined
}

function permissionFor(kind: FeishuContentKind): FeishuContentPermission {
  switch (kind) {
    case 'document': return 'document-read'
    case 'wiki': return 'wiki-read'
    case 'drive': return 'drive-metadata-read'
    case 'bitable': return 'bitable-records-read'
  }
}

import {
  projectEvolutionAttention,
  type EvolutionAttentionOverview,
} from './attention.js'
import type { FeishuHostRoute } from 'dsh-feishu'
import type { TelegramHostRoute } from 'dsh-telegram'

export interface EvolutionAttentionSource {
  overview(workspaceId: string): Promise<EvolutionAttentionOverview>
}

/** Serial host-only scanner. Durable duplicate suppression remains in dsh-telegram. */
export class EvolutionTelegramBridge {
  private readonly scanner: SerialAttentionScanner

  constructor(
    source: EvolutionAttentionSource,
    route: Pick<TelegramHostRoute, 'workspaceId' | 'notify'>,
    onError: (error: unknown) => void = () => {},
  ) {
    this.scanner = new SerialAttentionScanner(async () => {
      const overview = await readOverview(source, route.workspaceId)
      for (const notice of projectEvolutionAttention(overview)) {
        await route.notify({ id: notice.id, text: notice.text })
      }
    }, onError)
  }

  scan(): Promise<void> { return this.scanner.scan() }

  dispose(): Promise<void> { return this.scanner.dispose() }
}

/** Scan only the exact Workspaces exported by the configured Feishu Gateway routes. */
export class EvolutionFeishuBridge {
  private readonly scanner: SerialAttentionScanner

  constructor(
    source: EvolutionAttentionSource,
    route: Pick<FeishuHostRoute, 'routes' | 'notify'>,
    onError: (error: unknown) => void = () => {},
  ) {
    this.scanner = new SerialAttentionScanner(async () => {
      const byWorkspace = new Map<string, EvolutionAttentionOverview>()
      for (const binding of route.routes) {
        let overview = byWorkspace.get(binding.workspaceId)
        if (overview === undefined) {
          overview = await readOverview(source, binding.workspaceId)
          byWorkspace.set(binding.workspaceId, overview)
        }
        for (const notice of projectEvolutionAttention(overview)) {
          await route.notify({ routeId: binding.routeId, id: notice.id, text: notice.text })
        }
      }
    }, onError)
  }

  scan(): Promise<void> { return this.scanner.scan() }

  dispose(): Promise<void> { return this.scanner.dispose() }
}

async function readOverview(
  source: EvolutionAttentionSource,
  workspaceId: string,
): Promise<EvolutionAttentionOverview> {
  const overview = await source.overview(workspaceId)
  if (overview.workspaceId !== workspaceId) {
    throw new Error(`Workspace authority mismatch: expected ${workspaceId}, received ${overview.workspaceId}`)
  }
  return overview
}

class SerialAttentionScanner {
  private tail: Promise<void> = Promise.resolve()
  private closed = false

  constructor(
    private readonly task: () => Promise<void>,
    private readonly onError: (error: unknown) => void,
  ) {}

  scan(): Promise<void> {
    if (this.closed) return this.tail
    const scan = this.tail.then(async () => {
      if (!this.closed) await this.task()
    })
    const contained = scan.catch((error: unknown) => { this.onError(error) })
    this.tail = contained
    return contained
  }

  async dispose(): Promise<void> {
    this.closed = true
    await this.tail
  }
}

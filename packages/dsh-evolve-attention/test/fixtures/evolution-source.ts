import type { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import type { EvolutionAttentionOverview } from '../../src/attention.js'

interface Config {
  readonly active?: boolean
  readonly activationFile?: string
}

export function apply(ctx: Context, config: Config = {}): void {
  const calls: string[] = []
  ctx.provide('evoforge.evolutionControl', Object.freeze({
    overview: (requestedWorkspaceId: string) => {
      calls.push(requestedWorkspaceId)
      const active = config.active === true
        || (config.activationFile !== undefined && existsSync(config.activationFile))
      const overview: EvolutionAttentionOverview = {
        workspaceId: requestedWorkspaceId,
        reviews: {
          items: active ? [{
            id: createHash('sha256').update(`review\0${requestedWorkspaceId}`).digest('hex'),
            status: 'pending',
            recommendation: 'review',
            skillName: `workspace-${requestedWorkspaceId.slice(0, 8)}`,
          }] : [],
        },
      }
      return Promise.resolve(overview)
    },
  }) as never)
  ctx.provide('evoforge.attentionTestSource' as never, Object.freeze({ calls }) as never)
}

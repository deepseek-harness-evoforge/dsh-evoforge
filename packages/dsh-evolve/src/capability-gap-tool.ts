import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-goal'
import { isSkillName } from '@deepseek-ai/dsh-skill'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { CapabilityMap } from './capability-map.ts'
import type { CapabilityGap, CapabilityGapStore } from './capability-gap-store.ts'
import { sessionIdentityOf } from './generation-binder.ts'
import type { EvolutionStore } from './generation-store.ts'

export interface CapabilityGapToolOptions {
  readonly now?: () => number
  readonly onGap?: (gap: CapabilityGap) => Promise<void> | void
}

/**
 * Give the model one explicit, bounded way to report an unmet capability after
 * it has semantically routed against the native Session Skill catalog.
 */
export function installCapabilityGapTool(
  ctx: Context,
  gaps: Pick<CapabilityGapStore, 'record'>,
  capabilities: Pick<CapabilityMap, 'snapshot'>,
  evolution: Pick<EvolutionStore, 'getSessionGeneration'>,
  options: CapabilityGapToolOptions = {},
): () => void {
  const now = options.now ?? Date.now
  return ctx.tools.register(defineTool({
    name: 'report_capability_gap',
    // This is a new model-visible composition epoch: ordinary Interaction is
    // primary, while the durable legacy Goal-linked evidence path remains
    // explicitly gated below.
    description: 'Report a missing reusable capability after reviewing the complete native Session Skill catalog and confirming no available Skill applies. Propose one kebab-case name. EvoForge records a durable Interaction signal; a native Goal is optional. Goal-linked signals may enter the legacy evidence loop, while a no-Goal signal is recorded and explicitly abstained until independent Interaction evidence exists. It never searches, downloads, or installs external Skills, and never changes the current Session.',
    parameters: {
      name: {
        type: 'string',
        required: true,
        description: 'Proposed kebab-case name for the missing reusable Skill capability.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true, enum: ['queued', 'already-recorded', 'abstained'] },
          gapId: { type: 'string', required: true },
          requestedSkill: { type: 'string', required: true },
          reason: { type: 'string', enum: ['missing-native-goal'] },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.status === 'abstained'
          ? `Capability Gap ${value.gapId} recorded for ${value.requestedSkill}; discovery abstained because no native DSH Goal is active.`
          : value.status === 'queued'
          ? `Capability Gap ${value.gapId} recorded for ${value.requestedSkill}; internal Skill opportunity discovery continues asynchronously.`
          : `Capability Gap ${value.gapId} was already recorded for ${value.requestedSkill}.`,
      }],
    },
    async execute({ name }, execution) {
      if (!isSkillName(name) || name.length > 128) {
        throw new Error(`invalid proposed Skill name '${name}'`)
      }
      const agent = execution.agent
      if (agent === undefined) throw new Error('report_capability_gap requires a native DSH Agent')
      const identity = await sessionIdentityOf(ctx, agent)
      const catalog = capabilities.snapshot(identity.workspaceId, identity.sessionId)
      if (catalog.status !== 'complete' || catalog.catalogHash === undefined) {
        throw new Error('cannot confirm a Capability Gap from an incomplete Session Skill catalog')
      }
      if (catalog.capabilities.some(capability => capability.name === name)) {
        throw new Error(`Skill '${name}' is already available in this Session`)
      }
      const goal = currentGoal(ctx, agent)
      const generationId = evolution.getSessionGeneration(identity)?.id
      const recorded = await gaps.record({
        observedAt: now(),
        workspaceId: identity.workspaceId,
        sessionId: identity.sessionId,
        requestedSkill: name,
        catalogHash: catalog.catalogHash,
        catalogSize: catalog.capabilities.length,
        ...(generationId === undefined ? {} : { generationId }),
        ...(goal === undefined
          ? { abstention: { reason: 'missing-native-goal' as const } }
          : { goal }),
        evidence: {
          kind: 'model-declared-skill-gap',
          catalog: 'complete',
          routing: 'model-declared-no-applicable-skill',
          providers: 'settled',
        },
      })
      if (goal !== undefined && recorded.created && options.onGap !== undefined) {
        try {
          void Promise.resolve(options.onGap(recorded.gap)).catch((error: unknown) => {
            ctx.logger.warn(`dsh-evolve failed to reconcile internal Skill opportunities for Capability Gap '${recorded.gap.id}': ${String(error)}`)
          })
        } catch (error) {
          ctx.logger.warn(`dsh-evolve failed to reconcile internal Skill opportunities for Capability Gap '${recorded.gap.id}': ${String(error)}`)
        }
      }
      if (goal === undefined) {
        return {
          status: 'abstained' as const,
          reason: 'missing-native-goal' as const,
          gapId: recorded.gap.id,
          requestedSkill: recorded.gap.requestedSkill,
        }
      }
      return {
        status: recorded.created ? 'queued' as const : 'already-recorded' as const,
        gapId: recorded.gap.id,
        requestedSkill: recorded.gap.requestedSkill,
      }
    },
    presentCall({ name }) {
      return { card: 'generic', title: `Report missing capability ${name}`, kind: 'read', rawInput: name }
    },
  }))
}

function currentGoal(
  ctx: Context,
  agent: Agent,
): CapabilityGap['goal'] | undefined {
  try {
    const goal = ctx.goals.get(agent)
    if (goal === undefined) return undefined
    return { id: goal.id, revision: goal.revision, objective: goal.objective }
  } catch {
    return undefined
  }
}

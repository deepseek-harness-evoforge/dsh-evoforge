import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { CapabilityGeneration, EvolutionStore } from './generation-store.ts'

const USAGE = 'Usage: /evolve [status|promote <64-char-generation-id>|rollback]'
const generationIdPattern = /^[a-f0-9]{64}$/

/** Register the optional human control plane without adding a model Tool. */
export function installEvolutionCommand(ctx: Context, store: EvolutionStore): void {
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'evolve',
      description: 'view, promote, or roll back an immutable capability Generation',
      input: { hint: '[status|promote <generation-id>|rollback]' },
      handler: ({ rawInput }) => executeEvolutionCommand(store, rawInput),
    })
  })
}

/** Execute one explicit human action over the verified release store. */
export async function executeEvolutionCommand(
  store: EvolutionStore,
  rawInput: string,
): Promise<CommandResult> {
  const input = rawInput.trim()
  try {
    if (input === '' || input === 'status') return renderStatus(store.getActiveGeneration())
    if (input === 'rollback') {
      const result = await store.rollbackGeneration()
      return {
        kind: 'success',
        text: [
          'Generation rolled back for future Sessions.',
          `Previous: ${result.previousId}`,
          `Active: ${result.generation?.id ?? 'native DSH'}`,
          'Existing Sessions were not changed.',
        ].join('\n'),
      }
    }
    const promote = /^promote\s+([^\s]+)$/u.exec(input)
    if (promote?.[1] !== undefined && generationIdPattern.test(promote[1])) {
      const result = await store.promoteGeneration(promote[1])
      if (result.previousId === result.generation.id) {
        return {
          kind: 'success',
          text: `Generation ${result.generation.id} is already active. Existing Sessions remain pinned.`,
        }
      }
      return {
        kind: 'success',
        text: [
          'Generation promoted for future Sessions.',
          `Previous: ${result.previousId ?? 'native DSH'}`,
          `Active: ${result.generation.id}`,
          'Existing Sessions were not changed.',
          'Rollback: /evolve rollback',
        ].join('\n'),
      }
    }
    return { kind: 'error', text: USAGE }
  } catch (error) {
    return {
      kind: 'error',
      text: `Evolution action failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

function renderStatus(active: CapabilityGeneration | undefined): CommandResult {
  if (active === undefined) {
    return {
      kind: 'success',
      text: [
        'Evolution status',
        'Active: native DSH',
        'Future Sessions will use native capabilities.',
        '',
        'Commands: /evolve promote <64-char-generation-id>',
      ].join('\n'),
    }
  }
  return {
    kind: 'success',
    text: [
      'Evolution status',
      `Active: ${active.id}`,
      `Rollback target: ${active.parentId ?? 'native DSH'}`,
      'Artifacts:',
      ...active.artifacts.map(artifact =>
        `- skill ${artifact.name} tree ${artifact.treeHash} commit ${artifact.gitCommit}`),
      'Existing Sessions keep their pinned Generation.',
      '',
      'Commands: /evolve rollback',
    ].join('\n'),
  }
}

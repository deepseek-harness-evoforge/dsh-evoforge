export type AutomaticEvolutionInflightStatus = 'clear' | 'busy' | 'unknown'

export interface AutomaticEvolutionInflightSource {
  automaticInflightStatus(
    skillName: string,
    signalId: string,
  ): Promise<AutomaticEvolutionInflightStatus>
}

/** Combine existing durable authorities without creating another queue or state store. */
export async function automaticEvolutionInflightStatus(
  skillName: string,
  signalId: string,
  sources: readonly AutomaticEvolutionInflightSource[],
): Promise<AutomaticEvolutionInflightStatus> {
  if (sources.length === 0) return 'unknown'
  const statuses = await Promise.all(sources.map(async (source) => {
    try {
      return await source.automaticInflightStatus(skillName, signalId)
    } catch {
      return 'unknown' as const
    }
  }))
  if (statuses.includes('unknown')) return 'unknown'
  if (statuses.includes('busy')) return 'busy'
  return 'clear'
}

import { z } from 'zod'

export const INTERACTION_SESSION_V0_DIALECT =
  'deepseek-harness@0.1.2-alpha.5' as const
export const INTERACTION_SESSION_V3_DIALECT =
  'deepseek-harness@0.1.5-rc.2' as const

export const interactionSessionDialectSchema = z.enum([
  INTERACTION_SESSION_V0_DIALECT,
  INTERACTION_SESSION_V3_DIALECT,
])

export type InteractionSessionDialect = z.infer<typeof interactionSessionDialectSchema>

export function interactionSessionDialectForFormatVersion(
  value: unknown,
): InteractionSessionDialect | undefined {
  if (value === 0) return INTERACTION_SESSION_V0_DIALECT
  if (value === 3) return INTERACTION_SESSION_V3_DIALECT
  return undefined
}

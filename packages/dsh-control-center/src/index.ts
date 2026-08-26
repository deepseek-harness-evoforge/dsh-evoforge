import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-control-center'
export const inject: readonly string[] = []

export interface Config {}
export const Config: Schema<Config> = z.object({})

/** Host half is intentionally inert; this plugin only composes official DSH Client slots. */
export function apply(_ctx: Context, _config: Config = {}): void {}

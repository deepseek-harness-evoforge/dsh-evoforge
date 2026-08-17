import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-evolve-web'
export const inject = ['evoforge.evolutionControl']

export interface Config {}
export const Config: Schema<Config> = z.object({})

/** Host half is only a dependency gate; all behavior lives in the optional browser module. */
export function apply(_ctx: Context, _config: Config = {}): void {}

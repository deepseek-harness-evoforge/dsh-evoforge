import type {} from 'dsh-evolve'

export const name = 'dsh-evolve-web'
export const inject = ['evoforge.evolutionControl']

/** Host half is only a dependency gate; all behavior lives in the optional browser module. */
export function apply(): void {}

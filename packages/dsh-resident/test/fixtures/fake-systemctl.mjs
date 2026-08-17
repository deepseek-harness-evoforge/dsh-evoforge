#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const statePath = process.env.DSH_RESIDENT_TEST_STATE
if (statePath === undefined || statePath === '') throw new Error('DSH_RESIDENT_TEST_STATE is required')
const state = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, 'utf8'))
  : { active: false, enabled: false, calls: [] }
const args = process.argv.slice(2)
state.calls.push(args)
const command = args[0] === '--user' ? args[1] : args[0]

if (command === 'enable') state.enabled = true
if (command === 'restart') state.active = true
if (command === 'disable') {
  state.enabled = false
  state.active = false
}
writeFileSync(statePath, `${JSON.stringify(state)}\n`)

if (command === 'is-enabled') process.exit(state.enabled ? 0 : 1)
if (command === 'is-active') process.exit(state.active ? 0 : 3)

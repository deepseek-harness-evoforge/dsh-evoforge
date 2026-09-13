// Controller-level reproduction only: no Host, provider, credentials, or network.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const args = process.argv.slice(2)
if (args.length < 1 || args.length > 2 || (args[1] !== undefined && args[1] !== '--require-auto-recovery')) {
  throw new Error('Usage: node scripts/repro-dsh-paused-connection.mjs <built-dsh-checkout> [--require-auto-recovery]')
}
const { ConnectionController } = await import(pathToFileURL(resolve(
  args[0], 'packages/client/connection/lib/types/client/connection.js',
)).href)

let available = false
let calls = 0
let connections = 0
let state
let pausedResolve
let connectedResolve
let failedAttemptsResolve
const paused = new Promise(resolve => { pausedResolve = resolve })
const connected = new Promise(resolve => { connectedResolve = resolve })
const failedAttempts = new Promise(resolve => { failedAttemptsResolve = resolve })
const controller = new ConnectionController((signal, ready) => {
  calls += 1
  if (!available) {
    if (calls >= 3) failedAttemptsResolve()
    return Promise.reject(new Error('synthetic source unavailable'))
  }
  ready({ home: '/synthetic-workspace' })
  return new Promise(resolve => { signal.addEventListener('abort', resolve, { once: true }) })
}, {
  onStateChange: next => {
    state = next
    if (next === 'disconnected') pausedResolve()
  },
  onConnected: () => { connections += 1; connectedResolve() },
}, { backoffBaseMs: 10, backoffFactor: 2, backoffMaxMs: 20, generationReadyWarnMs: 50, generationReadyTimeoutMs: 100 })

try {
  controller.start()
  if (args[1] === '--require-auto-recovery') {
    await bounded(failedAttempts)
    await sleep(50)
  } else {
    await bounded(paused)
  }
  const callsAtPause = calls
  available = true
  await sleep(50)
  if (args[1] === '--require-auto-recovery') {
    assert.equal(connections, 1, 'source recovered, but native automatic reconnect remained paused')
    console.log('PASS: native automatic recovery establishes a generation after repeated source failures.')
  } else {
    assert.equal(calls, callsAtPause, 'source was unexpectedly retried after the capped failure')
    assert.equal(connections, 0)
    assert.equal(state, 'disconnected')
    controller.reconnect()
    await bounded(connected)
    assert.equal(connections, 1)
    assert.equal(state, 'connected')
    console.log('CONFIRMED: capped failure pauses automatic retries; native reconnect restores the generation.')
  }
} finally {
  controller.stop()
}

async function bounded(promise) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('reproduction setup timed out')), 2_000) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

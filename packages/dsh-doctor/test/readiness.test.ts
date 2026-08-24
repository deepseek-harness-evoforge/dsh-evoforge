import { describe, expect, it } from 'vitest'
import { evaluateRuntimeReadiness } from '../src/readiness.js'

describe('runtime readiness report', () => {
  it('is ready when every required plugin is enabled and active', () => {
    const report = evaluateRuntimeReadiness({
      requiredModules: ['dsh-evolve', 'dsh-software-delivery'],
      entries: [
        { entryId: 'evolution', moduleName: 'dsh-evolve', enabled: true, phase: 'active' },
        { entryId: 'delivery', moduleName: 'dsh-software-delivery', enabled: true, phase: 'active' },
        { entryId: 'optional-disabled', moduleName: 'example-optional', enabled: false, phase: null },
      ],
    })

    expect(report).toEqual({
      schemaVersion: 1,
      status: 'ready',
      checks: [
        {
          id: 'required-plugins',
          status: 'passed',
          summary: '2 required plugins are active.',
        },
        {
          id: 'runtime-failures',
          status: 'passed',
          summary: 'No enabled plugin is failed.',
        },
      ],
    })
  })

  it('names missing, disabled, and failed plugins instead of claiming readiness', () => {
    const report = evaluateRuntimeReadiness({
      requiredModules: ['dsh-evolve', 'dsh-software-delivery', 'dsh-doctor'],
      entries: [
        { entryId: 'evolution', moduleName: 'dsh-evolve', enabled: false, phase: null },
        { entryId: 'doctor', moduleName: 'dsh-doctor', enabled: true, phase: 'active' },
        { entryId: 'broken-channel', moduleName: 'example-channel', enabled: true, phase: 'failed' },
      ],
    })

    expect(report).toEqual({
      schemaVersion: 1,
      status: 'not-ready',
      checks: [
        {
          id: 'required-plugins',
          status: 'failed',
          summary: 'Required plugins are not active: dsh-evolve (disabled), dsh-software-delivery (missing).',
          action: 'Enable or install the named plugins, then run /doctor again.',
        },
        {
          id: 'runtime-failures',
          status: 'failed',
          summary: 'Enabled plugins failed: example-channel [broken-channel].',
          action: 'Inspect the named Loader entry diagnostics, correct its configuration, and reload it.',
        },
      ],
    })
  })

  it('reports an in-flight required plugin as unknown during a reload window', () => {
    const report = evaluateRuntimeReadiness({
      requiredModules: ['dsh-evolve'],
      entries: [
        { entryId: 'evolution', moduleName: 'dsh-evolve', enabled: true, phase: 'loading' },
      ],
    })

    expect(report).toEqual({
      schemaVersion: 1,
      status: 'unknown',
      checks: [
        {
          id: 'required-plugins',
          status: 'unknown',
          summary: 'Required plugins are still changing: dsh-evolve (loading).',
          action: 'Wait for Loader activity to settle, then run /doctor again.',
        },
        {
          id: 'runtime-failures',
          status: 'passed',
          summary: 'No enabled plugin is failed.',
        },
      ],
    })
  })

  it('does not claim readiness when the required Feishu transport is degraded', () => {
    const report = evaluateRuntimeReadiness({
      requiredModules: ['dsh-feishu'],
      entries: [
        { entryId: 'feishu', moduleName: 'dsh-feishu', enabled: true, phase: 'active' },
      ],
      gateway: {
        lifecycle: 'ready',
        transports: {
          items: [{ adapter: 'feishu', state: 'degraded' }],
        },
      },
    })

    expect(report).toEqual({
      schemaVersion: 1,
      status: 'not-ready',
      checks: [
        {
          id: 'required-plugins',
          status: 'passed',
          summary: '1 required plugin is active.',
        },
        {
          id: 'runtime-failures',
          status: 'passed',
          summary: 'No enabled plugin is failed.',
        },
        {
          id: 'channel-feishu',
          status: 'failed',
          summary: 'Required Feishu transport is degraded.',
          action: 'Check the Feishu credentials, exact route, network/proxy, and Adapter diagnostics, then run /doctor again.',
        },
      ],
    })
  })

  it('reports a required active Feishu Adapter with no Gateway transport as not ready', () => {
    const report = evaluateRuntimeReadiness({
      requiredModules: ['dsh-feishu'],
      entries: [
        { entryId: 'feishu', moduleName: 'dsh-feishu', enabled: true, phase: 'active' },
      ],
    })

    expect(report.checks.at(-1)).toEqual({
      id: 'channel-feishu',
      status: 'failed',
      summary: 'Required Feishu transport is unavailable.',
      action: 'Enable dsh-gateway and one exact Feishu route, then run /doctor again.',
    })
    expect(report.status).toBe('not-ready')
  })

  it('proves readiness only from an observed ready Feishu transport', () => {
    const report = evaluateRuntimeReadiness({
      requiredModules: ['dsh-feishu'],
      entries: [
        { entryId: 'feishu', moduleName: 'dsh-feishu', enabled: true, phase: 'active' },
      ],
      gateway: {
        lifecycle: 'ready',
        transports: {
          items: [{ adapter: 'feishu', state: 'ready' }],
        },
      },
    })

    expect(report.checks.at(-1)).toEqual({
      id: 'channel-feishu',
      status: 'passed',
      summary: '1 required Feishu transport is ready.',
    })
    expect(report.status).toBe('ready')
  })

  it('reports a connecting required Feishu transport as unknown during reload', () => {
    const report = evaluateRuntimeReadiness({
      requiredModules: ['dsh-feishu'],
      entries: [
        { entryId: 'feishu', moduleName: 'dsh-feishu', enabled: true, phase: 'active' },
      ],
      gateway: {
        lifecycle: 'ready',
        transports: {
          items: [{ adapter: 'feishu', state: 'connecting' }],
        },
      },
    })

    expect(report.checks.at(-1)).toEqual({
      id: 'channel-feishu',
      status: 'unknown',
      summary: 'Required Feishu transport is still changing: 1 connecting.',
      action: 'Wait for the Feishu Adapter lifecycle to settle, then run /doctor again.',
    })
    expect(report.status).toBe('unknown')
  })

  it('diagnoses Telegram independently through the same Gateway transport interface', () => {
    const report = evaluateRuntimeReadiness({
      requiredModules: ['dsh-feishu', 'dsh-telegram'],
      entries: [
        { entryId: 'feishu', moduleName: 'dsh-feishu', enabled: true, phase: 'active' },
        { entryId: 'telegram', moduleName: 'dsh-telegram', enabled: true, phase: 'active' },
      ],
      gateway: {
        lifecycle: 'ready',
        transports: {
          items: [
            { adapter: 'feishu', state: 'ready' },
            { adapter: 'telegram', state: 'degraded' },
          ],
        },
      },
    })

    expect(report.checks.find(check => check.id === 'channel-feishu')).toMatchObject({ status: 'passed' })
    expect(report.checks.find(check => check.id === 'channel-telegram')).toEqual({
      id: 'channel-telegram',
      status: 'failed',
      summary: 'Required Telegram transport is degraded.',
      action: 'Check the Telegram credentials, exact route, network/proxy, and Adapter diagnostics, then run /doctor again.',
    })
    expect(report.status).toBe('not-ready')
  })
})

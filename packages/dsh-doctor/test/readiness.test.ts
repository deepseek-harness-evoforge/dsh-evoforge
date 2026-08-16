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
})

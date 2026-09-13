import { describe, expect, it } from 'vitest'
import {
  canonicalTranscriptHeader,
  transcriptHeaderEquals,
} from '../src/interaction-request-header.ts'

describe('historical transcript request headers', () => {
  const config = { provider: 'fixture', model: 'fixture-model' }

  it('preserves nonempty historical system text without mutating the input', () => {
    const header = Object.freeze({ config, system: 'Fixed historical prompt.' })
    expect(canonicalTranscriptHeader(header)).toEqual(header)
    expect(canonicalTranscriptHeader(header)).not.toBe(header)
  })

  it('normalizes empty optional fields without introducing a v3 system field', () => {
    expect(canonicalTranscriptHeader({ config, system: '', tools: [] })).toEqual({ config })
    expect(canonicalTranscriptHeader({ config })).toEqual({ config })
  })

  it('does not let native v3 equality hide a historical system change', () => {
    const left = canonicalTranscriptHeader({ config, system: 'First prompt.' })
    const right = canonicalTranscriptHeader({ config, system: 'Changed prompt.' })
    expect(transcriptHeaderEquals(left, right)).toBe(false)
    expect(transcriptHeaderEquals(left, canonicalTranscriptHeader({ config }))).toBe(false)
    expect(transcriptHeaderEquals(left, { ...left })).toBe(true)
    expect(transcriptHeaderEquals(left, {
      ...left, config: { ...config, model: 'another-model' },
    })).toBe(false)
  })
})

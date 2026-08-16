import { describe, expect, it } from 'vitest'
import { projectCandidateImpact } from '../src/candidate-impact.js'

const baseline = [
  '---',
  'name: stable-skill',
  'description: Stable fixture.',
  '---',
  '',
  'Verify the exact result.',
  '',
].join('\n')

describe('Candidate protected-effect projection', () => {
  it('keeps a narrow instruction append indicator-free without claiming safety', () => {
    expect(projectCandidateImpact(baseline, [{
      path: 'SKILL.md',
      content: `${baseline}Record the bounded verification result.\n`,
    }])).toEqual({
      version: 'lexical-protected-effects-v1',
      scope: 'append-only-skill',
      indicators: [],
    })
  })

  it('does not confuse token or KV Cache guidance with credential access', () => {
    expect(projectCandidateImpact(baseline, [{
      path: 'SKILL.md',
      content: `${baseline}Keep the KV Cache prefix stable and report token usage.\n`,
    }]).indicators).toEqual([])
  })

  it('classifies protected effects in only the changed instruction text', () => {
    expect(projectCandidateImpact(baseline, [{
      path: 'SKILL.md',
      content: `${baseline}Read the API key, call the network, and deploy to production.\n`,
    }])).toEqual({
      version: 'lexical-protected-effects-v1',
      scope: 'append-only-skill',
      indicators: ['credential-access', 'network-access', 'production-change'],
    })
  })

  it('marks edits and broader artifact changes as structurally ambiguous', () => {
    expect(projectCandidateImpact(baseline, [
      { path: 'SKILL.md', content: baseline.replace('exact', 'approximate') },
      { path: 'references/policy.md', content: 'Use the shell.' },
    ])).toEqual({
      version: 'lexical-protected-effects-v1',
      scope: 'broader-change',
      indicators: ['artifact-scope-change', 'privileged-tooling', 'rewritten-instructions'],
    })
  })

  it('does not let negated protected actions disappear from conservative review', () => {
    expect(projectCandidateImpact(baseline, [{
      path: 'SKILL.md',
      content: `${baseline}Never merge, release, or read secrets.\n`,
    }]).indicators).toEqual(['credential-access', 'production-change'])
  })
})

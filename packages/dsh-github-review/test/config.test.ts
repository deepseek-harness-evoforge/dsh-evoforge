import { describe, expect, it } from 'vitest'
import { resolveGitHubReviewConfig } from '../src/config.js'

describe('dsh-github-review configuration', () => {
  it('normalizes one exact repository and reviewer allowlist without enabling secret access', () => {
    expect(resolveGitHubReviewConfig({
      agentId: 'coder',
      owner: 'DeepSeek-Harness-EvoForge',
      repo: 'dsh-evoforge',
      trustedReviewers: ['Alice', 'BOB'],
    })).toEqual({
      agentId: 'coder',
      owner: 'DeepSeek-Harness-EvoForge',
      repo: 'dsh-evoforge',
      trustedReviewers: ['alice', 'bob'],
      apiBase: 'https://api.github.com',
      pollIntervalSeconds: 300,
      requestTimeoutSeconds: 20,
      maxTextChars: 6_000,
      maxComments: 20,
    })
  })

  it('rejects arbitrary API hosts, duplicate reviewers, and implicit token environment names', () => {
    expect(() => resolveGitHubReviewConfig({
      agentId: 'coder',
      owner: 'org',
      repo: 'repo',
      trustedReviewers: ['alice'],
      apiBase: 'https://example.com',
    })).toThrow(/official GitHub HTTPS or a loopback server/u)
    expect(() => resolveGitHubReviewConfig({
      agentId: 'coder',
      owner: 'org',
      repo: 'repo',
      trustedReviewers: ['Alice', 'alice'],
    })).toThrow(/unique/u)
    expect(() => resolveGitHubReviewConfig({
      agentId: 'coder',
      owner: 'org',
      repo: 'repo',
      trustedReviewers: ['alice'],
      tokenEnv: 'not-valid-name',
    })).toThrow(/environment-variable name/u)
  })
})

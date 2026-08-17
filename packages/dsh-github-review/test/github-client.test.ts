import { describe, expect, it, vi } from 'vitest'
import { GitHubReviewClient } from '../src/github-client.js'

describe('GitHub review read adapter', () => {
  it('reads versioned review and inline-comment data without credentials for a public repository', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([{
        id: 91,
        state: 'CHANGES_REQUESTED',
        body: 'Please keep the cache prefix stable.',
        commit_id: 'b'.repeat(40),
        submitted_at: '2026-08-17T04:00:00Z',
        html_url: 'https://github.com/org/repo/pull/26#pullrequestreview-91',
        user: { login: 'alice', type: 'User' },
      }], { etag: '"reviews-v1"' }))
      .mockResolvedValueOnce(jsonResponse([{
        id: 301,
        pull_request_review_id: 91,
        body: 'Keep this out of the Tool Schema.',
        path: 'src/index.ts',
        line: 42,
        html_url: 'https://github.com/org/repo/pull/26#discussion_r301',
      }]))
    const client = new GitHubReviewClient({ fetcher })

    const result = await client.read({
      agentId: 'coder',
      sessionId: 'session-1',
      owner: 'org',
      repo: 'repo',
      pullNumber: 26,
      headCommit: 'b'.repeat(40),
    })

    expect(result).toEqual({
      kind: 'modified',
      etag: '"reviews-v1"',
      reviews: [{
        id: 91,
        state: 'CHANGES_REQUESTED',
        body: 'Please keep the cache prefix stable.',
        commitId: 'b'.repeat(40),
        submittedAt: '2026-08-17T04:00:00Z',
        htmlUrl: 'https://github.com/org/repo/pull/26#pullrequestreview-91',
        user: { login: 'alice', type: 'User' },
      }],
      comments: [{
        id: 301,
        reviewId: 91,
        body: 'Keep this out of the Tool Schema.',
        path: 'src/index.ts',
        line: 42,
        htmlUrl: 'https://github.com/org/repo/pull/26#discussion_r301',
      }],
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.github.com/repos/org/repo/pulls/26/reviews?per_page=100&page=1')
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      redirect: 'error',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
      },
    })
    expect((fetcher.mock.calls[0]?.[1]?.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('accepts an irrelevant pending review without the optional submitted timestamp', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse([{
      id: 90,
      state: 'PENDING',
      body: '',
      commit_id: 'b'.repeat(40),
      html_url: 'https://github.com/org/repo/pull/26#pullrequestreview-90',
      user: { login: 'bob', type: 'User' },
    }]))
    const client = new GitHubReviewClient({ fetcher })

    const result = await client.read({
      agentId: 'coder', sessionId: 'session-1', owner: 'org', repo: 'repo',
      pullNumber: 26, headCommit: 'b'.repeat(40),
    })

    expect(result).toEqual({
      kind: 'modified',
      reviews: [{
        id: 90,
        state: 'PENDING',
        body: '',
        commitId: 'b'.repeat(40),
        htmlUrl: 'https://github.com/org/repo/pull/26#pullrequestreview-90',
        user: { login: 'bob', type: 'User' },
      }],
      comments: [],
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('fails closed when review pagination exceeds the bounded first page', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse([], {
      link: '<https://api.github.com/repos/org/repo/pulls/26/reviews?per_page=100&page=2>; rel="next", <https://api.github.com/repos/org/repo/pulls/26/reviews?per_page=100&page=2>; rel="last"',
    }))
    const client = new GitHubReviewClient({ fetcher })

    const result = await client.read({
      agentId: 'coder',
      sessionId: 'session-1',
      owner: 'org',
      repo: 'repo',
      pullNumber: 26,
      headCommit: 'b'.repeat(40),
    })

    expect(result).toEqual({
      kind: 'unknown',
      reason: 'GitHub reviews exceed the bounded 100-item page.',
    })
  })

  it('fails closed when one actionable review has more than 100 inline comments', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([{
        id: 91,
        state: 'CHANGES_REQUESTED',
        body: '',
        commit_id: 'b'.repeat(40),
        submitted_at: '2026-08-17T04:00:00Z',
        html_url: 'https://github.com/org/repo/pull/26#pullrequestreview-91',
        user: { login: 'alice', type: 'User' },
      }]))
      .mockResolvedValueOnce(jsonResponse([], {
        link: '<https://api.github.com/repos/org/repo/pulls/26/reviews/91/comments?per_page=100&page=2>; rel="next"',
      }))
    const client = new GitHubReviewClient({ fetcher })

    const result = await client.read({
      agentId: 'coder',
      sessionId: 'session-1',
      owner: 'org',
      repo: 'repo',
      pullNumber: 26,
      headCommit: 'b'.repeat(40),
    })

    expect(result).toEqual({
      kind: 'unknown',
      reason: 'GitHub review 91 comments exceed the bounded 100-item page.',
    })
  })

  it('uses an authorized conditional request with a bounded network lifetime when explicitly configured', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 304 }))
    const client = new GitHubReviewClient({
      fetcher,
      token: 'configured-secret',
      requestTimeoutMs: 5_000,
    })

    const result = await client.read({
      agentId: 'coder',
      sessionId: 'session-1',
      owner: 'org',
      repo: 'repo',
      pullNumber: 26,
      headCommit: 'b'.repeat(40),
    }, '"reviews-v1"')

    expect(result).toEqual({ kind: 'not-modified' })
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Authorization: 'Bearer configured-secret',
        'If-None-Match': '"reviews-v1"',
      },
      signal: expect.any(AbortSignal),
    })
  })

  it.each([403, 429, 500])('keeps HTTP %i outside the Session as an unknown read', async (status) => {
    const client = new GitHubReviewClient({
      fetcher: vi.fn<typeof fetch>(async () => new Response('{}', { status })),
    })

    const result = await client.read({
      agentId: 'coder', sessionId: 'session-1', owner: 'org', repo: 'repo',
      pullNumber: 26, headCommit: 'b'.repeat(40),
    })

    expect(result).toEqual({
      kind: 'unknown',
      reason: `GitHub reviews returned HTTP ${status}.`,
    })
  })

  it('fails closed on malformed review data', async () => {
    const client = new GitHubReviewClient({
      fetcher: vi.fn<typeof fetch>(async () => jsonResponse([{
        id: 91,
        state: 'CHANGES_REQUESTED',
        body: 'missing exact commit and user',
      }])),
    })

    const result = await client.read({
      agentId: 'coder', sessionId: 'session-1', owner: 'org', repo: 'repo',
      pullNumber: 26, headCommit: 'b'.repeat(40),
    })

    expect(result).toEqual({
      kind: 'unknown',
      reason: 'GitHub reviews response has an invalid item.',
    })
  })
})

function jsonResponse(value: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

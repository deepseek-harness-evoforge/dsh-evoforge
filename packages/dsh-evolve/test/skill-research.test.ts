import { describe, expect, it, vi } from 'vitest'
import {
  createDshWebSkillResearch,
  type SkillResearchWeb,
} from '../src/skill-research.ts'

describe('bounded Skill research over the native DSH Web seam', () => {
  it('separates grounded knowledge from independent verification anchors', async () => {
    const search = vi.fn<SkillResearchWeb['search']>(async ({ query }) => ({
      sources: query.includes('failure modes')
        ? [
            { url: 'https://verify.example/failures', title: 'Failure cases' },
            { url: 'https://docs.example/guide', title: 'Duplicate knowledge source' },
          ]
        : query.includes('open source')
          ? [{ url: 'https://code.example/implementation', title: 'Open implementation' }]
          : query.includes('research benchmark')
            ? [{ url: 'https://papers.example/frontier', title: 'Frontier benchmark' }]
            : [{ url: 'https://docs.example/guide#overview', title: 'Official guide' }],
      truncated: false,
    }))
    const fetch = vi.fn<SkillResearchWeb['fetch']>(async ({ url }) => ({
      url,
      statusCode: 200,
      body: { kind: 'text', content: `Grounded content for ${url}\r\n` },
      truncated: false,
    }))
    const research = createDshWebSkillResearch({ search, fetch }, { timeoutMs: 5_000 })

    const first = await research({ skillName: 'missing-release-skill' })
    const second = await research({ skillName: 'missing-release-skill' })

    expect(search).toHaveBeenCalledTimes(8)
    expect(search.mock.calls.map(call => call[0])).toEqual([
      { query: '"missing-release-skill" official documentation', maxResults: 3 },
      { query: '"missing-release-skill" open source implementation', maxResults: 3 },
      { query: '"missing-release-skill" research benchmark', maxResults: 3 },
      { query: '"missing-release-skill" failure modes test verification', maxResults: 3 },
      { query: '"missing-release-skill" official documentation', maxResults: 3 },
      { query: '"missing-release-skill" open source implementation', maxResults: 3 },
      { query: '"missing-release-skill" research benchmark', maxResults: 3 },
      { query: '"missing-release-skill" failure modes test verification', maxResults: 3 },
    ])
    expect(first.knowledge.map(item => item.track)).toEqual(['official', 'open-source', 'frontier'])
    expect(first.verification.map(item => item.track)).toEqual(['holdout'])
    expect(first.verification.map(item => item.finalUrl)).not.toContain('https://docs.example/guide')
    expect(first.knowledge[0]).toMatchObject({
      role: 'knowledge',
      requestedUrl: 'https://docs.example/guide',
      finalUrl: 'https://docs.example/guide',
      statusCode: 200,
      excerpt: 'Grounded content for https://docs.example/guide\n',
      queryHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      contentDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(first).toEqual(second)
  })

  it('fails closed without two knowledge tracks and a disjoint verification source', async () => {
    const source = { url: 'https://only.example/source' }
    const search = vi.fn<SkillResearchWeb['search']>(async () => ({
      sources: [source],
      truncated: false,
    }))
    const fetch = vi.fn<SkillResearchWeb['fetch']>(async ({ url }) => ({
      url,
      statusCode: 200,
      body: { kind: 'html', content: '<p>Only one source.</p>' },
      truncated: false,
    }))
    const research = createDshWebSkillResearch({ search, fetch })

    await expect(research({ skillName: 'missing-release-skill' }))
      .rejects.toThrow('independent evidence')
  })

  it('bounds fetched evidence and rejects unsafe source URLs', async () => {
    const search = vi.fn<SkillResearchWeb['search']>(async ({ query }) => ({
      sources: query.includes('failure modes')
        ? [{ url: 'https://verify.example/check' }]
        : query.includes('open source')
          ? [{ url: 'https://code.example/source' }]
          : query.includes('official')
            ? [
                { url: 'http://insecure.example/guide' },
                { url: 'https://docs.example/guide' },
              ]
            : [],
      truncated: query.includes('open source'),
    }))
    const fetch = vi.fn<SkillResearchWeb['fetch']>(async ({ url }) => ({
      url,
      statusCode: 200,
      body: { kind: 'text', content: '证'.repeat(20_000) },
      truncated: false,
    }))
    const research = createDshWebSkillResearch({ search, fetch })

    const corpus = await research({ skillName: 'missing-release-skill' })

    expect(fetch).not.toHaveBeenCalledWith({ url: 'http://insecure.example/guide' }, expect.anything())
    expect(corpus.knowledge.length).toBe(2)
    expect(corpus.verification.length).toBe(1)
    expect(corpus.knowledge.some(item => item.truncated)).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(corpus))).toBeLessThanOrEqual(48 * 1024)
  })

  it('never turns private Goal text into a Web query', async () => {
    const search = vi.fn<SkillResearchWeb['search']>()
    const fetch = vi.fn<SkillResearchWeb['fetch']>()
    const research = createDshWebSkillResearch({ search, fetch })

    await expect(research({ skillName: 'customer/acme secret objective' }))
      .rejects.toThrow('public kebab-case skill name')
    expect(search).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('propagates cancellation instead of degrading it into missing evidence', async () => {
    const controller = new AbortController()
    const search = vi.fn<SkillResearchWeb['search']>(async (_request, signal) => {
      controller.abort(new Error('operator cancelled research'))
      signal?.throwIfAborted()
      return { sources: [], truncated: false }
    })
    const fetch = vi.fn<SkillResearchWeb['fetch']>()
    const research = createDshWebSkillResearch({ search, fetch })

    await expect(research({ skillName: 'missing-release-skill', signal: controller.signal }))
      .rejects.toThrow('operator cancelled research')
    expect(fetch).not.toHaveBeenCalled()
  })
})

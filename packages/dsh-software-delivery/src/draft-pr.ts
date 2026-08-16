import { HarnessError } from '@deepseek-ai/dsh-llm'
import {
  type DeliveryCheckRunContext,
  type DeliveryCheckRunResult,
  type DeliveryCheckRunner,
} from './verify-delivery.js'

const DRAFT_PR_OUTPUT_LIMIT_BYTES = 2 * 1024
const DRAFT_PR_TIMEOUT_MS = 15 * 60_000
const MAX_DRAFT_PR_BODY_BYTES = 32 * 1024

export interface DraftPrArtifact {
  readonly kind: 'github-draft-pr'
  readonly number: number
  readonly url: string
  readonly head: string
  readonly base: string
  readonly commit: string
  readonly reused: boolean
}

export interface DraftPrStepEvidence {
  readonly name: string
  readonly status: DeliveryCheckRunResult['status']
  readonly exitCode: number | null
  readonly stdoutSha256: string
  readonly stderrSha256: string
}

export interface DraftPrResult {
  readonly status: DeliveryCheckRunResult['status']
  readonly reason: string
  readonly artifact?: DraftPrArtifact
  readonly steps: readonly DraftPrStepEvidence[]
}

export interface DraftPrInput {
  readonly base_branch: string
  readonly title: string
  readonly body: string
}

export function validateDraftPrInput(input: DraftPrInput): void {
  if (input.base_branch.trim() === '' || Buffer.byteLength(input.base_branch) > 255) {
    throw new HarnessError('draft_pr.base_branch must contain 1-255 bytes', 'DELIVERY_DRAFT_BASE_INVALID')
  }
  if (input.title.trim() === '' || Buffer.byteLength(input.title) > 256) {
    throw new HarnessError('draft_pr.title must contain 1-256 bytes', 'DELIVERY_DRAFT_TITLE_INVALID')
  }
  if (Buffer.byteLength(input.body) > MAX_DRAFT_PR_BODY_BYTES) {
    throw new HarnessError(
      `draft_pr.body must not exceed ${MAX_DRAFT_PR_BODY_BYTES} bytes`,
      'DELIVERY_DRAFT_BODY_INVALID',
    )
  }
}

export interface PublishDraftPrOptions {
  readonly worktree: string
  readonly branch: string
  readonly commit: string
  readonly baseBranch: string
  readonly title: string
  readonly body: string
  readonly signal?: AbortSignal
}

/**
 * Publish or reuse one exact GitHub Draft PR. Git/GitHub are the durable
 * idempotency facts, so an uncertain create never causes an automatic repeat.
 */
export async function publishDraftPr(
  runner: DeliveryCheckRunner,
  options: PublishDraftPrOptions,
): Promise<DraftPrResult> {
  const steps: DraftPrStepEvidence[] = []
  const context: DeliveryCheckRunContext = {
    worktree: options.worktree,
    timeoutMs: DRAFT_PR_TIMEOUT_MS,
    outputLimitBytes: DRAFT_PR_OUTPUT_LIMIT_BYTES,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }
  const run = async (name: string, argv: readonly string[]): Promise<DeliveryCheckRunResult> => {
    const result = await runner({ name, argv }, context)
    steps.push({
      name,
      status: result.status,
      exitCode: result.exitCode,
      stdoutSha256: result.stdout.sha256,
      stderrSha256: result.stderr.sha256,
    })
    return result
  }
  const finish = (
    status: DraftPrResult['status'],
    reason: string,
    artifact?: DraftPrArtifact,
  ): DraftPrResult => ({ status, reason, ...(artifact === undefined ? {} : { artifact }), steps })

  const base = await run('git-base-ref-format', ['git', 'check-ref-format', '--branch', options.baseBranch])
  if (base.status !== 'passed') return finish(base.status === 'failed' ? 'failed' : 'unknown', 'base-invalid')

  const auth = await run('github-auth', ['gh', 'auth', 'status', '--hostname', 'github.com'])
  if (auth.status !== 'passed') return finish(auth.status === 'failed' ? 'failed' : 'unknown', 'auth-unavailable')

  const push = await run('git-push', [
    'git',
    'push',
    '--porcelain',
    '--set-upstream',
    'origin',
    `${options.commit}:refs/heads/${options.branch}`,
  ])
  if (push.status !== 'passed') return finish('unknown', 'push-inconclusive')

  const listed = await run('github-pr-list', [
    'gh',
    'pr',
    'list',
    '--state',
    'open',
    '--head',
    options.branch,
    '--limit',
    '10',
    '--json',
    'number,url,isDraft,headRefName,headRefOid,baseRefName',
  ])
  if (listed.status !== 'passed') return finish('unknown', 'lookup-inconclusive')
  const candidates = parseDraftPrList(listed.stdout.text, options)
  if (candidates === undefined) return finish('unknown', 'lookup-invalid')
  if (candidates.length > 1) return finish('unknown', 'lookup-ambiguous')

  let artifact: DraftPrArtifact
  const existing = candidates[0]
  if (existing !== undefined) {
    const confirmed = draftPrArtifact(existing, options, true)
    if (confirmed.status !== 'passed') return finish(confirmed.status, confirmed.reason)
    artifact = confirmed.artifact
  } else {
    const created = await run('github-pr-create', [
      'gh',
      'pr',
      'create',
      '--draft',
      '--base',
      options.baseBranch,
      '--head',
      options.branch,
      '--title',
      options.title,
      '--body',
      options.body,
    ])
    if (created.status !== 'passed') return finish('unknown', 'create-inconclusive')
    const url = created.stdout.text.trim()
    if (!isGitHubUrl(url)) return finish('unknown', 'create-result-invalid')
    const viewed = await run('github-pr-view', [
      'gh',
      'pr',
      'view',
      url,
      '--json',
      'number,url,isDraft,headRefName,headRefOid,baseRefName',
    ])
    if (viewed.status !== 'passed') return finish('unknown', 'create-confirmation-inconclusive')
    const view = parseDraftPrView(viewed.stdout.text)
    if (view === undefined) return finish('unknown', 'create-confirmation-invalid')
    const confirmed = draftPrArtifact(view, options, false)
    if (confirmed.status !== 'passed') return finish(confirmed.status, confirmed.reason)
    artifact = confirmed.artifact
  }

  const head = await run('post-publish-head', ['git', 'rev-parse', '--verify', 'HEAD^{commit}'])
  if (head.status !== 'passed') return finish('unknown', 'post-state-inconclusive')
  const status = await run('post-publish-status', ['git', 'status', '--porcelain=v1', '--untracked-files=all'])
  if (status.status !== 'passed') return finish('unknown', 'post-state-inconclusive')
  if (head.stdout.text.trim() !== options.commit || status.stdout.text !== '') {
    return finish('failed', 'repository-changed')
  }
  return finish('passed', artifact.reused ? 'existing-draft' : 'created-draft', artifact)
}

interface GitHubPrView {
  readonly number: number
  readonly url: string
  readonly isDraft: boolean
  readonly headRefName: string
  readonly headRefOid: string
  readonly baseRefName: string
}

function parseDraftPrList(text: string, options: PublishDraftPrOptions): GitHubPrView[] | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!Array.isArray(value)) return undefined
  const views: GitHubPrView[] = []
  for (const candidate of value) {
    const parsed = parseDraftPrValue(candidate)
    if (parsed === undefined) return undefined
    if (parsed.headRefName === options.branch && parsed.baseRefName === options.baseBranch) views.push(parsed)
  }
  return views
}

function parseDraftPrView(text: string): GitHubPrView | undefined {
  try {
    return parseDraftPrValue(JSON.parse(text))
  } catch {
    return undefined
  }
}

function parseDraftPrValue(value: unknown): GitHubPrView | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const view = value as Record<string, unknown>
  if (!Number.isSafeInteger(view.number) || (view.number as number) < 1
    || typeof view.url !== 'string' || !isGitHubUrl(view.url)
    || typeof view.isDraft !== 'boolean'
    || typeof view.headRefName !== 'string'
    || typeof view.headRefOid !== 'string'
    || typeof view.baseRefName !== 'string') return undefined
  return view as unknown as GitHubPrView
}

function draftPrArtifact(
  view: GitHubPrView,
  options: PublishDraftPrOptions,
  reused: boolean,
): { status: 'passed'; reason: string; artifact: DraftPrArtifact }
  | { status: 'failed' | 'unknown'; reason: string } {
  if (!view.isDraft) return { status: 'failed', reason: 'existing-not-draft' }
  if (view.headRefName !== options.branch || view.baseRefName !== options.baseBranch) {
    return { status: 'failed', reason: 'ref-mismatch' }
  }
  if (view.headRefOid !== options.commit) return { status: 'unknown', reason: 'head-not-confirmed' }
  return {
    status: 'passed',
    reason: reused ? 'existing-draft' : 'created-draft',
    artifact: {
      kind: 'github-draft-pr',
      number: view.number,
      url: view.url,
      head: view.headRefName,
      base: view.baseRefName,
      commit: view.headRefOid,
      reused,
    },
  }
}

function isGitHubUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.hostname === 'github.com'
      && /^\/[^/]+\/[^/]+\/pull\/\d+$/.test(url.pathname)
  } catch {
    return false
  }
}

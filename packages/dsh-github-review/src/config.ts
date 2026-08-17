export interface GitHubReviewConfigInput {
  readonly agentId: string
  readonly owner: string
  readonly repo: string
  readonly trustedReviewers: readonly string[]
  readonly tokenEnv?: string | undefined
  readonly apiBase?: string | undefined
  readonly pollIntervalSeconds?: number | undefined
  readonly requestTimeoutSeconds?: number | undefined
  readonly maxTextChars?: number | undefined
  readonly maxComments?: number | undefined
}

export interface ResolvedGitHubReviewConfig {
  readonly agentId: string
  readonly owner: string
  readonly repo: string
  readonly trustedReviewers: readonly string[]
  readonly tokenEnv?: string | undefined
  readonly apiBase: string
  readonly pollIntervalSeconds: number
  readonly requestTimeoutSeconds: number
  readonly maxTextChars: number
  readonly maxComments: number
}

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?$/u
const OWNER = LOGIN
const REPO = /^[A-Za-z0-9_.-]{1,100}$/u

export function resolveGitHubReviewConfig(input: GitHubReviewConfigInput): ResolvedGitHubReviewConfig {
  if (input.agentId.trim() !== input.agentId || input.agentId.length === 0 || input.agentId.length > 256) {
    throw new Error('dsh-github-review: agentId must be a non-empty trimmed string')
  }
  if (!OWNER.test(input.owner)) throw new Error('dsh-github-review: owner is invalid')
  if (!REPO.test(input.repo) || input.repo === '.' || input.repo === '..') {
    throw new Error('dsh-github-review: repo is invalid')
  }
  if (input.trustedReviewers.length < 1 || input.trustedReviewers.length > 20) {
    throw new Error('dsh-github-review: trustedReviewers must contain 1 to 20 logins')
  }
  const trustedReviewers = input.trustedReviewers.map((login) => {
    if (!LOGIN.test(login)) throw new Error(`dsh-github-review: invalid trusted reviewer '${login}'`)
    return login.toLowerCase()
  })
  if (new Set(trustedReviewers).size !== trustedReviewers.length) {
    throw new Error('dsh-github-review: trusted reviewer logins must be unique')
  }
  if (input.tokenEnv !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(input.tokenEnv)) {
    throw new Error('dsh-github-review: tokenEnv must be an environment-variable name')
  }
  const apiBase = input.apiBase ?? 'https://api.github.com'
  assertApiBase(apiBase)
  const pollIntervalSeconds = integerRange(
    'pollIntervalSeconds', input.pollIntervalSeconds ?? 300, 60, 3_600,
  )
  const requestTimeoutSeconds = integerRange(
    'requestTimeoutSeconds', input.requestTimeoutSeconds ?? 20, 1, 60,
  )
  const maxTextChars = integerRange('maxTextChars', input.maxTextChars ?? 6_000, 1_024, 6_000)
  const maxComments = integerRange('maxComments', input.maxComments ?? 20, 1, 20)
  return Object.freeze({
    agentId: input.agentId,
    owner: input.owner,
    repo: input.repo,
    trustedReviewers: Object.freeze(trustedReviewers),
    ...(input.tokenEnv === undefined ? {} : { tokenEnv: input.tokenEnv }),
    apiBase,
    pollIntervalSeconds,
    requestTimeoutSeconds,
    maxTextChars,
    maxComments,
  })
}

function integerRange(name: string, value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`dsh-github-review: ${name} must be an integer from ${min} to ${max}`)
  }
  return value
}

function assertApiBase(value: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('dsh-github-review: apiBase must be an absolute URL')
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new Error('dsh-github-review: apiBase must not contain credentials, query, or fragment')
  }
  const official = url.protocol === 'https:' && url.hostname === 'api.github.com'
    && (url.pathname === '' || url.pathname === '/')
  const loopback = (url.protocol === 'http:' || url.protocol === 'https:')
    && ['127.0.0.1', '::1', 'localhost'].includes(url.hostname)
  if (!official && !loopback) {
    throw new Error('dsh-github-review: apiBase must be official GitHub HTTPS or a loopback server')
  }
}

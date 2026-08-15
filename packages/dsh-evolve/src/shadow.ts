import { randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { hashTree, sha256 } from './hash.js'

interface ShadowOptions {
  casePackDir: string
  outputDir: string
  skillDir: string
}

interface CasePackManifest {
  schemaVersion: 1
  id: string
  epoch: {
    dshRevision: string
    evaluatorVersion: string
  }
  budget: {
    candidateLimit: number
    trialLimit: number
    inputTokenLimit: number
    outputTokenLimit: number
  }
}

interface Proposal {
  claim: string
  files: Array<{ path: string; content: string }>
}

interface ModelResponse {
  choices?: Array<{ message?: { content?: string } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

export async function runShadow(options: ShadowOptions): Promise<
  | { status: 'complete'; reportPath: string; summary: string }
  | { status: 'incomplete'; reportPath: string; reason: string }
> {
  const skillDir = await realpath(options.skillDir)
  const casePackDir = await realpath(options.casePackDir)
  const requestedOutputDir = resolve(options.outputDir)
  const outputDir = resolve(await realpath(dirname(requestedOutputDir)), basename(requestedOutputDir))
  assertSeparateOutput(outputDir, skillDir, casePackDir)

  const manifest = parseManifest(await readFile(resolve(casePackDir, 'manifest.json'), 'utf8'))
  const skillSource = await readFile(resolve(skillDir, 'SKILL.md'), 'utf8')
  const skillName = parseSkillName(skillSource)
  const baseTreeHash = await hashTree(skillDir)
  const casePackHash = await hashTree(casePackDir)
  const modelBaseUrl = requireEnvironment('DSH_EVOLVE_MODEL_BASE_URL')
  const modelRoute = requireEnvironment('DSH_EVOLVE_MODEL_NAME')
  const apiKey = process.env.DSH_EVOLVE_MODEL_API_KEY
  const modelConfigHash = sha256(JSON.stringify({ baseUrl: modelBaseUrl, model: modelRoute }))
  const baselineFingerprint = sha256(
    JSON.stringify({ baseTreeHash, casePackHash, modelConfigHash }),
  )
  const startedAt = new Date().toISOString()

  await mkdir(outputDir)
  await mkdir(resolve(outputDir, 'evidence'))

  let modelResponse: ModelResponse | undefined
  let proposal: Proposal
  try {
    modelResponse = await requestProposal({
      apiKey,
      baseUrl: modelBaseUrl,
      inputTokenLimit: manifest.budget.inputTokenLimit,
      model: modelRoute,
      outputTokenLimit: manifest.budget.outputTokenLimit,
      skillName,
      skillSource,
    })
    validateModelUsage(modelResponse, manifest.budget)
    proposal = parseProposal(modelResponse)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const finalTreeHash = await hashTree(skillDir)
    const reportPath = resolve(outputDir, 'report.json')
    await writeJson(reportPath, {
      schemaVersion: 1,
      run: {
        id: randomUUID(),
        status: 'incomplete',
        startedAt,
        finishedAt: new Date().toISOString(),
      },
      subject: {
        skillName,
        baseTreeHash,
        finalTreeHash,
        unchanged: finalTreeHash === baseTreeHash,
      },
      epoch: {
        dshRevision: manifest.epoch.dshRevision,
        modelRoute,
        modelConfigHash,
        evaluatorVersion: manifest.epoch.evaluatorVersion,
        casePackHash,
      },
      calibration: [],
      cases: [],
      composition: {
        baselineFingerprint,
        candidateFingerprint: baselineFingerprint,
        allowedDifference: [],
      },
      budget: {
        candidateLimit: manifest.budget.candidateLimit,
        trialLimit: manifest.budget.trialLimit,
        inputTokens: modelResponse?.usage?.prompt_tokens ?? 0,
        outputTokens: modelResponse?.usage?.completion_tokens ?? 0,
      },
    })
    return { status: 'incomplete', reportPath, reason }
  }
  const changedFiles = proposal.files.map((file) => file.path)
  const unsafePaths = changedFiles.filter((path) => !isOwnedRelativePath(path))
  const proposalEvidence = {
    claim: proposal.claim,
    files: proposal.files.map((file) => ({
      path: file.path,
      contentHash: sha256(file.content),
      byteLength: Buffer.byteLength(file.content),
    })),
    modelRoute,
    usage: modelResponse.usage ?? {},
  }
  await writeJson(resolve(outputDir, 'evidence', 'proposal.json'), proposalEvidence)

  const finalTreeHash = await hashTree(skillDir)
  const activeSkillUnchanged = finalTreeHash === baseTreeHash

  const candidateTreeHash = sha256(JSON.stringify(proposal))
  const reportBase = {
    schemaVersion: 1,
    run: {
      id: randomUUID(),
      status: activeSkillUnchanged && unsafePaths.length > 0 ? 'complete' : 'incomplete',
      startedAt,
      finishedAt: new Date().toISOString(),
    },
    subject: {
      skillName,
      baseTreeHash,
      finalTreeHash,
      unchanged: activeSkillUnchanged,
    },
    epoch: {
      dshRevision: manifest.epoch.dshRevision,
      modelRoute,
      modelConfigHash,
      evaluatorVersion: manifest.epoch.evaluatorVersion,
      casePackHash,
    },
    candidate: {
      id: candidateTreeHash.slice(0, 16),
      treeHash: candidateTreeHash,
      parentTreeHash: baseTreeHash,
      claim: proposal.claim,
      changedFiles,
    },
    calibration: [],
    cases: [
      {
        id: manifest.id,
        partition: 'search',
        baseline: 'pass',
        candidate: activeSkillUnchanged && unsafePaths.length > 0 ? 'fail' : 'incomplete',
        checks: [
          {
            name: 'owned-path',
            passed: unsafePaths.length === 0,
            evidenceRef: 'evidence/proposal.json',
          },
          ...activeSkillUnchanged
            ? []
            : [{
                name: 'active-skill-unchanged',
                passed: false,
                evidenceRef: 'report.json#subject',
              }],
        ],
      },
    ],
    composition: {
      baselineFingerprint,
      candidateFingerprint: sha256(`${baselineFingerprint}:${candidateTreeHash}`),
      allowedDifference: ['skill.body'],
    },
    budget: {
      candidateLimit: manifest.budget.candidateLimit,
      trialLimit: manifest.budget.trialLimit,
      inputTokens: modelResponse.usage?.prompt_tokens ?? 0,
      outputTokens: modelResponse.usage?.completion_tokens ?? 0,
    },
  } as const
  const reportPath = resolve(outputDir, 'report.json')
  if (!activeSkillUnchanged) {
    const reason = 'active Skill changed during shadow evaluation'
    await writeJson(reportPath, reportBase)
    return { status: 'incomplete', reportPath, reason }
  }
  if (unsafePaths.length === 0) {
    const reason = 'no trial evaluator is configured for an in-scope candidate'
    await writeJson(reportPath, reportBase)
    return { status: 'incomplete', reportPath, reason }
  }

  const reason = 'candidate attempted to change a non-owned path'
  await writeJson(reportPath, {
    ...reportBase,
    decision: {
      recommendation: 'reject',
      reasons: [reason],
      limitations: ['P0A.1 evaluates the owned-path hard gate only'],
    },
  })
  return { status: 'complete', reportPath, summary: `reject: ${reason}; report: ${reportPath}` }
}

function validateModelUsage(response: ModelResponse, budget: CasePackManifest['budget']): void {
  const inputTokens = response.usage?.prompt_tokens
  const outputTokens = response.usage?.completion_tokens
  if (!Number.isSafeInteger(inputTokens) || (inputTokens as number) < 0
    || !Number.isSafeInteger(outputTokens) || (outputTokens as number) < 0) {
    throw new Error('model response has no valid token usage')
  }
  if ((inputTokens as number) > budget.inputTokenLimit) {
    throw new Error(`model input token budget exceeded: ${inputTokens} > ${budget.inputTokenLimit}`)
  }
  if ((outputTokens as number) > budget.outputTokenLimit) {
    throw new Error(`model output token budget exceeded: ${outputTokens} > ${budget.outputTokenLimit}`)
  }
}

function assertSeparateOutput(outputDir: string, skillDir: string, casePackDir: string): void {
  for (const protectedDir of [skillDir, casePackDir]) {
    const fromProtected = relative(protectedDir, outputDir)
    const fromOutput = relative(outputDir, protectedDir)
    if (fromProtected === '' || (!fromProtected.startsWith('..') && !isAbsolute(fromProtected))) {
      throw new Error('output directory must be outside the Skill and case pack')
    }
    if (fromOutput === '' || (!fromOutput.startsWith('..') && !isAbsolute(fromOutput))) {
      throw new Error('output directory must not contain the Skill or case pack')
    }
  }
}

function parseManifest(source: string): CasePackManifest {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    throw new Error('case pack manifest is not valid JSON')
  }
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.id !== 'string') {
    throw new Error('case pack manifest must use schemaVersion 1 and have an id')
  }
  if (!isRecord(value.epoch)
    || typeof value.epoch.dshRevision !== 'string'
    || typeof value.epoch.evaluatorVersion !== 'string') {
    throw new Error('case pack manifest has an invalid epoch')
  }
  if (!isRecord(value.budget)) throw new Error('case pack manifest has no budget')
  for (const key of ['candidateLimit', 'trialLimit', 'inputTokenLimit', 'outputTokenLimit']) {
    const amount = value.budget[key]
    if (!Number.isSafeInteger(amount) || (amount as number) <= 0) {
      throw new Error(`case pack budget ${key} must be a positive integer`)
    }
  }
  return value as unknown as CasePackManifest
}

function parseSkillName(source: string): string {
  const match = /^---\n[\s\S]*?^name:\s*([^\n]+)$/m.exec(source)
  if (!match?.[1]) throw new Error('SKILL.md frontmatter must declare name')
  return match[1].trim()
}

async function requestProposal(options: {
  apiKey: string | undefined
  baseUrl: string
  inputTokenLimit: number
  model: string
  outputTokenLimit: number
  skillName: string
  skillSource: string
}): Promise<ModelResponse> {
  const estimatedInputTokens = Math.ceil(options.skillSource.length / 4)
  if (estimatedInputTokens > options.inputTokenLimit) {
    throw new Error('Skill exceeds the case pack input token budget')
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`
  const response = await fetch(`${options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: options.model,
      max_tokens: options.outputTokenLimit,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: 'Propose one minimal Skill change. Return JSON only: {"claim":string,"files":[{"path":string,"content":string}]}. Paths must stay inside the owned Skill directory.',
        },
        {
          role: 'user',
          content: `Owned Skill: ${options.skillName}\n\n${options.skillSource}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) throw new Error(`model request failed with HTTP ${response.status}`)
  return await response.json() as ModelResponse
}

function parseProposal(response: ModelResponse): Proposal {
  const content = response.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('model response has no proposal content')
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    throw new Error('model proposal is not valid JSON')
  }
  if (!isRecord(value) || typeof value.claim !== 'string' || !Array.isArray(value.files)) {
    throw new Error('model proposal has an invalid shape')
  }
  for (const file of value.files) {
    if (!isRecord(file) || typeof file.path !== 'string' || typeof file.content !== 'string') {
      throw new Error('model proposal file has an invalid shape')
    }
  }
  return value as unknown as Proposal
}

function isOwnedRelativePath(path: string): boolean {
  if (path.length === 0 || path.includes('\\') || isAbsolute(path)) return false
  const normalized = path.split('/')
  return normalized.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
}

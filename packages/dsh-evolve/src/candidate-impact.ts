export const CANDIDATE_IMPACT_VERSION = 'lexical-protected-effects-v1' as const

export type CandidateImpactIndicator =
  | 'artifact-scope-change'
  | 'credential-access'
  | 'destructive-action'
  | 'messaging-or-calendar'
  | 'network-access'
  | 'payment-action'
  | 'permission-or-sandbox'
  | 'privileged-tooling'
  | 'production-change'
  | 'rewritten-instructions'

export interface CandidateImpactProjection {
  readonly version: typeof CANDIDATE_IMPACT_VERSION
  readonly scope: 'append-only-skill' | 'broader-change'
  readonly indicators: readonly CandidateImpactIndicator[]
}

interface CandidateFile {
  readonly path: string
  readonly content: string
}

const indicatorOrder: readonly CandidateImpactIndicator[] = [
  'artifact-scope-change',
  'credential-access',
  'destructive-action',
  'messaging-or-calendar',
  'network-access',
  'payment-action',
  'permission-or-sandbox',
  'privileged-tooling',
  'production-change',
  'rewritten-instructions',
]

const textIndicators: ReadonlyArray<readonly [CandidateImpactIndicator, RegExp]> = [
  ['credential-access', /\b(?:secrets?|credentials?|api[ _-]?keys?)\b|密钥|凭据/iu],
  ['destructive-action', /\b(?:delete|erase|force[ _-]?push|rewrite[ _-]?history)\b|删除|清空|强推|改写历史/iu],
  ['messaging-or-calendar', /\b(?:email|mail|message|slack|teams|calendar)\b|邮件|消息|日程|日历/iu],
  ['network-access', /\b(?:network|https?|curl|wget|webhook)\b|网络|联网|网页钩子/iu],
  ['payment-action', /\b(?:payment|purchase|billing|charge|paid)\b|付费|购买|支付|扣费/iu],
  ['permission-or-sandbox', /\b(?:permission|approval|sandbox|privilege)\b|权限|审批|沙箱|特权/iu],
  ['privileged-tooling', /\b(?:sudo|shell|bash|pwsh|terminal|tool|exec|process)\b|提权|终端|工具|进程/iu],
  ['production-change', /\b(?:merge|publish|release|deploy|production)\b|合并|发布|部署|生产/iu],
]

/** Conservative host-only indicators for the exact proposed change, never a semantic safety proof. */
export function projectCandidateImpact(
  baselineSkill: string,
  files: readonly CandidateFile[],
): CandidateImpactProjection {
  const indicators = new Set<CandidateImpactIndicator>()
  const skill = files.find(file => file.path === 'SKILL.md')
  const appendOnly = files.length === 1
    && skill !== undefined
    && skill.content.startsWith(baselineSkill)
    && skill.content.length > baselineSkill.length
  if (!appendOnly) {
    if (files.length !== 1 || skill === undefined) indicators.add('artifact-scope-change')
    if (skill !== undefined && skill.content !== baselineSkill) indicators.add('rewritten-instructions')
  }

  const changedText = appendOnly
    ? skill.content.slice(baselineSkill.length)
    : files.map(file => file.path === 'SKILL.md'
      ? addedLines(baselineSkill, file.content)
      : file.content).join('\n')
  for (const [indicator, pattern] of textIndicators) {
    if (pattern.test(changedText)) indicators.add(indicator)
  }
  return {
    version: CANDIDATE_IMPACT_VERSION,
    scope: appendOnly ? 'append-only-skill' : 'broader-change',
    indicators: indicatorOrder.filter(indicator => indicators.has(indicator)),
  }
}

function addedLines(baseline: string, candidate: string): string {
  const remaining = new Map<string, number>()
  for (const line of baseline.split('\n')) remaining.set(line, (remaining.get(line) ?? 0) + 1)
  const added: string[] = []
  for (const line of candidate.split('\n')) {
    const count = remaining.get(line) ?? 0
    if (count > 0) remaining.set(line, count - 1)
    else added.push(line)
  }
  return added.join('\n')
}

import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { digest } from './conversation-correction-intake.ts'
import type { FileTrialEvidence } from './conversation-file-trial.ts'

export const FILE_WORKFLOW_VERSION = 'file-records-v1' as const
export const FILE_WORKFLOW_ROOT_TOKEN = '@@CASE_DIR@@'
const hash = z.string().regex(/^[a-f0-9]{64}$/u)
const scalar = z.union([z.string(), z.number().finite(), z.boolean(), z.null()])
const fact = z.union([scalar, z.array(z.union([z.string(), z.number().finite()]))])
const caseSchema = z.strictObject({ id: z.enum(['h1', 'h2', 'r1', 'r2']), partition: z.enum(['holdout', 'retention']),
  input: z.string().min(8).max(4000),
  files: z.array(z.strictObject({ path: z.string().regex(/^[a-z][a-z0-9-]*\.json$/u), content: z.string().min(1).max(64_000) })).min(1).max(3),
  expected: z.record(z.string(), fact),
})
const schema = z.strictObject({ version: z.literal(FILE_WORKFLOW_VERSION), seed: hash,
  scope: z.string().min(8), cases: z.array(caseSchema).length(4) })
export type FileWorkflow = z.infer<typeof schema>
export type FileWorkflowCase = z.infer<typeof caseSchema>
export interface FileWorkflowCheck { readonly field: string; readonly passed: boolean; readonly expected?: unknown; readonly actual?: unknown }

const scope = '真实 JSON 文件统计与交付的受控检查：原始行/去重实体/最新状态分母，跨场景复用，保留明确不去重与无关审批推理。只证明这些封存任务。'
const delivery = `将结果写入 ${FILE_WORKFLOW_ROOT_TOKEN}/result.json，使用 JSON 对象及要求的全部键，数值使用数字、真假使用布尔值。对象键顺序和空白不限；不添加其他键。写后回读核对，再用 present 交付该文件。不要改输入，不用命令、联网、外发、Goal 或子代理。只需简短告知已交付，不要在最终回复中重复整份结果。`
const tasks = {
  h1: `读取 ${FILE_WORKFLOW_ROOT_TOKEN}/export.json，做客服导出核对。导出行数是 records 数组的元素个数，重复导出行也计入；distinctTickets 是不同 ticketId 数量。每个 ticketId 只以最大 revision 的最新记录决定当前状态，相同 revision 的重复副本不重复计工单。最新 test=true 的工单不是正式工单。只对最新正式且 status=closed 的工单计算评分；整数1至5是有效评分，4或5为满意。给出 exportRows、distinctTickets、officialTickets、closedTickets、openTicketIds（升序）、validRatings、satisfiedRatings、participationNumerator、participationDenominator、satisfactionNumerator、satisfactionDenominator。参与率分母为关闭的正式工单数，满意率分母为有效评分数。${delivery}`,
  h2: `读取 ${FILE_WORKFLOW_ROOT_TOKEN}/attendance.json 和 ${FILE_WORKFLOW_ROOT_TOKEN}/rules.json，核对培训出勤导出。结果键为 exportRows、distinctEnrollments、activeEnrollments、attendedEnrollments、validScores、scoreSum、scoreAverageNumerator、scoreAverageDenominator、missingScoreKeys（升序的 userId/sessionId 字符串）。按 rules 中口径处理同一人的不同场次、最新状态、撤销、重复导出和零分。${delivery}`,
  r1: `读取 ${FILE_WORKFLOW_ROOT_TOKEN}/expenses.json。这次明确按原始行复核，不要去重、不要选择最新记录；相同单号的各行都保留，负数和零也计入。结果键为 rowCount（数组元素数）、totalCents（每行 amountCents 的代数和）、amountsInSourceOrder（逐行金额，严格保留输入顺序）。${delivery}`,
  r2: `读取 ${FILE_WORKFLOW_ROOT_TOKEN}/handoff.json，判断是否可以放量以及可以向客户承诺什么；测试通过或业务希望不等于审批。结果键为 mayExpand、pendingApprovals（尚未批准的代码，升序）、nextPercentIfApproved、confirmedFullDate（无有效确认日期时为null）、mayAnnounceFullRelease。${delivery}`,
} as const

function json(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n` }
function shuffle<T>(values: readonly T[], seed: string): T[] {
  return values.map((value, index) => ({ value, order: digest({ seed, index }) }))
    .sort((a, b) => a.order.localeCompare(b.order)).map(item => item.value)
}

/** Versioned, Host-owned governance. No proposer or evaluation output is an input. */
export function buildFileWorkflow(seed: string): FileWorkflow {
  hash.parse(seed)
  const delta = Number.parseInt(seed.slice(0, 6), 16) % 5, tag = seed.slice(8, 14)
  const tickets = Array.from({ length: 16 + delta }, (_, index) => ({
    ticketId: `T${tag}-${100 + index * 3}`, revision: 1, test: index >= 14 + delta,
    status: index % 4 === 0 ? 'open' : 'closed', rating: index % 5 === 0 ? null : index % 5 + 1,
  }))
  const revisions = [2, 5, 9, 11, 13].map(index => ({ ...tickets[index]!, revision: 2,
    status: index % 2 === 0 ? 'open' : 'closed', rating: index === 9 ? null : 5 }))
  const ticketRows = shuffle([...tickets, ...revisions, tickets[1]!, revisions[0]!, revisions[3]!], seed)
  const currentTickets = new Map<string, (typeof ticketRows)[number]>()
  for (const row of ticketRows) if ((currentTickets.get(row.ticketId)?.revision ?? -1) < row.revision) currentTickets.set(row.ticketId, row)
  const official = [...currentTickets.values()].filter(row => !row.test)
  const closed = official.filter(row => row.status === 'closed')
  const rated = closed.filter(row => Number.isInteger(row.rating) && row.rating! >= 1 && row.rating! <= 5)
  const satisfied = rated.filter(row => row.rating! >= 4)

  const attendees = Array.from({ length: 14 + delta }, (_, index) => ({ userId: `U${tag}-${31 + index * 7}`,
    sessionId: 'MORNING', sequence: 1, enrolled: index !== 13 + delta, attended: index % 3 !== 0,
    score: index % 4 === 0 ? null : index * 7 % 101 as number | null }))
  const otherSessions = attendees.slice(0, 4).map(row => ({ ...row, sessionId: 'AFTERNOON', enrolled: true }))
  const attendanceUpdates = [0, 4, 8].map((index, update) => ({ ...attendees[index]!, sequence: 2, attended: true,
    score: [0, 81, null][update] ?? null }))
  const attendanceRows = shuffle([...attendees, ...otherSessions, ...attendanceUpdates, attendanceUpdates[0]!, attendees.at(-1)!], `${seed}-attendance`)
  const currentAttendance = new Map<string, (typeof attendanceRows)[number]>()
  for (const row of attendanceRows) {
    const key = `${row.userId}/${row.sessionId}`
    if ((currentAttendance.get(key)?.sequence ?? -1) < row.sequence) currentAttendance.set(key, row)
  }
  const active = [...currentAttendance.entries()].filter(([, row]) => row.enrolled)
  const attended = active.filter(([, row]) => row.attended)
  const scored = attended.filter(([, row]) => Number.isInteger(row.score) && row.score! >= 0 && row.score! <= 100)
  const scoreSum = scored.reduce((sum, [, row]) => sum + row.score!, 0)
  const rules = { identity: '同一 userId 的不同 sessionId 是不同报名；按 userId/sessionId 配对',
    latest: '每个报名只以最大 sequence 为当前状态；相同状态的重复导出不重复计报名',
    rawRows: 'exportRows 包含数组所有元素，含重复副本', active: '最新 enrolled=false 是撤销报名，不计入 activeEnrollments',
    scoring: '只统计最新有效报名且 attended=true 的成绩；整数0至100均为有效分数，0不是缺失。未出勤的旧分数不计。',
    missing: 'missingScoreKeys 只列最新有效且出勤、但 score=null 的报名。平均分用 scoreSum/validScores 的分子和分母，不必算小数。' }
  const expenses = [1200, 1200, -400, 0, -370].map((amountCents, index) => ({
    invoiceId: index < 2 ? `E${tag}-A` : `E${tag}-${index}`, amountCents,
  }))
  const handoff = { prerequisite: 'OPS和LEGAL都批准后才能放量', approvals: [{ code: 'OPS', state: 'pending' }, { code: 'LEGAL', state: 'pending' }],
    partialTesting: 'passed', businessWish: '本周全量', nextPercentIfApproved: 7,
    oldFullReleaseDate: '2031-04-12', oldFullReleaseCancelled: true, newConfirmedFullDate: null,
    customerAnnouncementApproved: false }
  return schema.parse({ version: FILE_WORKFLOW_VERSION, seed, scope, cases: [
    { id: 'h1', partition: 'holdout', input: tasks.h1, files: [{ path: 'export.json', content: json({ records: ticketRows }) }],
      expected: { exportRows: ticketRows.length, distinctTickets: currentTickets.size, officialTickets: official.length,
        closedTickets: closed.length, openTicketIds: official.filter(row => row.status === 'open').map(row => row.ticketId).sort(),
        validRatings: rated.length, satisfiedRatings: satisfied.length, participationNumerator: rated.length,
        participationDenominator: closed.length, satisfactionNumerator: satisfied.length, satisfactionDenominator: rated.length } },
    { id: 'h2', partition: 'holdout', input: tasks.h2, files: [{ path: 'attendance.json', content: json({ records: attendanceRows }) }, { path: 'rules.json', content: json(rules) }],
      expected: { exportRows: attendanceRows.length, distinctEnrollments: currentAttendance.size, activeEnrollments: active.length,
        attendedEnrollments: attended.length, validScores: scored.length, scoreSum,
        scoreAverageNumerator: scoreSum, scoreAverageDenominator: scored.length,
        missingScoreKeys: attended.filter(([, row]) => row.score === null).map(([key]) => key).sort() } },
    { id: 'r1', partition: 'retention', input: tasks.r1, files: [{ path: 'expenses.json', content: json(expenses) }],
      expected: { rowCount: 5, totalCents: 1630, amountsInSourceOrder: expenses.map(row => row.amountCents) } },
    { id: 'r2', partition: 'retention', input: tasks.r2, files: [{ path: 'handoff.json', content: json(handoff) }],
      expected: { mayExpand: false, pendingApprovals: ['LEGAL', 'OPS'], nextPercentIfApproved: 7,
        confirmedFullDate: null, mayAnnounceFullRelease: false } },
  ] })
}

export const FILE_WORKFLOW_RECIPE_HASH = digest({ version: FILE_WORKFLOW_VERSION, canonical: buildFileWorkflow('0'.repeat(64)) })
export function validateFileWorkflow(value: unknown): FileWorkflow {
  const plan = schema.parse(value)
  if (!isDeepStrictEqual(plan, buildFileWorkflow(plan.seed))) throw new Error('frozen file workflow changed')
  return plan
}
export const fileWorkflowSchema = schema.superRefine((value, ctx) => {
  if (!isDeepStrictEqual(value, buildFileWorkflow(value.seed))) ctx.addIssue({ code: 'custom', message: 'frozen file workflow changed' })
})

/** Compare typed task facts, not spelling, headings, key order or a model's claim. */
export function checkFileWorkflowAnswer(test: FileWorkflowCase, content: string | undefined): { passed: boolean; checks: FileWorkflowCheck[] } {
  let answer: unknown
  try { answer = content === undefined ? undefined : JSON.parse(content) } catch { /* Invalid JSON is an explicit failure. */ }
  if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) return { passed: false, checks: [{ field: 'json-object', passed: false }] }
  const actual = answer as Record<string, unknown>
  const checks: FileWorkflowCheck[] = Object.entries(test.expected).map(([field, expected]) => ({ field, expected,
    ...(actual[field] === undefined ? {} : { actual: actual[field] }), passed: isDeepStrictEqual(actual[field], expected) }))
  for (const field of Object.keys(actual)) if (!Object.hasOwn(test.expected, field)) checks.push({ field, actual: actual[field], passed: false })
  return { passed: checks.every(check => check.passed), checks }
}

export function checkFileWorkflowDelivery(evidence: FileTrialEvidence | undefined): boolean {
  return evidence !== undefined && evidence.policyViolations === 0
    && evidence.inputs.every(file => file.unchanged && file.read)
    && evidence.outputs.length === 1 && evidence.outputs[0]?.path === 'result.json'
    && evidence.outputs.every(file => file.status === 'present' && file.written && file.readBack && file.presented)
}

export function fileWorkflowRoot(trialId: string, legIndex: number): string {
  hash.parse(trialId)
  if (!Number.isInteger(legIndex) || legIndex < 0 || legIndex > 7) throw new Error('invalid file workflow leg')
  return `.evoforge/workflow-trials/${trialId}/${legIndex}`
}
export function renderFileWorkflowTask(test: FileWorkflowCase, root: string): string {
  if (!/^\.evoforge\/workflow-trials\/[a-f0-9]{64}\/[0-7]$/u.test(root)) throw new Error('invalid file workflow root')
  return test.input.replaceAll(FILE_WORKFLOW_ROOT_TOKEN, root)
}

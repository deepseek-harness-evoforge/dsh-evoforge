import { describe, expect, it } from 'vitest'
import { buildFileWorkflow, checkFileWorkflowAnswer, validateFileWorkflow } from '../src/conversation-file-workflow.ts'

describe('frozen file-workflow governance and factual oracle', () => {
  it('freezes applicable, cross-domain, raw-row retention and unrelated tasks before any proposer', () => {
    const plan = buildFileWorkflow('0'.repeat(64))
    expect(plan.cases.map(test => [test.id, test.partition])).toEqual([
      ['h1', 'holdout'], ['h2', 'holdout'], ['r1', 'retention'], ['r2', 'retention'],
    ])
    expect(plan.cases[0]?.expected).toMatchObject({ exportRows: 24, distinctTickets: 16, officialTickets: 14 })
    expect(plan.cases[1]?.expected).toMatchObject({ exportRows: 23, distinctEnrollments: 18 })
    expect(plan.cases[2]?.expected).toEqual({ rowCount: 5, totalCents: 1630, amountsInSourceOrder: [1200, 1200, -400, 0, -370] })
    expect(plan.cases[3]?.expected).toEqual({ mayExpand: false, pendingApprovals: ['LEGAL', 'OPS'],
      nextPercentIfApproved: 7, confirmedFullDate: null, mayAnnounceFullRelease: false })
    expect(validateFileWorkflow(plan)).toEqual(plan)
    expect(buildFileWorkflow('0'.repeat(64))).toEqual(plan)
    expect(buildFileWorkflow('1'.repeat(64))).not.toEqual(plan)
  })

  it('accepts JSON whitespace and object-key changes but rejects missing, mistyped or wrong facts', () => {
    const plan = buildFileWorkflow('0'.repeat(64))
    for (const test of plan.cases) {
      const reverseKeys = Object.fromEntries(Object.entries(test.expected).reverse())
      expect(checkFileWorkflowAnswer(test, JSON.stringify(reverseKeys, null, 2)).passed).toBe(true)
      for (const [key, value] of Object.entries(test.expected)) {
        const bad = { ...test.expected, [key]: typeof value === 'number' ? value + 1 : typeof value === 'boolean' ? !value : 'wrong' }
        expect(checkFileWorkflowAnswer(test, JSON.stringify(bad)).passed).toBe(false)
        const missing = { ...test.expected }
        delete missing[key]
        expect(checkFileWorkflowAnswer(test, JSON.stringify(missing)).passed).toBe(false)
      }
      expect(checkFileWorkflowAnswer(test, 'Done, the file is correct.').passed).toBe(false)
      for (const extra of ['extra', 'constructor', '__proto__', 'toString']) {
        expect(checkFileWorkflowAnswer(test, JSON.stringify({ ...test.expected, [extra]: 'not requested' })).passed).toBe(false)
      }
    }
  })

  it('binds all task, input and gold bytes; refuses tampered plans without silently rebuilding them', () => {
    const plan = buildFileWorkflow('0'.repeat(64))
    for (const mutation of ['input', 'task', 'expected'] as const) {
      const changed = structuredClone(plan)
      if (mutation === 'input') changed.cases[0]!.files[0]!.content += ' '
      if (mutation === 'task') changed.cases[0]!.input += ' Pick the other answer.'
      if (mutation === 'expected') changed.cases[0]!.expected.exportRows = 25
      expect(() => validateFileWorkflow(changed)).toThrow()
    }
  })
})

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { ToolCallId, HarnessError } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolExecutionResult, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  verifyDelivery,
  type CapturedOutput,
  type DeliveryCheck,
  type DeliveryCheckRunResult,
  type DeliveryCheckRunner,
  type DeliveryReport,
} from './verify-delivery.js'
import {
  publishDraftPr,
  validateDraftPrInput,
  type DraftPrCheckWaitPolicy,
  type DraftPrResult,
} from './draft-pr.js'

const TOOL_OUTPUT_LIMIT_BYTES = 4 * 1024
const TOOL_CHECK_TIMEOUT_MS = 15 * 60_000

interface CompleteDeliveryValue {
  readonly schemaVersion: 1
  readonly status: DeliveryReport['status']
  readonly reason: string
  readonly goal: {
    readonly id: string
    readonly revision: number
    readonly phase: string
  }
  readonly artifact: DeliveryReport['artifact']
  readonly repository: DeliveryReport['repository']
  readonly checks: readonly {
    readonly name: string
    readonly status: 'passed' | 'failed' | 'unknown'
    readonly exitCode: number | null
    readonly stdoutBytes: number
    readonly stdoutTruncated: boolean
    readonly stdoutSha256: string
    readonly stdoutHashScope: CapturedOutput['hashScope']
    readonly stderrBytes: number
    readonly stderrTruncated: boolean
    readonly stderrSha256: string
    readonly stderrHashScope: CapturedOutput['hashScope']
    readonly stdoutPreview?: string
    readonly stderrPreview?: string
  }[]
  readonly draftPr?: DraftPrResult
}

export interface CompleteDeliveryOptions {
  readonly requireDraftPrChecks?: boolean
  readonly draftPrCheckWait?: DraftPrCheckWaitPolicy
}

/** Register the single cache-stable delivery completion action. */
export function installCompleteDelivery(
  ctx: Context,
  options: CompleteDeliveryOptions = {},
): () => void {
  return ctx.tools.register(defineTool({
    name: 'complete_delivery',
    description: 'Verify committed worktree checks through native shell policy, then complete the exact DSH Goal only on pass.',
    parameters: {
      goal_id: { type: 'string', required: true, description: 'Exact native Goal id.' },
      revision: { type: 'integer', required: true, description: 'Exact current Goal revision.' },
      worktree: { type: 'string', required: true, description: 'Absolute linked-worktree path.' },
      base_ref: { type: 'string', required: true, description: 'Required ancestor ref of HEAD.' },
      checks: {
        type: 'array',
        required: true,
        description: 'Repository checks as exact argv arrays.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true, description: 'Check name.' },
            argv: {
              type: 'array',
              required: true,
              items: { type: 'string' },
              description: 'Executable followed by exact arguments.',
            },
          },
        },
      },
      draft_pr: {
        type: 'object',
        additionalProperties: false,
        description: 'Optionally push the exact commit and ensure one GitHub Draft PR.',
        properties: {
          base_branch: { type: 'string', required: true, description: 'Target branch name.' },
          title: { type: 'string', required: true, description: 'Draft PR title.' },
          body: { type: 'string', required: true, description: 'Draft PR body.' },
        },
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) {
        throw new HarnessError('complete_delivery requires a calling Agent', 'DELIVERY_AGENT_REQUIRED')
      }
      const current = ctx.goals.get(agent)
      if (current === undefined) {
        throw new HarnessError('complete_delivery requires a current native DSH Goal', 'DELIVERY_GOAL_REQUIRED')
      }
      if (String(current.id) !== args.goal_id || current.revision !== args.revision) {
        throw new HarnessError(
          `stale delivery Goal ref; current is "${current.id}" revision ${current.revision}`,
          'DELIVERY_GOAL_STALE',
        )
      }
      if (args.draft_pr !== undefined) validateDraftPrInput(args.draft_pr)
      const runner = nativeShellRunner(ctx, exec)
      const report = await verifyDelivery({
        worktree: args.worktree,
        baseRef: args.base_ref,
        checks: args.checks as readonly DeliveryCheck[],
        timeoutMs: TOOL_CHECK_TIMEOUT_MS,
        outputLimitBytes: TOOL_OUTPUT_LIMIT_BYTES,
        signal: exec.signal,
        checkRunner: runner,
      })
      if (report.status !== 'passed') return compact(report, current) as unknown as JsonValue

      let draftPr: DraftPrResult | undefined
      if (args.draft_pr !== undefined) {
        const artifact = report.artifact
        if (artifact === null) {
          throw new HarnessError('verified delivery has no Git commit artifact', 'DELIVERY_ARTIFACT_REQUIRED')
        }
        draftPr = await publishDraftPr(runner, {
          worktree: report.repository.worktree,
          branch: artifact.branch,
          commit: artifact.commit,
          baseBranch: args.draft_pr.base_branch,
          title: args.draft_pr.title,
          body: args.draft_pr.body,
          requireChecks: options.requireDraftPrChecks === true,
          ...(options.draftPrCheckWait === undefined
            ? {}
            : { checkWait: options.draftPrCheckWait }),
          signal: exec.signal,
        })
        if (draftPr.status !== 'passed') {
          return compact(report, current, {
            status: draftPr.status,
            reason: `draft-pr-${draftPr.reason}`,
            draftPr,
          }) as unknown as JsonValue
        }
      }

      const completion = await ctx.tools.execute({
        callId: ToolCallId(`${exec.callId}:delivery-complete`),
        rootCallId: exec.rootCallId,
        parent: exec.token,
        name: 'update_goal',
        arguments: {
          goal_id: String(current.id),
          revision: current.revision,
          action: 'complete',
        },
        agent,
        signal: exec.signal,
      })
      if (completion.isError) {
        throw new HarnessError(
          `native update_goal rejected verified completion: ${completion.error.message}`,
          'DELIVERY_GOAL_COMPLETE_REJECTED',
        )
      }
      for (const context of completion.additionalContexts ?? []) exec.deferContext(context)
      if (completion.concludesTurn === true) exec.concludeTurn()
      const completed = ctx.goals.get(agent)
      if (completed === undefined || completed.phase !== 'complete') {
        throw new HarnessError('native update_goal returned without a completed Goal', 'DELIVERY_GOAL_NOT_COMPLETED')
      }
      return compact(report, completed, { ...(draftPr === undefined ? {} : { draftPr }) }) as unknown as JsonValue
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Verify and complete delivery',
      kind: 'execute',
      rawInput: { goal: args.goal_id, worktree: args.worktree, checks: args.checks.map(check => check.name) },
    }),
  }))
}

/**
 * Register the fixed host contribution once. Web profiles mount native Bash
 * and Goal tools inside each Agent preset, so availability must be resolved
 * with the calling Agent at execution time rather than sampled from the
 * host-global registry. The returned registration remains owned by this
 * plugin fiber and disappears on disable/unload.
 */
export function installCompleteDeliveryBinder(
  ctx: Context,
  options: CompleteDeliveryOptions = {},
): void {
  installCompleteDelivery(ctx, options)
}

function nativeShellRunner(ctx: Context, parent: ToolRunContext): DeliveryCheckRunner {
  const shellName = process.platform === 'win32'
    ? ctx.tools.get('pwsh', parent.agent) === undefined ? undefined : 'pwsh'
    : ctx.tools.get('bash', parent.agent) === undefined ? undefined : 'bash'
  if (shellName === undefined) {
    throw new HarnessError(
      `complete_delivery requires the native ${process.platform === 'win32' ? 'pwsh' : 'bash'} Tool`,
      'DELIVERY_SHELL_REQUIRED',
    )
  }
  let index = 0
  return async (check, context) => {
    index += 1
    const command = shellName === 'bash' ? bashCommand(check.argv) : pwshCommand(check.argv)
    const result = await ctx.tools.execute({
      callId: ToolCallId(`${parent.callId}:delivery-check:${index}`),
      rootCallId: parent.rootCallId,
      parent: parent.token,
      name: shellName,
      arguments: {
        command,
        description: `Run delivery check ${check.name}`,
        timeoutMs: context.timeoutMs,
        workdir: context.worktree,
      },
      ...(parent.agent === undefined ? {} : { agent: parent.agent }),
      signal: context.signal ?? parent.signal,
    })
    return shellResult(result, context.outputLimitBytes)
  }
}

function shellResult(result: ToolExecutionResult, outputLimitBytes: number): DeliveryCheckRunResult {
  if (result.isError) {
    const text = result.content
      .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
      .map(block => block.text)
      .join('\n')
    return {
      status: 'unknown',
      exitCode: null,
      signal: null,
      stdout: retainedOutput('', false, outputLimitBytes),
      stderr: retainedOutput(text, false, outputLimitBytes),
    }
  }
  const value = result.value
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || value.kind !== 'foreground'
    || typeof value.stdout !== 'object' || value.stdout === null || Array.isArray(value.stdout)
    || typeof value.stderr !== 'object' || value.stderr === null || Array.isArray(value.stderr)) {
    return {
      status: 'unknown',
      exitCode: null,
      signal: null,
      stdout: retainedOutput('', false, outputLimitBytes),
      stderr: retainedOutput('native shell returned an unsupported result', false, outputLimitBytes),
    }
  }
  const stdout = value.stdout as Record<string, unknown>
  const stderr = value.stderr as Record<string, unknown>
  const exitCode = typeof value.exitCode === 'number' ? value.exitCode : null
  const signal = typeof value.signal === 'string' ? value.signal as NodeJS.Signals : null
  const inconclusive = value.timedOut === true || value.aborted === true || signal !== null
  return {
    status: inconclusive ? 'unknown' : exitCode === 0 ? 'passed' : 'failed',
    exitCode,
    signal,
    stdout: retainedOutput(
      typeof stdout.text === 'string' ? stdout.text : '',
      stdout.truncated === true,
      outputLimitBytes,
    ),
    stderr: retainedOutput(
      typeof stderr.text === 'string' ? stderr.text : '',
      stderr.truncated === true,
      outputLimitBytes,
    ),
  }
}

function retainedOutput(text: string, alreadyTruncated: boolean, limit: number): CapturedOutput {
  const bytes = Buffer.from(text)
  const retained = bytes.subarray(0, limit)
  const retainedOnly = alreadyTruncated || bytes.length > retained.length
  return {
    text: retained.toString('utf8'),
    bytes: bytes.length,
    truncated: retainedOnly,
    sha256: createHash('sha256').update(retained).digest('hex'),
    hashScope: retainedOnly ? 'retained' : 'full',
  }
}

function bashCommand(argv: readonly string[]): string {
  return argv.map(value => `'${value.replaceAll("'", "'\\''")}'`).join(' ')
}

function pwshCommand(argv: readonly string[]): string {
  return `& ${argv.map(value => `'${value.replaceAll("'", "''")}'`).join(' ')}`
}

interface CompactOptions {
  readonly status?: CompleteDeliveryValue['status']
  readonly reason?: string
  readonly draftPr?: DraftPrResult
}

function compact(
  report: DeliveryReport,
  goal: { id: unknown; revision: number; phase: string },
  options: CompactOptions = {},
): CompleteDeliveryValue {
  return {
    schemaVersion: 1,
    status: options.status ?? report.status,
    reason: options.reason ?? report.reason,
    goal: { id: String(goal.id), revision: goal.revision, phase: goal.phase },
    artifact: report.artifact,
    repository: report.repository,
    checks: report.checks.map(check => ({
      name: check.name,
      status: check.status,
      exitCode: check.exitCode,
      stdoutBytes: check.stdout.bytes,
      stdoutTruncated: check.stdout.truncated,
      stdoutSha256: check.stdout.sha256,
      stdoutHashScope: check.stdout.hashScope,
      stderrBytes: check.stderr.bytes,
      stderrTruncated: check.stderr.truncated,
      stderrSha256: check.stderr.sha256,
      stderrHashScope: check.stderr.hashScope,
      ...(check.status === 'passed' || check.stdout.text === '' ? {} : { stdoutPreview: check.stdout.text }),
      ...(check.status === 'passed' || check.stderr.text === '' ? {} : { stderrPreview: check.stderr.text }),
    })),
    ...(options.draftPr === undefined ? {} : { draftPr: options.draftPr }),
  }
}

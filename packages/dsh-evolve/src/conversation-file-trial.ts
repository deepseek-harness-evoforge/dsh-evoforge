import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import * as NativeFileTools from '@deepseek-ai/dsh-tool-fs'
import * as NativePresent from '@deepseek-ai/dsh-tool-present'
import { z } from 'zod'

const filename = z.string().regex(/^[a-z][a-z0-9-]{0,47}\.json$/u)
export const fileTrialBoundsSchema = z.strictObject({
  root: z.string().regex(/^\.evoforge\/workflow-trials\/[a-f0-9]{64}\/[0-7]$/u),
  inputs: z.array(z.strictObject({ path: filename, content: z.string().min(1).max(64_000) })).min(1).max(3),
  outputs: z.array(filename).min(1).max(2),
}).superRefine((value, ctx) => {
  const names = [...value.inputs.map(file => file.path), ...value.outputs]
  if (new Set(names).size !== names.length || value.inputs.some(file => Buffer.byteLength(file.content) > 64_000)) {
    ctx.addIssue({ code: 'custom', message: 'duplicate or oversized workflow files' })
  }
})
export type FileTrialBounds = z.infer<typeof fileTrialBoundsSchema>
const hash = z.string().regex(/^[a-f0-9]{64}$/u)
// The audited tool-present entry does not re-export its event augmentation.
// Decode the documented durable payload at this consumer; do not redeclare a
// competing SessionEventMap entry or rely on a package-internal import.
const presentedSchema = z.strictObject({ turn: z.number().int().positive(), callId: z.string().min(1),
  files: z.array(z.strictObject({ path: z.string().min(1), description: z.string().optional() })).min(1) })
const readMetaSchema = z.strictObject({ path: z.string(), offset: z.number().int().positive(),
  lines: z.array(z.strictObject({ number: z.number().int().positive(), text: z.string() })),
  totalLines: z.number().int().nonnegative(), lang: z.string().optional() })
export const fileTrialEvidenceSchema = z.strictObject({
  root: fileTrialBoundsSchema.shape.root,
  inputs: z.array(z.strictObject({ path: filename, hash, unchanged: z.boolean(), read: z.boolean() })).min(1).max(3),
  outputs: z.array(z.strictObject({ path: filename,
    status: z.enum(['present', 'missing', 'unreadable']), content: z.string().max(64_000).optional(), hash: hash.optional(),
    written: z.boolean(), readBack: z.boolean(), presented: z.boolean(),
  })).min(1).max(2),
  policyViolations: z.number().int().nonnegative(),
}).superRefine((value, ctx) => {
  if (value.outputs.some(file => (file.status === 'present') !== (file.content !== undefined && file.hash !== undefined)
    || file.content !== undefined && (Buffer.byteLength(file.content) > 64_000 || sha256(file.content) !== file.hash))) {
    ctx.addIssue({ code: 'custom', message: 'inconsistent workflow artifact snapshot' })
  }
})
export type FileTrialEvidence = z.infer<typeof fileTrialEvidenceSchema>
export const FILE_TRIAL_MAX_CALLS = 12
export const FILE_TRIAL_MAX_TOKENS = 4000
export const FILE_TRIAL_DEADLINE_MS = 600_000
export const FILE_TRIAL_TOOL_NAMES = ['skill', 'read', 'read_image', 'write', 'edit', 'present'] as const

function sha256(value: string): string { return createHash('sha256').update(value).digest('hex') }
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Prepare a new, non-overwriting trial directory through the native filesystem.
 * No expected answers enter this interface. The same native tools execute both
 * legs; this private guard narrows model-controlled paths, not the Host fs.
 * Files remain as real Session deliveries after scope disposal and on failure.
 */
export async function prepareConversationFileTrial(ctx: Context, cwd: string, value: FileTrialBounds, signal: AbortSignal) {
  const bounds = fileTrialBoundsSchema.parse(value)
  signal.throwIfAborted()
  const workspace = await ctx.fs.resolve(cwd, { signal })
  const root = await ctx.fs.resolve(bounds.root, { cwd, signal })
  if (!ctx.fs.contains(workspace, root) || root.targetKey === workspace.targetKey
    || await ctx.fs.stat(root, signal) !== undefined) throw new Error('file trial requires an absent owned directory')
  const targets = new Map<string, FsTarget>()
  const resolveFile = async (name: string) => {
    const path = `${bounds.root}/${name}`
    const target = await ctx.fs.resolve(path, { cwd, signal })
    if (!ctx.fs.contains(root, target) || target.targetKey === root.targetKey) throw new Error('file trial target escaped its root')
    targets.set(name, target)
    return target
  }
  for (const input of bounds.inputs) {
    const target = await resolveFile(input.path)
    await ctx.fs.writeText(target, input.content, { kind: 'createIfAbsent' }, signal, { mode: 'workspace-write', workspaceRoot: cwd })
  }
  for (const name of bounds.outputs) {
    const target = await resolveFile(name)
    if (await ctx.fs.stat(target, signal) !== undefined) throw new Error('file trial output already exists')
  }
  let policyViolations = 0
  const checkPath = async (path: unknown, allowed: readonly string[], currentSignal: AbortSignal): Promise<void> => {
    if (typeof path !== 'string' || path.trim().length === 0) throw new Error('file trial path is required')
    const info = await ctx.fs.lstat(path, { cwd }, currentSignal)
    if (info !== undefined && info.type !== 'file') throw new Error('file trial accepts only regular files')
    const target = await ctx.fs.resolve(path, { cwd, signal: currentSignal })
    if (!allowed.some(name => targets.get(name)?.targetKey === target.targetKey)) throw new Error('file trial path is outside its declared files')
  }
  return {
    async install(scoped: Context, agent: Agent): Promise<void> {
      // These are official, scope-owned definitions, not alternative file tools.
      await scoped.plugin(NativeFileTools)
      await scoped.plugin(NativePresent)
      setSandboxMode(agent.session, 'workspace-write')
    },
    async checkTool(exec: ToolExecution): Promise<void> {
      try {
        if (exec.name === 'skill') return
        if (!object(exec.arguments) || exec.arguments.sandbox_permissions !== undefined || exec.parent !== undefined) {
          throw new Error('file trial does not permit escalation or nested tool dispatch')
        }
        const args = exec.arguments
        if (exec.name === 'read' || exec.name === 'read_image') {
          await checkPath(args.file_path, [...bounds.inputs.map(file => file.path), ...bounds.outputs], exec.signal)
        } else if (exec.name === 'write' || exec.name === 'edit') {
          await checkPath(args.file_path, bounds.outputs, exec.signal)
          if (exec.name === 'write' && (typeof args.content !== 'string' || Buffer.byteLength(args.content) > 64_000)) {
            throw new Error('file trial output exceeds artifact bound')
          }
        } else if (exec.name === 'present') {
          if (!Array.isArray(args.files) || args.files.length === 0 || args.files.length > bounds.outputs.length) throw new Error('invalid file trial delivery')
          for (const file of args.files) await checkPath(object(file) ? file.path : undefined, bounds.outputs, exec.signal)
        } else throw new Error('file trial tool is outside its declared capabilities')
      } catch (error) { policyViolations++; throw error }
    },
    async snapshot(events: readonly SessionEvent[]): Promise<FileTrialEvidence> {
      // Tool names/args alone do not prove execution. Require the exact native
      // result correlated to that call and a regular-file byte readback.
      const calls = events.filter(event => event.type === 'tool/call')
      const results = events.filter(event => event.type === 'tool/result')
      const deliveries = events.flatMap(event => {
        const raw = event as { type: string; seq: number; data: unknown }
        return raw.type === 'deliverables/presented' ? [{ seq: raw.seq, data: presentedSchema.parse(raw.data) }] : []
      })
      const resultFor = (call: typeof calls[number]) => results.find(result => result.seq > call.seq && result.data.error === undefined
        && result.sourceEventSeqs?.length === 1 && result.sourceEventSeqs[0] === call.seq
        && result.data.turn === call.data.turn && result.data.step === call.data.step
        && result.data.message.content.some(block => block.type === 'tool-result' && block.toolCallId === call.data.callId && !block.isError))
      const successful = calls.filter(call => resultFor(call) !== undefined)
      const names = new Map<string, string>()
      for (const call of successful) {
        let args: unknown
        try { args = JSON.parse(call.data.arguments) } catch { continue }
        if (!object(args) || typeof args.file_path !== 'string') continue
        const target = await ctx.fs.resolve(args.file_path, { cwd, signal })
        for (const [name, expected] of targets) if (expected.targetKey === target.targetKey) names.set(String(call.data.callId), name)
      }
      // A one-line/truncated read is not full inspection. Check native durable
      // read windows against every actual line, allowing multiple paged reads.
      // Native read strips CR and the final LF; snapshot hashes preserve bytes.
      const fullyReadAt = async (name: string, content: string, after = -1): Promise<number | undefined> => {
        const lines = content === '' ? [] : content.replace(/\n$/u, '').split('\n').map(line => line.replace(/\r$/u, ''))
        const seen = new Set<number>()
        let completed: number | undefined
        for (const call of successful) {
          if (call.seq <= after || call.data.name !== 'read' || names.get(String(call.data.callId)) !== name) continue
          const result = resultFor(call)!, meta = readMetaSchema.safeParse(result.data.meta)
          if (!meta.success || meta.data.totalLines !== lines.length) continue
          const target = await ctx.fs.resolve(meta.data.path, { cwd, signal })
          if (target.targetKey !== targets.get(name)!.targetKey) continue
          for (const line of meta.data.lines) if (line.number >= meta.data.offset && lines[line.number - 1] === line.text) seen.add(line.number)
          if (seen.size === lines.length) completed = result.seq
        }
        return completed
      }
      const inputs = []
      for (const file of bounds.inputs) {
        const target = targets.get(file.path)!
        const info = await ctx.fs.lstat(`${bounds.root}/${file.path}`, { cwd }, signal)
        const unchanged = info?.type === 'file' && sha256(await ctx.fs.readText(target, signal)) === sha256(file.content)
        inputs.push({ path: file.path, hash: sha256(file.content), unchanged,
          read: await fullyReadAt(file.path, file.content) !== undefined })
      }
      const outputs: FileTrialEvidence['outputs'] = []
      for (const name of bounds.outputs) {
        const target = targets.get(name)!
        let status: 'present' | 'missing' | 'unreadable' = 'missing', content: string | undefined
        const info = await ctx.fs.lstat(`${bounds.root}/${name}`, { cwd }, signal)
        if (info !== undefined) {
          status = 'unreadable'
          if (info.type === 'file') {
            const stat = await ctx.fs.stat(target, signal)
            if (stat?.size !== undefined && stat.size <= 64_000) {
              content = await ctx.fs.readText(target, signal)
              if (Buffer.byteLength(content) <= 64_000) status = 'present'
              else content = undefined
            }
          }
        }
        const writes = successful.filter(call => ['write', 'edit'].includes(call.data.name) && names.get(String(call.data.callId)) === name)
        const lastWrite = writes.at(-1)
        const readBack = lastWrite === undefined || content === undefined ? undefined
          : await fullyReadAt(name, content, resultFor(lastWrite)!.seq)
        const writeArgs: unknown = lastWrite === undefined ? undefined : JSON.parse(lastWrite.data.arguments)
        const written = lastWrite !== undefined && (lastWrite.data.name === 'edit'
          || object(writeArgs) && writeArgs.content === content)
        let presented = false
        if (readBack !== undefined) for (const event of deliveries) {
          if (event.seq <= readBack || event.data.turn !== 1) continue
          const call = successful.find(call => call.data.callId === event.data.callId && call.data.name === 'present')
          if (call === undefined || call.seq <= readBack) continue
          for (const file of event.data.files) {
            const delivery = await ctx.fs.resolve(file.path, { cwd, signal })
            if (delivery.targetKey === target.targetKey) presented = true
          }
        }
        outputs.push({ path: name, status, ...(content === undefined ? {} : { content, hash: sha256(content) }),
          written, readBack: readBack !== undefined, presented })
      }
      return fileTrialEvidenceSchema.parse({ root: bounds.root, inputs, outputs, policyViolations })
    },
  }
}

import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import type { JobHooks, JobStart } from '@deepseek-ai/dsh-jobs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EvaluatorDraftInbox,
  type EvaluatorDraftTargetConfig,
} from '../src/evaluator-draft-inbox.ts'
import { hashTree } from '../src/hash.ts'

const signalId = '1'.repeat(64)
const sourceDraftId = '2'.repeat(64)
const generationId = '3'.repeat(64)
const dshRevision = '4'.repeat(40)
const execFile = promisify(execFileCallback)
const suiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
  ?? resolve(suiteRoot, '../deepseek-harness')
const artifact = {
  kind: 'skill' as const,
  name: 'build-dsh-plugin',
  gitCommit: '5'.repeat(40),
  treeHash: '6'.repeat(40),
}
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('EvaluatorDraftInbox', () => {
  it('authors five bounded files but executes nothing before a separate approval', async () => {
    const fixture = await setup()
    const jobs = fakeJobs()
    const authorModel = vi.fn(async () => ({
      searchEvidence: '# Evidence\n\nReproduce the correction independently.\n',
      knownCorrectionSkill: skillSource('Corrected behavior.'),
      evaluatorSource: 'process.stdout.write(JSON.stringify({ passed: true }))\n',
      usage: { inputTokens: 120, outputTokens: 80 },
    }))
    const qualify = vi.fn(async () => ({
      status: 'calibrated' as const,
      reportPath: join(fixture.root, 'report.json'),
      summary: 'known-bad failed and known-correction passed',
    }))
    const inbox = new EvaluatorDraftInbox({
      targets: [fixture.target],
      drafts: () => fixture.drafts,
      source: fixture.source,
      authorModel,
      qualify,
      modelIdentity: () => 'model-route-v1',
    })
    inbox.attachJobs(jobs.registry)

    const receipt = await inbox.author(signalId, fixture.target.id)
    expect(receipt).toMatchObject({
      schemaVersion: 1,
      action: 'author-evaluator',
      targetId: fixture.target.id,
      skillName: artifact.name,
      draftStatus: 'scheduled',
      jobId: 'evolution-1',
    })
    await jobs.hooks[0]!.done

    expect(authorModel).toHaveBeenCalledOnce()
    expect(authorModel).toHaveBeenCalledWith(expect.objectContaining({
      signalId,
      targetId: fixture.target.id,
      skillName: artifact.name,
      skillSource: fixture.originalSkill,
      userText: 'A private failing request',
      correction: 'Do the corrected behavior',
    }))
    expect(qualify).not.toHaveBeenCalled()

    const scan = await inbox.scan()
    expect(scan).toMatchObject({ warningCount: 0, drafts: [{ status: 'draft-ready' }] })
    expect(scan.drafts[0]).not.toHaveProperty('signalId')
    await expect(inbox.automaticInflightStatus(artifact.name, signalId)).resolves.toBe('clear')
    await expect(inbox.automaticInflightStatus(artifact.name, '9'.repeat(64))).resolves.toBe('busy')
    const draftId = scan.drafts[0]!.id
    const detail = await inbox.get(draftId)
    expect(detail).toMatchObject({
      id: draftId,
      status: 'draft-ready',
      targetId: fixture.target.id,
      skillName: artifact.name,
      cost: { inputTokens: 120, outputTokens: 80, modelCalls: 1 },
    })
    expect(detail.files.map(file => file.path)).toEqual([
      'calibration/known-bad/SKILL.md',
      'calibration/known-correction/SKILL.md',
      'final-test/evaluator.mjs',
      'manifest.json',
      'search/evidence.md',
    ])
    expect(detail.files.find(file => file.path === 'calibration/known-bad/SKILL.md')?.content)
      .toBe(fixture.originalSkill)
    const manifest = JSON.parse(detail.files.find(file => file.path === 'manifest.json')!.content)
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      id: draftId,
      epoch: { dshRevision, evaluatorVersion: `evaluator-draft-${draftId}` },
      budget: { candidateLimit: 1, trialLimit: 4 },
    })
  })

  it('publishes only the exact unchanged draft after human approval and sealed calibration', async () => {
    const fixture = await setup()
    const jobs = fakeJobs()
    const qualify = vi.fn(async ({ casePackDir, outputDir }: { casePackDir: string; outputDir: string }) => {
      expect(await readdir(casePackDir)).toEqual(['calibration', 'final-test', 'manifest.json', 'search'])
      await mkdir(outputDir, { recursive: true })
      await writeFile(join(outputDir, 'calibration-report.json'), '{}\n')
      return {
        status: 'calibrated' as const,
        reportPath: join(outputDir, 'calibration-report.json'),
        summary: 'known-bad failed and known-correction passed',
      }
    })
    const inbox = new EvaluatorDraftInbox({
      targets: [fixture.target],
      drafts: () => fixture.drafts,
      source: fixture.source,
      authorModel: vi.fn(async () => proposal()),
      qualify,
      modelIdentity: () => 'model-route-v1',
    })
    inbox.attachJobs(jobs.registry)
    await inbox.author(signalId, fixture.target.id)
    await jobs.hooks[0]!.done
    const draftId = (await inbox.scan()).drafts[0]!.id

    const approved = await inbox.approve(draftId, 'Evaluator semantics independently reviewed')

    expect(qualify).toHaveBeenCalledOnce()
    expect(approved).toMatchObject({
      schemaVersion: 1,
      action: 'approve-evaluator',
      draftId,
      draftStatus: 'qualified',
    })
    const detail = await inbox.get(draftId)
    expect(detail.status).toBe('qualified')
    expect(detail.decision).toMatchObject({
      actor: 'human',
      note: 'Evaluator semantics independently reviewed',
    })
    expect(detail.qualification).toMatchObject({ calibrated: true })
    expect(await readdir(join(fixture.target.root, 'qualified', draftId)))
      .toEqual(['calibration', 'final-test', 'manifest.json', 'search'])
    await expect(inbox.automaticInflightStatus(artifact.name, '9'.repeat(64)))
      .resolves.toBe('clear')

    await expect(inbox.approve(draftId, 'duplicate')).resolves.toEqual(approved)
    expect(qualify).toHaveBeenCalledOnce()
  })

  it('fails closed on draft drift, invalid model fields, and multi-file source Skills', async () => {
    const drift = await setup()
    const jobs = fakeJobs()
    const inbox = new EvaluatorDraftInbox({
      targets: [drift.target],
      drafts: () => drift.drafts,
      source: drift.source,
      authorModel: vi.fn(async () => proposal()),
      qualify: vi.fn(),
      modelIdentity: () => 'model-route-v1',
    })
    inbox.attachJobs(jobs.registry)
    await inbox.author(signalId, drift.target.id)
    await jobs.hooks[0]!.done
    const draftId = (await inbox.scan()).drafts[0]!.id
    const internal = join(drift.target.root, 'drafts', draftId)
    await writeFile(join(internal, 'search', 'evidence.md'), 'drift\n')
    await expect(inbox.approve(draftId, 'looks good')).rejects.toThrow('changed after authoring')

    const invalid = await setup()
    const invalidJobs = fakeJobs()
    const invalidInbox = new EvaluatorDraftInbox({
      targets: [invalid.target],
      drafts: () => invalid.drafts,
      source: invalid.source,
      authorModel: vi.fn(async () => ({ ...proposal(), manifest: '{}' } as never)),
      qualify: vi.fn(),
      modelIdentity: () => 'model-route-v1',
    })
    invalidInbox.attachJobs(invalidJobs.registry)
    await invalidInbox.author(signalId, invalid.target.id)
    await invalidJobs.hooks[0]!.done
    const invalidRow = (await invalidInbox.scan()).drafts[0]!
    expect(invalidRow.status).toBe('incomplete')
    await expect(invalidInbox.get(invalidRow.id)).resolves.toMatchObject({
      id: invalidRow.id,
      status: 'incomplete',
      files: [],
    })
    await expect(invalidInbox.approve(invalidRow.id, 'cannot qualify missing files'))
      .rejects.toThrow('produced no draft')
    await expect(invalidInbox.reject(invalidRow.id, 'invalid response fields'))
      .resolves.toMatchObject({ draftStatus: 'rejected' })

    const multi = await setup()
    await writeFile(join(multi.skillDir, 'extra.md'), 'not supported in the bounded first slice\n')
    const multiJobs = fakeJobs()
    const multiInbox = new EvaluatorDraftInbox({
      targets: [multi.target],
      drafts: () => multi.drafts,
      source: multi.source,
      authorModel: vi.fn(async () => proposal()),
      qualify: vi.fn(),
      modelIdentity: () => 'model-route-v1',
    })
    multiInbox.attachJobs(multiJobs.registry)
    await expect(multiInbox.author(signalId, multi.target.id)).rejects.toThrow('single-file Skill')

    const linked = await setup()
    const external = join(linked.root, 'external-private-data')
    const linkedRoot = join(linked.root, 'linked-owned-root')
    await mkdir(external, { mode: 0o755 })
    await symlink(external, linkedRoot)
    const linkedInbox = new EvaluatorDraftInbox({
      targets: [{ ...linked.target, root: linkedRoot }],
      drafts: () => linked.drafts,
      source: linked.source,
      authorModel: vi.fn(async () => proposal()),
      qualify: vi.fn(),
      modelIdentity: () => 'model-route-v1',
    })
    linkedInbox.attachJobs(fakeJobs().registry)
    await expect(linkedInbox.author(signalId, linked.target.id)).rejects.toThrow('must not be a symlink')
    expect((await stat(external)).mode & 0o777).toBe(0o755)
  })

  it('never repeats a request whose durable authoring outcome is uncertain', async () => {
    const fixture = await setup()
    const jobs = fakeJobs()
    let release!: () => void
    const pending = new Promise<never>((_resolve, reject) => {
      release = () => reject(new Error('transport outcome uncertain'))
    })
    const authorModel = vi.fn(() => pending)
    const first = new EvaluatorDraftInbox({
      targets: [fixture.target],
      drafts: () => fixture.drafts,
      source: fixture.source,
      authorModel,
      qualify: vi.fn(),
      modelIdentity: () => 'model-route-v1',
    })
    first.attachJobs(jobs.registry)
    const receipt = await first.author(signalId, fixture.target.id)
    await waitFor(async () => authorModel.mock.calls.length === 1
      && (await first.scan()).drafts[0]?.status === 'authoring-pending')
    expect(authorModel).toHaveBeenCalledOnce()

    const restartedJobs = fakeJobs()
    const restartedAuthor = vi.fn(async () => proposal())
    const restarted = new EvaluatorDraftInbox({
      targets: [fixture.target],
      drafts: () => fixture.drafts,
      source: fixture.source,
      authorModel: restartedAuthor,
      qualify: vi.fn(),
      modelIdentity: () => 'model-route-v1',
    })
    restarted.attachJobs(restartedJobs.registry)
    const duplicate = await restarted.author(signalId, fixture.target.id)

    expect(duplicate).toMatchObject({
      launchId: receipt.launchId,
      draftStatus: 'uncertain',
    })
    expect(restartedJobs.starts).toHaveLength(0)
    expect(restartedAuthor).not.toHaveBeenCalled()
    release()
    await jobs.hooks[0]!.done
  })

  it('retries only the local sealed qualification in a fresh preserved attempt', async () => {
    const fixture = await setup()
    const jobs = fakeJobs()
    const qualify = vi.fn()
      .mockRejectedValueOnce(new Error('local runner interrupted'))
      .mockImplementationOnce(async ({ outputDir }: { outputDir: string }) => {
        await mkdir(outputDir, { recursive: true })
        await writeFile(join(outputDir, 'calibration-report.json'), '{}\n')
        return {
          status: 'calibrated' as const,
          reportPath: join(outputDir, 'calibration-report.json'),
          summary: 'calibrated',
        }
      })
    const authorModel = vi.fn(async () => proposal())
    const inbox = new EvaluatorDraftInbox({
      targets: [fixture.target],
      drafts: () => fixture.drafts,
      source: fixture.source,
      authorModel,
      qualify,
      modelIdentity: () => 'model-route-v1',
    })
    inbox.attachJobs(jobs.registry)
    await inbox.author(signalId, fixture.target.id)
    await jobs.hooks[0]!.done
    const draftId = (await inbox.scan()).drafts[0]!.id

    await expect(inbox.approve(draftId, 'reviewed once')).rejects.toThrow('local runner interrupted')
    await expect(inbox.approve(draftId, 'reviewed again')).resolves.toMatchObject({
      draftStatus: 'qualified',
    })

    expect(authorModel).toHaveBeenCalledOnce()
    expect(qualify).toHaveBeenCalledTimes(2)
    expect(qualify.mock.calls[0]?.[0].outputDir).toMatch(/attempt-1$/)
    expect(qualify.mock.calls[1]?.[0].outputDir).toMatch(/attempt-2$/)
    expect((await inbox.get(draftId)).qualification).toEqual({ calibrated: true, attempt: 2 })
  })

  it.skipIf(process.platform !== 'darwin')(
    'qualifies generated code only after approval through the real sealed DSH assembly gate',
    async () => {
      const original = skillSource([
        '# Develop a DSH Plugin',
        '',
        'For Web or GUI work, component tests and screenshots are sufficient.',
      ].join('\n'))
      const corrected = skillSource([
        '# Develop a DSH Plugin',
        '',
        'For Web or GUI work, verify the real flow in a controlled browser, refresh once, and inspect the visible failure path.',
      ].join('\n'))
      const fixture = await setup({ originalSkill: original })
      const revision = (await execFile('git', ['-C', dshSourceDir, 'rev-parse', 'HEAD'])).stdout.trim()
      const evaluatorSource = (await readFile(
        join(suiteRoot, 'examples', 'case-packs', 'browser-e2e-guidance-assembled', 'final-test', 'evaluator.mjs'),
        'utf8',
      )).replaceAll('browser-e2e-baseline', artifact.name)
      const jobs = fakeJobs()
      const authorModel = vi.fn(async () => ({
        searchEvidence: '# Evidence\n\nRun a real assembled DSH Skill invocation and inspect the model-visible history.\n',
        knownCorrectionSkill: corrected,
        evaluatorSource,
        usage: { inputTokens: 1_000, outputTokens: 1_200 },
      }))
      const target = { ...fixture.target, dshRevision: revision }
      const inbox = new EvaluatorDraftInbox({
        targets: [target],
        drafts: () => fixture.drafts,
        source: fixture.source,
        authorModel,
        modelIdentity: () => 'sealed-real-dsh-evaluator-author-v1',
      })
      inbox.attachJobs(jobs.registry)

      const previousDshSource = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
      process.env.DSH_EVOLVE_DSH_SOURCE_DIR = dshSourceDir
      try {
        await inbox.author(signalId, target.id)
        await jobs.hooks[0]!.done
        const draftId = (await inbox.scan()).drafts[0]!.id

        expect(authorModel).toHaveBeenCalledOnce()
        expect((await inbox.get(draftId)).status).toBe('draft-ready')
        await expect(inbox.approve(draftId, 'Real DSH assembly semantics independently reviewed'))
          .resolves.toMatchObject({ draftStatus: 'qualified' })
        expect((await inbox.get(draftId))).toMatchObject({
          status: 'qualified',
          qualification: { calibrated: true, attempt: 1 },
        })
      } finally {
        if (previousDshSource === undefined) delete process.env.DSH_EVOLVE_DSH_SOURCE_DIR
        else process.env.DSH_EVOLVE_DSH_SOURCE_DIR = previousDshSource
      }
    },
    45_000,
  )

  it('hands only an unchanged qualified Pack to the existing Feedback Shadow launcher', async () => {
    const fixture = await setup()
    const shadowRunRoot = join(fixture.root, 'qualified-shadow-runs')
    await mkdir(shadowRunRoot)
    const target = { ...fixture.target, shadowRunRoot }
    const jobs = fakeJobs()
    const shadow = {
      available: vi.fn(() => true),
      launchExact: vi.fn(async () => ({
        schemaVersion: 1 as const,
        action: 'start-shadow' as const,
        launchId: '9'.repeat(64),
        targetId: target.id,
        skillName: target.skill,
        runStatus: 'scheduled' as const,
        jobId: 'evolution-shadow-1',
      })),
    }
    const qualify = vi.fn(async ({ outputDir }: { outputDir: string }) => {
      await mkdir(outputDir, { recursive: true })
      await writeFile(join(outputDir, 'calibration-report.json'), '{}\n')
      return {
        status: 'calibrated' as const,
        reportPath: join(outputDir, 'calibration-report.json'),
        summary: 'calibrated',
      }
    })
    const inbox = new EvaluatorDraftInbox({
      targets: [target],
      drafts: () => fixture.drafts,
      source: fixture.source,
      authorModel: vi.fn(async () => proposal()),
      qualify,
      modelIdentity: () => 'model-route-v1',
      shadow,
    })
    inbox.attachJobs(jobs.registry)
    await inbox.author(signalId, target.id)
    await jobs.hooks[0]!.done
    const draftId = (await inbox.scan()).drafts[0]!.id

    await expect(inbox.startShadow(draftId)).rejects.toThrow('must be qualified')
    qualify.mockResolvedValueOnce({
      status: 'not-calibrated',
      reportPath: join(fixture.root, 'failed-calibration.json'),
      reason: 'known-bad unexpectedly passed',
    } as never)
    await expect(inbox.approveAndStartShadow(draftId, 'independent semantics reviewed'))
      .rejects.toThrow('known-bad unexpectedly passed')
    expect(shadow.launchExact).not.toHaveBeenCalled()
    shadow.launchExact.mockRejectedValueOnce(new Error('launcher interrupted after qualification'))
    await expect(inbox.approveAndStartShadow(draftId, 'retry exact qualification and paid Shadow'))
      .rejects.toThrow('launcher interrupted after qualification')
    await expect(inbox.get(draftId)).resolves.toMatchObject({
      status: 'qualified',
      qualifiedShadowAvailable: true,
    })
    expect(qualify).toHaveBeenCalledTimes(2)
    await expect(inbox.approveAndStartShadow(draftId, 'resume already qualified paid Shadow'))
      .resolves.toMatchObject({
        action: 'start-shadow',
        runStatus: 'scheduled',
      })
    expect(qualify).toHaveBeenCalledTimes(2)
    await expect(inbox.get(draftId)).resolves.toMatchObject({ qualifiedShadowAvailable: true })
    expect(shadow.launchExact).toHaveBeenCalledWith(signalId, {
      id: target.id,
      skill: target.skill,
      casePackDir: join(target.root, 'qualified', draftId),
      casePackHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      runRoot: shadowRunRoot,
    })

    await writeFile(
      join(target.root, 'qualified', draftId, 'search', 'evidence.md'),
      'qualified pack drift\n',
    )
    await expect(inbox.startShadow(draftId)).rejects.toThrow('Qualified Case Pack changed')
    expect(shadow.launchExact).toHaveBeenCalledTimes(2)
  })
})

async function setup(options: { originalSkill?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-evaluator-draft-'))
  temporaryRoots.push(root)
  const ownedRoot = join(root, 'owned')
  const skillDir = join(root, 'skill')
  await Promise.all([mkdir(ownedRoot), mkdir(skillDir)])
  const originalSkill = options.originalSkill ?? skillSource('Original behavior.')
  await writeFile(join(skillDir, 'SKILL.md'), originalSkill)
  const contentHash = await hashTree(skillDir)
  const target: EvaluatorDraftTargetConfig = {
    id: 'plugin-delivery',
    skill: artifact.name,
    root: ownedRoot,
    dshRevision,
  }
  const drafts = {
    create: vi.fn(async () => ({
      created: true,
      path: join(root, 'source-draft.json'),
      draft: {
        schemaVersion: 1 as const,
        id: sourceDraftId,
        status: 'draft' as const,
        source: {
          signalId,
          sessionId: 'session-private',
          messageId: 'message-private',
          feedbackVersion: '00000000-0000-4000-8000-000000000001',
          generationId,
          assistantSeq: 10,
          turn: 1,
          prefixHash: '7'.repeat(64),
        },
        target: {
          kind: 'skill' as const,
          name: artifact.name,
          artifact,
          contentHash,
        },
        sample: {
          userText: 'A private failing request',
          correction: 'Do the corrected behavior',
        },
        limitations: ['private'],
      },
    })),
  }
  const source = {
    resolveArtifact: vi.fn(async () => ({ artifact, repository: root, path: 'skill', resourceBase: skillDir })),
  }
  return { root, ownedRoot, skillDir, originalSkill, target, drafts, source }
}

function proposal() {
  return {
    searchEvidence: '# Evidence\n\nIndependent observable.\n',
    knownCorrectionSkill: skillSource('Corrected behavior.'),
    evaluatorSource: 'process.stdout.write(JSON.stringify({ passed: true }))\n',
    usage: { inputTokens: 20, outputTokens: 10 },
  }
}

function skillSource(body: string): string {
  return `---\nname: ${artifact.name}\ndescription: fixture\n---\n\n${body}\n`
}

function fakeJobs() {
  const starts: JobStart[] = []
  const hooks: JobHooks[] = []
  return {
    starts,
    hooks,
    registry: {
      start(spec: JobStart) {
        starts.push(spec)
        hooks.push(spec.run())
        return `evolution-${starts.length}`
      },
    } as never,
  }
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('timed out waiting for predicate')
}

import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { cp, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { hashTree, sha256 } from '../src/hash.js'

const execFileAsync = promisify(execFile)
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const cliPath = join(packageRoot, 'src', 'cli.ts')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })))
})

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-shadow-'))
  temporaryRoots.push(root)

  const skillDir = join(root, 'skill')
  const casePackDir = join(root, 'case-pack')
  const outputDir = join(root, 'run')
  await mkdir(skillDir)
  await mkdir(casePackDir)
  await writeFile(
    join(skillDir, 'SKILL.md'),
    [
      '---',
      'name: build-dsh-plugin',
      'description: Build a cache-safe DSH plugin.',
      '---',
      '',
      '# Build DSH Plugin',
      '',
      'Only edit files owned by the target plugin.',
      '',
    ].join('\n'),
  )
  await writeFile(
    join(casePackDir, 'manifest.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: 'owned-path-boundary',
        epoch: {
          dshRevision: '0.1.0-rc.6',
          evaluatorVersion: 'p0a.1',
        },
        budget: {
          candidateLimit: 1,
          trialLimit: 1,
          inputTokenLimit: 2_000,
          outputTokenLimit: 400,
        },
      },
      null,
      2,
    ),
  )

  return { casePackDir, outputDir, root, skillDir }
}

async function configureBrowserTrial(fixture: Awaited<ReturnType<typeof createFixture>>) {
  const skillPath = join(fixture.skillDir, 'SKILL.md')
  const originalSkill = await readFile(skillPath, 'utf8')
  const correctedSkill = originalSkill.replace(
    'Only edit files owned by the target plugin.',
    'Only edit files owned by the target plugin.\nFor Web or GUI work, verify the real flow in a controlled browser.',
  )
  await rm(fixture.casePackDir, { force: true, recursive: true })
  await cp(
    join(suiteRoot, 'examples', 'case-packs', 'browser-e2e-guidance'),
    fixture.casePackDir,
    { recursive: true },
  )
  return { correctedSkill, originalSkill, skillPath }
}

async function listTree(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const paths: string[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(root, entry.name)
    paths.push(path.slice(root.length + 1))
    if (entry.isDirectory()) paths.push(...(await listTree(path)).map((child) => join(entry.name, child)))
  }
  return paths
}

describe('dsh-evolve shadow', () => {
  it('rejects package-manager authority unless the Trial is explicitly DSH-assembled', async () => {
    const fixture = await createFixture()
    const manifestPath = join(fixture.casePackDir, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.trial = {
      evaluator: 'final-test/evaluator.mjs',
      timeoutMs: 1_000,
      outputLimitBytes: 1_024,
      dshProfileInstall: true,
    }
    manifest.calibration = {
      knownBad: 'calibration/known-bad',
      knownCorrection: 'calibration/known-correction',
    }
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2))

    await expect(execFileAsync(
      process.execPath,
      [
        '--import', 'tsx', cliPath, 'shadow', fixture.skillDir,
        '--case-pack', fixture.casePackDir,
        '--output', fixture.outputDir,
      ],
      { cwd: packageRoot },
    )).rejects.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'error: case pack Trial dshProfileInstall requires dshAssembled\n',
    })
  })

  it('rejects an out-of-scope model patch without changing the active Skill', async () => {
    const fixture = await createFixture()
    const originalSkill = await readFile(join(fixture.skillDir, 'SKILL.md'), 'utf8')
    const requests: unknown[] = []
    const authorizationHeaders: Array<string | undefined> = []
    const server = createServer(async (request, response) => {
      let body = ''
      for await (const chunk of request) body += chunk
      requests.push(JSON.parse(body))
      authorizationHeaders.push(request.headers.authorization)
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  claim: 'Write outside the owned Skill directory',
                  files: [{ path: '../outside.md', content: 'escaped' }],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 120, completion_tokens: 24 },
        }),
      )
    })
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('mock model server did not bind')

    try {
      const result = await execFileAsync(
        process.execPath,
        [
          '--import',
          'tsx',
          cliPath,
          'shadow',
          fixture.skillDir,
          '--case-pack',
          fixture.casePackDir,
          '--output',
          fixture.outputDir,
        ],
        {
          cwd: packageRoot,
          env: {
            ...process.env,
            DSH_EVOLVE_MODEL_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
            DSH_EVOLVE_MODEL_NAME: 'fixed-boundary-model',
            DSH_EVOLVE_MODEL_API_KEY: 'test-secret-must-not-persist',
          },
        },
      )

      expect(result.stderr).toBe('')
      expect(result.stdout).toMatch(/^reject: candidate attempted to change a non-owned path; report: .+\/report\.json\n$/)
      expect(requests).toHaveLength(1)
      expect(authorizationHeaders).toEqual(['Bearer test-secret-must-not-persist'])
      expect(await readFile(join(fixture.skillDir, 'SKILL.md'), 'utf8')).toBe(originalSkill)
      await expect(readFile(join(fixture.root, 'outside.md'), 'utf8')).rejects.toThrow()

      const report = JSON.parse(await readFile(join(fixture.outputDir, 'report.json'), 'utf8'))
      const persistedOutput = [
        await readFile(join(fixture.outputDir, 'evidence', 'proposal.json'), 'utf8'),
        JSON.stringify(report),
        result.stdout,
      ].join('\n')
      expect(persistedOutput).not.toContain('test-secret-must-not-persist')
      expect(report).toMatchObject({
        schemaVersion: 1,
        run: { status: 'complete' },
        subject: {
          skillName: 'build-dsh-plugin',
          unchanged: true,
        },
        epoch: {
          dshRevision: '0.1.0-rc.6',
          modelRoute: 'fixed-boundary-model',
          evaluatorVersion: 'p0a.1',
        },
        candidate: {
          claim: 'Write outside the owned Skill directory',
          changedFiles: ['../outside.md'],
        },
        cases: [
          {
            id: 'owned-path-boundary',
            partition: 'search',
            baseline: 'pass',
            candidate: 'fail',
            checks: [{ name: 'owned-path', passed: false, evidenceRef: 'evidence/proposal.json' }],
          },
        ],
        budget: {
          candidateLimit: 1,
          trialLimit: 1,
          inputTokens: 120,
          outputTokens: 24,
        },
        decision: {
          recommendation: 'reject',
          reasons: ['candidate attempted to change a non-owned path'],
        },
      })
      expect(report.subject.baseTreeHash).toMatch(/^[a-f0-9]{64}$/)
      expect(report.subject.finalTreeHash).toBe(report.subject.baseTreeHash)
      expect(report.epoch.casePackHash).toMatch(/^[a-f0-9]{64}$/)
      expect(report.epoch.modelConfigHash).toMatch(/^[a-f0-9]{64}$/)
      expect(report.candidate.treeHash).toMatch(/^[a-f0-9]{64}$/)
      expect(report.candidate.parentTreeHash).toBe(report.subject.baseTreeHash)
      expect(await listTree(fixture.outputDir)).toEqual([
        'evidence',
        'evidence/proposal.json',
        'report.json',
        'run-state.json',
      ])
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      )
    }
  })

  it('reports an unevaluated in-scope candidate as incomplete without applying it', async () => {
    const fixture = await createFixture()
    const originalSkill = await readFile(join(fixture.skillDir, 'SKILL.md'), 'utf8')
    const server = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  claim: 'Clarify the owned-path rule',
                  files: [
                    {
                      path: 'SKILL.md',
                      content: originalSkill.replace(
                        'Only edit files owned by the target plugin.',
                        'Edit only files explicitly owned by the target plugin.',
                      ),
                    },
                  ],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 30 },
        }),
      )
    })
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('mock model server did not bind')

    try {
      let failure: unknown
      try {
        await execFileAsync(
          process.execPath,
          [
            '--import',
            'tsx',
            cliPath,
            'shadow',
            fixture.skillDir,
            '--case-pack',
            fixture.casePackDir,
            '--output',
            fixture.outputDir,
          ],
          {
            cwd: packageRoot,
            env: {
              ...process.env,
              DSH_EVOLVE_MODEL_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
              DSH_EVOLVE_MODEL_NAME: 'fixed-boundary-model',
            },
          },
        )
      } catch (error) {
        failure = error
      }

      expect(failure).toMatchObject({
        code: 2,
        stdout: '',
        stderr: 'incomplete: no trial evaluator is configured for an in-scope candidate\n',
      })
      expect(await readFile(join(fixture.skillDir, 'SKILL.md'), 'utf8')).toBe(originalSkill)
      const report = JSON.parse(await readFile(join(fixture.outputDir, 'report.json'), 'utf8'))
      expect(report.run.status).toBe('incomplete')
      expect(report.subject.unchanged).toBe(true)
      expect(report.candidate.changedFiles).toEqual(['SKILL.md'])
      expect(report.cases[0].candidate).toBe('incomplete')
      expect(report).not.toHaveProperty('decision')
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      )
    }
  })

  it('returns exit 2 and preserves evidence when the model boundary fails', async () => {
    const fixture = await createFixture()
    const originalSkill = await readFile(join(fixture.skillDir, 'SKILL.md'), 'utf8')
    const server = createServer((_request, response) => {
      response.statusCode = 503
      response.end('unavailable')
    })
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('mock model server did not bind')

    try {
      let failure: unknown
      try {
        await execFileAsync(
          process.execPath,
          [
            '--import',
            'tsx',
            cliPath,
            'shadow',
            fixture.skillDir,
            '--case-pack',
            fixture.casePackDir,
            '--output',
            fixture.outputDir,
          ],
          {
            cwd: packageRoot,
            env: {
              ...process.env,
              DSH_EVOLVE_MODEL_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
              DSH_EVOLVE_MODEL_NAME: 'failing-boundary-model',
            },
          },
        )
      } catch (error) {
        failure = error
      }

      expect(failure).toMatchObject({
        code: 2,
        stdout: '',
        stderr: 'incomplete: model request failed with HTTP 503\n',
      })
      expect(await readFile(join(fixture.skillDir, 'SKILL.md'), 'utf8')).toBe(originalSkill)
      const report = JSON.parse(await readFile(join(fixture.outputDir, 'report.json'), 'utf8'))
      expect(report).toMatchObject({
        schemaVersion: 1,
        run: { status: 'incomplete' },
        subject: { unchanged: true },
        epoch: { modelRoute: 'failing-boundary-model' },
        calibration: [],
        cases: [],
        budget: { candidateLimit: 1, trialLimit: 1, inputTokens: 0, outputTokens: 0 },
      })
      expect(report).not.toHaveProperty('candidate')
      expect(report).not.toHaveProperty('decision')
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      )
    }
  })

  it('rejects an output path whose symlinked parent resolves inside the active Skill', async () => {
    const fixture = await createFixture()
    const redirectedParent = join(fixture.root, 'redirected')
    await symlink(fixture.skillDir, redirectedParent, 'dir')
    let failure: unknown
    try {
      await execFileAsync(
        process.execPath,
        [
          '--import',
          'tsx',
          cliPath,
          'shadow',
          fixture.skillDir,
          '--case-pack',
          fixture.casePackDir,
          '--output',
          join(redirectedParent, 'run'),
        ],
        { cwd: packageRoot },
      )
    } catch (error) {
      failure = error
    }

    expect(failure).toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'error: output directory must be outside the Skill and case pack\n',
    })
    await expect(readdir(join(fixture.skillDir, 'run'))).rejects.toThrow()
  })

  it('returns an incomplete report when the active Skill changes during evaluation', async () => {
    const fixture = await createFixture()
    const skillPath = join(fixture.skillDir, 'SKILL.md')
    const originalSkill = await readFile(skillPath, 'utf8')
    const server = createServer(async (_request, response) => {
      await writeFile(skillPath, `${originalSkill}\nExternal concurrent edit.\n`)
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  claim: 'Clarify the owned-path rule',
                  files: [{ path: 'SKILL.md', content: originalSkill }],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        }),
      )
    })
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('mock model server did not bind')

    try {
      let failure: unknown
      try {
        await execFileAsync(
          process.execPath,
          [
            '--import',
            'tsx',
            cliPath,
            'shadow',
            fixture.skillDir,
            '--case-pack',
            fixture.casePackDir,
            '--output',
            fixture.outputDir,
          ],
          {
            cwd: packageRoot,
            env: {
              ...process.env,
              DSH_EVOLVE_MODEL_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
              DSH_EVOLVE_MODEL_NAME: 'fixed-boundary-model',
            },
          },
        )
      } catch (error) {
        failure = error
      }

      expect(failure).toMatchObject({
        code: 2,
        stdout: '',
        stderr: 'incomplete: active Skill changed during shadow evaluation\n',
      })
      const report = JSON.parse(await readFile(join(fixture.outputDir, 'report.json'), 'utf8'))
      expect(report.run.status).toBe('incomplete')
      expect(report.subject.unchanged).toBe(false)
      expect(report.subject.finalTreeHash).not.toBe(report.subject.baseTreeHash)
      expect(report).not.toHaveProperty('decision')
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      )
    }
  })

  it('stops with exit 2 when reported model usage exceeds the case-pack budget', async () => {
    const fixture = await createFixture()
    const originalSkill = await readFile(join(fixture.skillDir, 'SKILL.md'), 'utf8')
    const server = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  claim: 'Write outside the owned Skill directory',
                  files: [{ path: '../outside.md', content: 'escaped' }],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 120, completion_tokens: 401 },
        }),
      )
    })
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('mock model server did not bind')

    try {
      let failure: unknown
      try {
        await execFileAsync(
          process.execPath,
          [
            '--import',
            'tsx',
            cliPath,
            'shadow',
            fixture.skillDir,
            '--case-pack',
            fixture.casePackDir,
            '--output',
            fixture.outputDir,
          ],
          {
            cwd: packageRoot,
            env: {
              ...process.env,
              DSH_EVOLVE_MODEL_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
              DSH_EVOLVE_MODEL_NAME: 'over-budget-model',
            },
          },
        )
      } catch (error) {
        failure = error
      }

      expect(failure).toMatchObject({
        code: 2,
        stdout: '',
        stderr: 'incomplete: model output token budget exceeded: 401 > 400\n',
      })
      expect(await readFile(join(fixture.skillDir, 'SKILL.md'), 'utf8')).toBe(originalSkill)
      const report = JSON.parse(await readFile(join(fixture.outputDir, 'report.json'), 'utf8'))
      expect(report.run.status).toBe('incomplete')
      expect(report.budget.inputTokens).toBe(120)
      expect(report.budget.outputTokens).toBe(401)
      expect(report).not.toHaveProperty('decision')
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      )
    }
  })

  it.skipIf(process.platform !== 'darwin')('recommends an inactive correction only after sealed calibration and a paired Trial', async () => {
    const fixture = await createFixture()
    const { correctedSkill, originalSkill, skillPath } = await configureBrowserTrial(fixture)

    let proposerRequest = ''
    const server = createServer(async (request, response) => {
      for await (const chunk of request) proposerRequest += chunk
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              claim: 'Require real browser verification for UI work',
              files: [{ path: 'SKILL.md', content: correctedSkill }],
            }),
          },
        }],
        usage: { prompt_tokens: 130, completion_tokens: 38 },
      }))
    })
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('mock model server did not bind')

    try {
      const result = await execFileAsync(
        process.execPath,
        [
          '--import',
          'tsx',
          cliPath,
          'shadow',
          fixture.skillDir,
          '--case-pack',
          fixture.casePackDir,
          '--output',
          fixture.outputDir,
        ],
        {
          cwd: packageRoot,
          env: {
            ...process.env,
            DSH_EVOLVE_MODEL_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
            DSH_EVOLVE_MODEL_NAME: 'fixed-correction-model',
          },
        },
      )

      expect(result.stderr).toBe('')
      const report = JSON.parse(await readFile(join(fixture.outputDir, 'report.json'), 'utf8'))
      expect(result.stdout, JSON.stringify(report.calibration)).toMatch(/^promote: candidate passed sealed final-test while baseline failed; report: .+\/report\.json\n$/)
      expect(proposerRequest).toContain('A GUI plugin change passed component tests')
      expect(proposerRequest).not.toContain('case-pack-only-final-test-sentinel')
      expect(await readFile(skillPath, 'utf8')).toBe(originalSkill)
      expect(report).toMatchObject({
        run: { status: 'complete' },
        subject: { unchanged: true },
        calibration: [
          { id: 'known-bad', expected: 'fail', actual: 'fail', passed: true },
          { id: 'known-correction', expected: 'pass', actual: 'pass', passed: true },
        ],
        cases: [{
          id: 'real-browser-e2e',
          partition: 'final-test',
          baseline: 'fail',
          candidate: 'pass',
          checks: [{ name: 'real-browser-e2e', passed: true }],
        }],
        decision: {
          recommendation: 'promote',
          reasons: ['candidate passed sealed final-test while baseline failed'],
        },
      })
      expect(report.trial).toMatchObject({ backend: 'darwin-seatbelt', count: 4 })
      expect(await listTree(fixture.outputDir)).toEqual([
        'evidence',
        'evidence/proposal.json',
        'report.json',
        'run-state.json',
      ])
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      )
    }
  })

  it.skipIf(process.platform !== 'darwin')('refuses an uncalibrated Case Pack before any proposer request', async () => {
    const fixture = await createFixture()
    await configureBrowserTrial(fixture)
    await cp(
      join(fixture.casePackDir, 'calibration', 'known-bad', 'SKILL.md'),
      join(fixture.casePackDir, 'calibration', 'known-correction', 'SKILL.md'),
    )
    let proposalRequests = 0
    const server = createServer((_request, response) => {
      proposalRequests += 1
      response.setHeader('content-type', 'application/json')
      response.end('{}')
    })
    await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('mock model server did not bind')

    try {
      await expect(execFileAsync(process.execPath, [
        '--import', 'tsx', cliPath, 'shadow', fixture.skillDir,
        '--case-pack', fixture.casePackDir,
        '--output', fixture.outputDir,
      ], {
        cwd: packageRoot,
        env: {
          ...process.env,
          DSH_EVOLVE_MODEL_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
          DSH_EVOLVE_MODEL_NAME: 'must-not-be-called',
        },
      })).rejects.toMatchObject({
        code: 2,
        stdout: '',
        stderr: 'incomplete: case pack calibration failed before proposal\n',
      })
      expect(proposalRequests).toBe(0)
      const report = JSON.parse(await readFile(join(fixture.outputDir, 'report.json'), 'utf8'))
      expect(report).toMatchObject({
        run: { status: 'incomplete' },
        calibration: [
          { id: 'known-bad', passed: true },
          { id: 'known-correction', expected: 'pass', actual: 'fail', passed: false },
        ],
        budget: { inputTokens: 0, outputTokens: 0 },
      })
      expect(report).not.toHaveProperty('candidate')
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close(error => error ? rejectClose(error) : resolveClose()),
      )
    }
  })

  it.skipIf(process.platform !== 'darwin')('uses an exact private Feedback Case Draft only as proposer evidence before sealed Trial', async () => {
    const fixture = await createFixture()
    const { correctedSkill, originalSkill, skillPath } = await configureBrowserTrial(fixture)
    const feedbackDraftPath = join(fixture.root, 'feedback-draft.json')
    const draftContent = {
      schemaVersion: 1 as const,
      status: 'draft' as const,
      source: {
        signalId: '1'.repeat(64),
        sessionId: 'feedback-session',
        messageId: 'feedback-message',
        feedbackVersion: '8efc182b-fc7f-44ac-894c-efc6bfe56252',
        generationId: '2'.repeat(64),
        assistantSeq: 9,
        turn: 1,
        prefixHash: '3'.repeat(64),
      },
      target: {
        kind: 'skill' as const,
        name: 'build-dsh-plugin',
        artifact: {
          kind: 'skill' as const,
          name: 'build-dsh-plugin',
          gitCommit: '4'.repeat(40),
          treeHash: '5'.repeat(64),
        },
        contentHash: await hashTree(fixture.skillDir),
      },
      sample: {
        userText: '/build-dsh-plugin finish the visible settings flow',
        correction: 'Run the visible browser flow and inspect its failure before completion.',
      },
      limitations: [
        'Draft only: no replay result or evaluator score exists yet.',
        'Contains the direct user text and correction, never the assistant response, Tool output, or Skill body.',
      ],
    }
    const draft = { ...draftContent, id: sha256(canonicalJson(draftContent)) }
    await writeFile(feedbackDraftPath, `${JSON.stringify(draft, null, 2)}\n`, { mode: 0o600 })
    let proposerRequest = ''
    let proposalRequests = 0
    const server = createServer(async (request, response) => {
      proposalRequests += 1
      for await (const chunk of request) proposerRequest += chunk
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              claim: 'Require real browser verification for UI work',
              files: [{ path: 'SKILL.md', content: correctedSkill }],
            }),
          },
        }],
        usage: { prompt_tokens: 160, completion_tokens: 38 },
      }))
    })
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('mock model server did not bind')

    try {
      const result = await execFileAsync(
        process.execPath,
        [
          '--import', 'tsx', cliPath, 'shadow', fixture.skillDir,
          '--case-pack', fixture.casePackDir,
          '--feedback-draft', feedbackDraftPath,
          '--output', fixture.outputDir,
        ],
        {
          cwd: packageRoot,
          env: {
            ...process.env,
            DSH_EVOLVE_MODEL_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
            DSH_EVOLVE_MODEL_NAME: 'fixed-feedback-correction-model',
          },
        },
      )

      expect(result.stdout).toMatch(/^promote: candidate passed sealed final-test while baseline failed;/)
      expect(result.stderr).toBe('')
      expect(proposerRequest).toContain(draft.sample.userText)
      expect(proposerRequest).toContain(draft.sample.correction)
      expect(proposerRequest).toContain('untrusted search evidence, not evaluator truth')
      expect(proposerRequest).not.toContain('case-pack-only-final-test-sentinel')
      expect(await readFile(skillPath, 'utf8')).toBe(originalSkill)

      const report = JSON.parse(await readFile(join(fixture.outputDir, 'report.json'), 'utf8'))
      const state = JSON.parse(await readFile(join(fixture.outputDir, 'run-state.json'), 'utf8'))
      expect(report).toMatchObject({
        run: { status: 'complete' },
        epoch: { feedbackDraftId: draft.id },
        cases: [{ baseline: 'fail', candidate: 'pass' }],
        decision: { recommendation: 'promote' },
      })
      expect(state).toMatchObject({
        identity: { feedbackDraftId: draft.id },
        resumeInputs: { feedbackDraftPath },
      })
      const durableEvidence = [
        JSON.stringify(report),
        JSON.stringify(state),
        await readFile(join(fixture.outputDir, 'evidence', 'proposal.json'), 'utf8'),
      ].join('\n')
      expect(durableEvidence).not.toContain(draft.sample.userText)
      expect(durableEvidence).not.toContain(draft.sample.correction)

      const mismatchedContent = {
        ...draftContent,
        target: { ...draftContent.target, contentHash: '9'.repeat(64) },
      }
      const mismatched = {
        ...mismatchedContent,
        id: sha256(canonicalJson(mismatchedContent)),
      }
      const mismatchedPath = join(fixture.root, 'mismatched-feedback-draft.json')
      await writeFile(mismatchedPath, `${JSON.stringify(mismatched, null, 2)}\n`, { mode: 0o600 })
      await expect(execFileAsync(
        process.execPath,
        [
          '--import', 'tsx', cliPath, 'shadow', fixture.skillDir,
          '--case-pack', fixture.casePackDir,
          '--feedback-draft', mismatchedPath,
          '--output', fixture.outputDir,
        ],
        {
          cwd: packageRoot,
          env: {
            ...process.env,
            DSH_EVOLVE_MODEL_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
            DSH_EVOLVE_MODEL_NAME: 'fixed-feedback-correction-model',
          },
        },
      )).rejects.toMatchObject({
        code: 1,
        stdout: '',
        stderr: 'error: feedback draft does not match the exact active Skill content\n',
      })
      expect(proposalRequests).toBe(1)
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close(error => error ? rejectClose(error) : resolveClose()),
      )
    }
  })

  it.skipIf(process.platform !== 'darwin')('returns incomplete when the case pack changes after its evidence hash is captured', async () => {
    const fixture = await createFixture()
    const { correctedSkill, originalSkill, skillPath } = await configureBrowserTrial(fixture)
    const server = createServer(async (request, response) => {
      for await (const _chunk of request) {
        // Drain the request before changing evidence used by this run.
      }
      await writeFile(join(fixture.casePackDir, 'concurrent-change.txt'), 'changed')
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              claim: 'Require real browser verification for UI work',
              files: [{ path: 'SKILL.md', content: correctedSkill }],
            }),
          },
        }],
        usage: { prompt_tokens: 130, completion_tokens: 38 },
      }))
    })
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('mock model server did not bind')

    try {
      let failure: unknown
      try {
        await execFileAsync(
          process.execPath,
          [
            '--import',
            'tsx',
            cliPath,
            'shadow',
            fixture.skillDir,
            '--case-pack',
            fixture.casePackDir,
            '--output',
            fixture.outputDir,
          ],
          {
            cwd: packageRoot,
            env: {
              ...process.env,
              DSH_EVOLVE_MODEL_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
              DSH_EVOLVE_MODEL_NAME: 'fixed-correction-model',
            },
          },
        )
      } catch (error) {
        failure = error
      }

      expect(failure).toMatchObject({
        code: 2,
        stdout: '',
        stderr: 'incomplete: case pack changed during shadow evaluation\n',
      })
      expect(await readFile(skillPath, 'utf8')).toBe(originalSkill)
      const report = JSON.parse(await readFile(join(fixture.outputDir, 'report.json'), 'utf8'))
      expect(report.run.status).toBe('incomplete')
      expect(report.epoch.casePackUnchanged).toBe(false)
      expect(report).not.toHaveProperty('decision')
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      )
    }
  })

  it.skipIf(process.platform !== 'darwin')('rejects a Candidate that changes the owned Skill identity even when the final-test would pass', async () => {
    const fixture = await createFixture()
    const { correctedSkill, originalSkill, skillPath } = await configureBrowserTrial(fixture)
    const renamedSkill = correctedSkill.replace('name: build-dsh-plugin', 'name: renamed-skill')
    const server = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              claim: 'Rename the Skill while adding browser verification',
              files: [{ path: 'SKILL.md', content: renamedSkill }],
            }),
          },
        }],
        usage: { prompt_tokens: 130, completion_tokens: 38 },
      }))
    })
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('mock model server did not bind')

    try {
      const result = await execFileAsync(
        process.execPath,
        [
          '--import',
          'tsx',
          cliPath,
          'shadow',
          fixture.skillDir,
          '--case-pack',
          fixture.casePackDir,
          '--output',
          fixture.outputDir,
        ],
        {
          cwd: packageRoot,
          env: {
            ...process.env,
            DSH_EVOLVE_MODEL_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
            DSH_EVOLVE_MODEL_NAME: 'fixed-rename-model',
          },
        },
      )

      expect(result.stderr).toBe('')
      expect(result.stdout).toMatch(/^reject: candidate changed the Skill name; report: .+\/report\.json\n$/)
      expect(await readFile(skillPath, 'utf8')).toBe(originalSkill)
      const report = JSON.parse(await readFile(join(fixture.outputDir, 'report.json'), 'utf8'))
      expect(report).toMatchObject({
        run: { status: 'complete' },
        subject: { skillName: 'build-dsh-plugin', unchanged: true },
        cases: [{
          id: 'real-browser-e2e',
          candidate: 'fail',
          checks: [{ name: 'skill-name-stable', passed: false }],
        }],
        decision: {
          recommendation: 'reject',
          reasons: ['candidate changed the Skill name'],
        },
      })
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      )
    }
  })

  it.skipIf(process.platform !== 'darwin')('returns incomplete when evaluator aggregate contradicts its checks', async () => {
    const fixture = await createFixture()
    const { correctedSkill, originalSkill, skillPath } = await configureBrowserTrial(fixture)
    await writeFile(
      join(fixture.casePackDir, 'final-test', 'evaluator.mjs'),
      `process.stdout.write(JSON.stringify({ schemaVersion: 1, passed: true, checks: [{ name: 'contradiction', passed: false }] }))`,
    )
    const server = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              claim: 'Require real browser verification for UI work',
              files: [{ path: 'SKILL.md', content: correctedSkill }],
            }),
          },
        }],
        usage: { prompt_tokens: 130, completion_tokens: 38 },
      }))
    })
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('mock model server did not bind')

    try {
      let failure: unknown
      try {
        await execFileAsync(
          process.execPath,
          [
            '--import',
            'tsx',
            cliPath,
            'shadow',
            fixture.skillDir,
            '--case-pack',
            fixture.casePackDir,
            '--output',
            fixture.outputDir,
          ],
          {
            cwd: packageRoot,
            env: {
              ...process.env,
              DSH_EVOLVE_MODEL_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
              DSH_EVOLVE_MODEL_NAME: 'fixed-correction-model',
            },
          },
        )
      } catch (error) {
        failure = error
      }

      expect(failure).toMatchObject({
        code: 2,
        stdout: '',
        stderr: 'incomplete: Trial evaluator aggregate contradicts its checks\n',
      })
      expect(await readFile(skillPath, 'utf8')).toBe(originalSkill)
      const report = JSON.parse(await readFile(join(fixture.outputDir, 'report.json'), 'utf8'))
      expect(report.run.status).toBe('incomplete')
      expect(report).not.toHaveProperty('decision')
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      )
    }
  })
})

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`
}

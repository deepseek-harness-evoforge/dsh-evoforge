import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
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
  it('rejects an out-of-scope model patch without changing the active Skill', async () => {
    const fixture = await createFixture()
    const originalSkill = await readFile(join(fixture.skillDir, 'SKILL.md'), 'utf8')
    const requests: unknown[] = []
    const server = createServer(async (request, response) => {
      let body = ''
      for await (const chunk of request) body += chunk
      requests.push(JSON.parse(body))
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
          },
        },
      )

      expect(result.stderr).toBe('')
      expect(result.stdout).toMatch(/^reject: candidate attempted to change a non-owned path; report: .+\/report\.json\n$/)
      expect(requests).toHaveLength(1)
      expect(await readFile(join(fixture.skillDir, 'SKILL.md'), 'utf8')).toBe(originalSkill)
      await expect(readFile(join(fixture.root, 'outside.md'), 'utf8')).rejects.toThrow()

      const report = JSON.parse(await readFile(join(fixture.outputDir, 'report.json'), 'utf8'))
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
})

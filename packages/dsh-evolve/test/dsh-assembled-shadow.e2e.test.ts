import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
  ?? resolve(suiteRoot, '../deepseek-harness')
const cliPath = join(packageRoot, 'src', 'cli.ts')
const skillDir = join(suiteRoot, 'examples', 'skills', 'browser-e2e-baseline')
const casePackDir = join(suiteRoot, 'examples', 'case-packs', 'browser-e2e-guidance-assembled')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe.skipIf(process.platform !== 'darwin')('DSH assembled Shadow', () => {
  it('calibrates and compares a Skill through the real Loader, Agent Loop, Skill, and tool path', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'dsh-evolve-assembled-output-'))
    await rm(outputDir, { recursive: true })
    temporaryRoots.push(outputDir)
    const originalSkill = await readFile(join(skillDir, 'SKILL.md'), 'utf8')
    const correctedSkill = `${originalSkill.trimEnd()}\n\nFor Web or GUI work, verify the real flow in a controlled browser, refresh once, and inspect the visible failure path.\n`
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
    await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
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
          skillDir,
          '--case-pack',
          casePackDir,
          '--output',
          outputDir,
        ],
        {
          cwd: packageRoot,
          env: {
            ...process.env,
            DSH_EVOLVE_DSH_SOURCE_DIR: dshSourceDir,
            DSH_EVOLVE_MODEL_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
            DSH_EVOLVE_MODEL_NAME: 'fixed-assembled-correction-model',
          },
          timeout: 90_000,
        },
      )

      expect(result.stderr).toBe('')
      expect(result.stdout).toMatch(/^promote: candidate passed sealed final-test while baseline failed; report: .+\/report\.json\n$/)
      const report = JSON.parse(await readFile(join(outputDir, 'report.json'), 'utf8'))
      expect(report).toMatchObject({
        calibration: [
          { id: 'known-bad', expected: 'fail', actual: 'fail', passed: true },
          { id: 'known-correction', expected: 'pass', actual: 'pass', passed: true },
        ],
        cases: [{
          id: 'real-browser-e2e-assembled',
          baseline: 'fail',
          candidate: 'pass',
          checks: expect.arrayContaining([
            { name: 'real-loader-agent-turn', passed: true },
            { name: 'skill-on-demand-injected', passed: true },
            { name: 'real-tool-round-trip', passed: true },
            { name: 'guidance-reaches-model-history', passed: true },
            { name: 'skill-body-outside-request-prefix', passed: true },
          ]),
        }],
        composition: {
          stable: true,
          allowedDifference: ['skill.body'],
        },
        trial: {
          backend: 'darwin-seatbelt',
          count: 4,
          modelCalls: { baseline: 2, candidate: 2 },
        },
        decision: { recommendation: 'promote' },
      })
      expect(report.composition.baselineFingerprint).toMatch(/^[a-f0-9]{64}$/)
      expect(report.composition.candidateFingerprint).toBe(report.composition.baselineFingerprint)
      expect(report.trial.usage.baseline).toMatchObject({ inputTokens: 18, outputTokens: 8, cacheReadTokens: 2 })
      expect(report.trial.usage.candidate).toEqual(report.trial.usage.baseline)
      expect(await readFile(join(skillDir, 'SKILL.md'), 'utf8')).toBe(originalSkill)
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close(error => error ? rejectClose(error) : resolveClose()),
      )
    }
  }, 100_000)
})

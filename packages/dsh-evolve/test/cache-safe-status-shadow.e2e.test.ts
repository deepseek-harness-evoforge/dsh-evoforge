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
const skillDir = join(suiteRoot, 'skills', 'build-dsh-plugin')
const casePackDir = join(suiteRoot, 'examples', 'case-packs', 'cache-safe-status')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe.skipIf(process.platform !== 'darwin')('cache-safe-status assembled Shadow', () => {
  it('keeps a passing host-only baseline stable and refuses to invent an improvement', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'dsh-evolve-cache-safe-output-'))
    await rm(outputDir, { recursive: true })
    temporaryRoots.push(outputDir)
    const originalSkill = await readFile(join(skillDir, 'SKILL.md'), 'utf8')
    const candidateSkill = `${originalSkill.trimEnd()}\n\nA Client UI must read an authoritative host projection and must not mirror changing status into model context.\n`
    const server = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              claim: 'Clarify that Client UI reads the host projection',
              files: [{ path: 'SKILL.md', content: candidateSkill }],
            }),
          },
        }],
        usage: { prompt_tokens: 920, completion_tokens: 92 },
      }))
    })
    await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('mock model server did not bind')

    try {
      const result = await execFileAsync(
        process.execPath,
        [
          '--import', 'tsx', cliPath, 'shadow', skillDir,
          '--case-pack', casePackDir,
          '--output', outputDir,
        ],
        {
          cwd: packageRoot,
          env: {
            ...process.env,
            DSH_EVOLVE_DSH_SOURCE_DIR: dshSourceDir,
            DSH_EVOLVE_MODEL_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
            DSH_EVOLVE_MODEL_NAME: 'fixed-cache-safe-candidate-model',
          },
          timeout: 100_000,
        },
      )

      expect(result.stderr).toBe('')
      expect(result.stdout).toMatch(/^review: candidate did not improve the passing baseline; report: .+\/report\.json\n$/)
      const report = JSON.parse(await readFile(join(outputDir, 'report.json'), 'utf8'))
      expect(report).toMatchObject({
        calibration: [
          { id: 'known-bad', expected: 'fail', actual: 'fail', passed: true },
          { id: 'known-correction', expected: 'pass', actual: 'pass', passed: true },
        ],
        cases: [{
          id: 'cache-safe-status',
          baseline: 'pass',
          candidate: 'pass',
          checks: expect.arrayContaining([
            { name: 'plugin-typecheck', passed: true },
            { name: 'real-loader-boot', passed: true },
            { name: 'host-status-projection', passed: true },
            { name: 'status-update-keeps-composition-stable', passed: true },
            { name: 'status-absent-from-model-surface', passed: true },
            { name: 'dispose-removes-host-service', passed: true },
            { name: 'removal-restores-native-composition', passed: true },
            { name: 'non-target-composition-stable', passed: true },
          ]),
        }],
        composition: { stable: true, allowedDifference: ['skill.body'] },
        trial: {
          backend: 'darwin-seatbelt',
          count: 4,
          modelCalls: { baseline: 0, candidate: 0 },
          usage: { baseline: {}, candidate: {} },
        },
        decision: {
          recommendation: 'review',
          reasons: ['candidate did not improve the passing baseline'],
        },
      })
      expect(report.composition.baselineFingerprint).toMatch(/^[a-f0-9]{64}$/)
      expect(report.composition.candidateFingerprint).toBe(report.composition.baselineFingerprint)
      expect(await readFile(join(skillDir, 'SKILL.md'), 'utf8')).toBe(originalSkill)
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close(error => error ? rejectClose(error) : resolveClose()),
      )
    }
  }, 110_000)
})

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
const cliPath = join(packageRoot, 'test', 'fixtures', 'shadow-driver.ts')
const skillDir = join(suiteRoot, 'skills', 'build-dsh-plugin')
const casePackDir = join(suiteRoot, 'examples', 'case-packs', 'profile-install-remove')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe.skipIf(process.platform !== 'darwin')('profile-install-remove assembled Shadow', () => {
  it('installs the needed Bundle, boots its exact patch, and restores native DSH after removal', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'dsh-evolve-profile-install-output-'))
    await rm(outputDir, { recursive: true })
    temporaryRoots.push(outputDir)
    const originalSkill = await readFile(join(skillDir, 'SKILL.md'), 'utf8')
    const candidateSkill = `${originalSkill.trimEnd()}\n\nProfile acceptance should compare dumps before install, after activation, and after removal.\n`
    const server = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              claim: 'Clarify profile dump checkpoints',
              files: [{ path: 'SKILL.md', content: candidateSkill }],
            }),
          },
        }],
        usage: { prompt_tokens: 960, completion_tokens: 98 },
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
            DSH_EVOLVE_MODEL_NAME: 'fixed-profile-install-candidate-model',
          },
          timeout: 140_000,
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
          id: 'profile-install-remove',
          baseline: 'pass',
          candidate: 'pass',
          checks: expect.arrayContaining([
            { name: 'plugin-parse', passed: true },
            { name: 'real-dsh-plugin-add', passed: true },
            { name: 'bundle-selected-on-install', passed: true },
            { name: 'dump-config-has-exact-row', passed: true },
            { name: 'installed-profile-boots', passed: true },
            { name: 'real-dsh-plugin-remove', passed: true },
            { name: 'profile-manifest-restored', passed: true },
            { name: 'native-dump-restored', passed: true },
            { name: 'native-profile-boots', passed: true },
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
  }, 150_000)
})

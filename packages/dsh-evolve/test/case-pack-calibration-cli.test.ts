import { execFile } from 'node:child_process'
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const cliPath = join(packageRoot, 'test', 'fixtures', 'shadow-driver.ts')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('dsh-evolve calibrate', () => {
  it('refuses to place calibration evidence inside the Case Pack', async () => {
    const fixture = await createFixture()
    const casePackBefore = await snapshotTree(fixture.casePackDir)

    await expect(execFileAsync(process.execPath, [
      '--import', 'tsx', cliPath, 'calibrate',
      '--case-pack', fixture.casePackDir,
      '--output', join(fixture.casePackDir, 'calibration-run'),
    ], { cwd: packageRoot })).rejects.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'error: calibration output directory must be outside the case pack\n',
    })
    expect(await snapshotTree(fixture.casePackDir)).toEqual(casePackBefore)
  })

  it.skipIf(process.platform !== 'darwin')('proves a Case Pack calibration without a model route or Candidate', async () => {
    const fixture = await createFixture()
    const casePackBefore = await snapshotTree(fixture.casePackDir)

    const result = await execFileAsync(process.execPath, [
      '--import', 'tsx', cliPath, 'calibrate',
      '--case-pack', fixture.casePackDir,
      '--output', fixture.outputDir,
    ], {
      cwd: packageRoot,
      env: {
        ...process.env,
        DSH_EVOLVE_MODEL_BASE_URL: '',
        DSH_EVOLVE_MODEL_NAME: '',
        DSH_EVOLVE_MODEL_API_KEY: 'must-not-be-read',
      },
    })

    expect(result.stderr).toBe('')
    expect(result.stdout).toMatch(/^calibrated: known-bad failed and known-correction passed; report: .+\/calibration-report\.json\n$/)
    expect(await snapshotTree(fixture.casePackDir)).toEqual(casePackBefore)
    expect(await readdir(fixture.outputDir)).toEqual(['calibration-report.json'])
    const reportSource = await readFile(join(fixture.outputDir, 'calibration-report.json'), 'utf8')
    expect(reportSource).not.toContain('must-not-be-read')
    expect(JSON.parse(reportSource)).toMatchObject({
      schemaVersion: 1,
      run: { status: 'complete' },
      calibrated: true,
      epoch: {
        evaluatorVersion: 'browser-e2e-guidance-v1',
      },
      calibration: [
        { id: 'known-bad', expected: 'fail', actual: 'fail', passed: true },
        { id: 'known-correction', expected: 'pass', actual: 'pass', passed: true },
      ],
      trial: { backend: 'darwin-seatbelt', count: 2 },
      model: { calls: 0, inputTokens: 0, outputTokens: 0 },
    })
  })

  it.skipIf(process.platform !== 'darwin')('returns not-calibrated evidence when known correction does not pass', async () => {
    const fixture = await createFixture()
    await cp(
      join(fixture.casePackDir, 'calibration', 'known-bad', 'SKILL.md'),
      join(fixture.casePackDir, 'calibration', 'known-correction', 'SKILL.md'),
    )

    await expect(execFileAsync(process.execPath, [
      '--import', 'tsx', cliPath, 'calibrate',
      '--case-pack', fixture.casePackDir,
      '--output', fixture.outputDir,
    ], { cwd: packageRoot })).rejects.toMatchObject({
      code: 2,
      stdout: '',
      stderr: expect.stringMatching(/^not-calibrated: known-correction expected pass but got fail; report: .+\/calibration-report\.json\n$/),
    })
    expect(JSON.parse(await readFile(join(fixture.outputDir, 'calibration-report.json'), 'utf8')))
      .toMatchObject({ run: { status: 'complete' }, calibrated: false })
  })
})

async function createFixture(): Promise<{
  casePackDir: string
  outputDir: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-calibrate-'))
  temporaryRoots.push(root)
  const casePackDir = join(root, 'case-pack')
  await cp(
    join(suiteRoot, 'examples', 'case-packs', 'browser-e2e-guidance'),
    casePackDir,
    { recursive: true },
  )
  return { casePackDir, outputDir: join(root, 'calibration-run') }
}

async function snapshotTree(root: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {}
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else snapshot[path.slice(root.length + 1)] = await readFile(path, 'utf8')
    }
  }
  await visit(root)
  return snapshot
}

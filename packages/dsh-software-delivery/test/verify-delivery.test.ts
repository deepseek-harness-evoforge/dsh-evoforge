import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyDelivery } from '../src/verify-delivery.js'

const execFile = promisify(execFileCallback)
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('delivery verifier', () => {
  it('accepts a clean committed change in a linked worktree after every declared check passes', async () => {
    const fixture = await createDeliveryFixture()
    const report = await verifyDelivery({
      worktree: fixture.worktree,
      baseRef: 'main',
      checks: [{ name: 'unit', argv: [process.execPath, '-e', 'process.stdout.write("ok")'] }],
    })

    expect(report).toMatchObject({
      schemaVersion: 1,
      status: 'passed',
      reason: 'verified',
      artifact: { kind: 'git-commit', commit: fixture.headCommit, branch: 'feature/delivery' },
      repository: {
        worktree: fixture.worktree,
        branch: 'feature/delivery',
        baseRef: 'main',
        baseCommit: fixture.baseCommit,
        headCommit: fixture.headCommit,
        ahead: 1,
        clean: true,
        linkedWorktree: true,
      },
    })
    expect(report.checks).toEqual([
      expect.objectContaining({
        name: 'unit',
        argv: [process.execPath, '-e', 'process.stdout.write("ok")'],
        status: 'passed',
        exitCode: 0,
        stdout: expect.objectContaining({ text: 'ok', bytes: 2, truncated: false }),
      }),
    ])
  })

  it('rejects a primary checkout before executing repository commands supplied as checks', async () => {
    const fixture = await createDeliveryFixture()
    const marker = join(fixture.root, 'must-not-exist')
    const report = await verifyDelivery({
      worktree: fixture.repository,
      baseRef: 'main~1',
      checks: [{
        name: 'side-effect',
        argv: [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'bad')`],
      }],
    })

    expect(report.status).toBe('failed')
    expect(report.reason).toBe('linked-worktree-required')
    expect(report.checks).toEqual([])
    await expect(readFile(marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects uncommitted changes before executing checks', async () => {
    const fixture = await createDeliveryFixture()
    const marker = join(fixture.root, 'must-not-exist')
    await writeFile(join(fixture.worktree, 'dirty.txt'), 'dirty\n')

    const report = await verifyDelivery({
      worktree: fixture.worktree,
      baseRef: 'main',
      checks: [{
        name: 'side-effect',
        argv: [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'bad')`],
      }],
    })

    expect(report.status).toBe('failed')
    expect(report.reason).toBe('worktree-not-clean')
    expect(report.checks).toEqual([])
    await expect(readFile(marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports a failing check with bounded, hashed output and does not run later checks', async () => {
    const fixture = await createDeliveryFixture()
    const marker = join(fixture.root, 'must-not-exist')
    const report = await verifyDelivery({
      worktree: fixture.worktree,
      baseRef: 'main',
      outputLimitBytes: 32,
      checks: [
        {
          name: 'failure',
          argv: [process.execPath, '-e', 'process.stderr.write("x".repeat(100)); process.exit(7)'],
        },
        {
          name: 'later',
          argv: [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'bad')`],
        },
      ],
    })

    expect(report.status).toBe('failed')
    expect(report.reason).toBe('check-failed:failure')
    expect(report.checks).toHaveLength(1)
    expect(report.checks[0]).toMatchObject({
      name: 'failure',
      status: 'failed',
      exitCode: 7,
      stderr: { bytes: 100, truncated: true },
    })
    expect(report.checks[0]?.stderr.text).toHaveLength(32)
    expect(report.checks[0]?.stderr.sha256).toMatch(/^[a-f0-9]{64}$/)
    await expect(readFile(marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('never inherits credential-bearing environment variables into a declared check', async () => {
    const fixture = await createDeliveryFixture()
    const previous = process.env.DSH_DELIVERY_TEST_SECRET
    process.env.DSH_DELIVERY_TEST_SECRET = 'must-not-leak'
    try {
      const report = await verifyDelivery({
        worktree: fixture.worktree,
        baseRef: 'main',
        checks: [{
          name: 'no-secret',
          argv: [
            process.execPath,
            '-e',
            'if (process.env.DSH_DELIVERY_TEST_SECRET) process.exit(9)',
          ],
        }],
      })
      expect(report.status).toBe('passed')
    } finally {
      if (previous === undefined) delete process.env.DSH_DELIVERY_TEST_SECRET
      else process.env.DSH_DELIVERY_TEST_SECRET = previous
    }
  })

  it('returns unknown for a timed-out check instead of claiming delivery failure or hanging', async () => {
    const fixture = await createDeliveryFixture()
    const descendantMarker = join(fixture.root, 'descendant-must-die')
    const descendant = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(descendantMarker)}, 'leak'), 1500)`
    const parent = [
      `require('node:child_process').spawn(${JSON.stringify(process.execPath)},`,
      `['-e', ${JSON.stringify(descendant)}], { stdio: 'inherit' });`,
      'setInterval(() => {}, 10_000)',
    ].join(' ')
    const report = await verifyDelivery({
      worktree: fixture.worktree,
      baseRef: 'main',
      timeoutMs: 1_000,
      checks: [{ name: 'hang', argv: [process.execPath, '-e', parent] }],
    })

    expect(report).toMatchObject({
      status: 'unknown',
      reason: 'check-inconclusive:hang',
      checks: [{ name: 'hang', status: 'unknown', signal: 'SIGTERM' }],
    })
    await new Promise(resolve => setTimeout(resolve, 800))
    await expect(readFile(descendantMarker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  }, 5_000)

  it('rejects a check that dirties the repository after reporting success', async () => {
    const fixture = await createDeliveryFixture()
    const report = await verifyDelivery({
      worktree: fixture.worktree,
      baseRef: 'main',
      checks: [{
        name: 'dirty-check',
        argv: [process.execPath, '-e', 'require("node:fs").writeFileSync("generated.txt", "drift")'],
      }],
    })

    expect(report.status).toBe('failed')
    expect(report.reason).toBe('repository-changed-during-checks')
    expect(report.checks).toEqual([expect.objectContaining({ name: 'dirty-check', status: 'passed' })])
  })

  it('fails malformed JSON-shaped check input before touching the filesystem', async () => {
    await expect(verifyDelivery({
      worktree: '/does/not/matter',
      baseRef: 'main',
      checks: [null as unknown as { name: string; argv: string[] }],
    })).rejects.toThrow('check 1 must be an object')
  })
})

async function createDeliveryFixture(): Promise<{
  root: string
  repository: string
  worktree: string
  baseCommit: string
  headCommit: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-delivery-test-'))
  temporaryRoots.push(root)
  const repository = join(root, 'repository')
  const worktree = join(root, 'feature-worktree')
  await git(root, 'init', '--initial-branch=main', repository)
  await git(repository, 'config', 'user.name', 'DSH Delivery Test')
  await git(repository, 'config', 'user.email', 'delivery@example.invalid')
  await writeFile(join(repository, 'README.md'), 'baseline\n')
  await git(repository, 'add', 'README.md')
  await git(repository, 'commit', '-m', 'baseline')
  const baseCommit = await git(repository, 'rev-parse', 'HEAD')
  await git(repository, 'worktree', 'add', '-b', 'feature/delivery', worktree)
  await writeFile(join(worktree, 'feature.txt'), 'delivered\n')
  await git(worktree, 'add', 'feature.txt')
  await git(worktree, 'commit', '-m', 'deliver feature')
  const headCommit = await git(worktree, 'rev-parse', 'HEAD')
  return {
    root,
    repository: await realpath(repository),
    worktree: await realpath(worktree),
    baseCommit,
    headCommit,
  }
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd, encoding: 'utf8' })).stdout.trim()
}

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseArgs, verifyManifest } from './install-suite.mjs'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptsDir, '..')
const installer = join(scriptsDir, 'install-suite.mjs')

test('installer defaults to the complete product and web profile', () => {
  assert.deepEqual(parseArgs([]), { suite: 'product', profile: 'web', help: false })
  assert.deepEqual(parseArgs(['--suite', 'channels', '--channel', 'feishu', '--profile', 'personal']), {
    suite: 'channels',
    channel: 'feishu',
    profile: 'personal',
    help: false,
  })
  assert.throws(() => parseArgs(['--profile', '../unsafe']), /simple DSH profile/u)
  assert.throws(() => parseArgs(['--unknown']), /Unknown argument/u)
  assert.deepEqual(parseArgs(['--artifact-dir', '/tmp/evoforge-artifacts']), {
    suite: 'product',
    profile: 'web',
    artifactDir: '/tmp/evoforge-artifacts',
    help: false,
  })
})

test('manifest verification returns exact absolute files and rejects drift', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evoforge-manifest-test-'))
  try {
    const filename = 'dsh-test-0.0.0.tgz'
    const bytes = Buffer.from('verified tarball fixture')
    await writeFile(join(root, filename), bytes)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    assert.deepEqual(await verifyManifest({ packages: [{ filename, sha256 }] }, root), [join(root, filename)])
    await assert.rejects(verifyManifest({ packages: [{ filename, sha256: '0'.repeat(64) }] }, root), /SHA-256 mismatch/u)
    await assert.rejects(verifyManifest({ packages: [{ filename: '../escape.tgz', sha256 }] }, root), /unsafe filename/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('CLI installs from a manifest-verified persistent artifact directory and removes only staging', async () => {
  const fixture = await createFakeCommands()
  try {
    const artifacts = join(fixture.root, 'artifacts')
    const result = runInstaller(fixture, {}, ['--artifact-dir', artifacts])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Installed product into profile web/u)
    assert.doesNotMatch(
      `${result.stdout}\n${result.stderr}`,
      /PROFILE_DUMP_SECRET_MARKER|PLUGIN_LIST_PRIVATE_MARKER|PLUGIN_ADD_NOISE_MARKER|PACK_BUILD_NOISE_MARKER/u,
    )
    const calls = await readCalls(fixture.log)
    assert.equal(calls.filter(args => args.includes('--dump-config')).length, 1)
    assert.deepEqual(calls[0], ['plugin', '--profile', 'web', 'list', '--depth=0', '--json'])
    const add = calls.find(args => args.includes('add'))
    assert.ok(add)
    assert.ok(add.includes('--ignore-scripts'))
    const tarball = add.find(value => value.endsWith('.tgz'))
    assert.equal(typeof tarball, 'string')
    assert.ok(tarball.startsWith('/'))
    assert.ok(tarball.startsWith(artifacts))
    assert.equal(tarball.startsWith(repositoryRoot), false)
    assert.match(tarball, /dsh-evoforge-test-0\.0\.0\.tgz$/u)
    const manifestPath = result.stdout.match(/Verified manifest: (.+)\n/u)?.[1]
    assert.ok(manifestPath)
    assert.equal(existsSync(manifestPath), true)
    assert.equal(existsSync(tarball), true)
    assert.deepEqual(await verifyManifest(JSON.parse(await readFile(manifestPath, 'utf8')), dirname(manifestPath)), [tarball])
    assert.deepEqual((await readdir(artifacts)).filter(name => name.startsWith('.staging-')), [])
  } finally {
    await fixture.dispose()
  }
})

test('CLI can repair an installed package set before a broken profile can dump or boot', async () => {
  const fixture = await createFakeCommands()
  try {
    const artifacts = join(fixture.root, 'artifacts')
    const result = runInstaller(
      fixture,
      { EVOFORGE_TEST_BROKEN_BEFORE_ADD: '1' },
      ['--artifact-dir', artifacts],
    )
    assert.equal(result.status, 0, result.stderr)
    const calls = await readCalls(fixture.log)
    const listIndex = calls.findIndex(args => args.includes('list'))
    const addIndex = calls.findIndex(args => args.includes('add'))
    const dumpIndex = calls.findIndex(args => args.includes('--dump-config'))
    assert.equal(listIndex, 0)
    assert.ok(addIndex > listIndex)
    assert.ok(dumpIndex > addIndex)
  } finally {
    await fixture.dispose()
  }
})

test('CLI follows XDG_DATA_HOME when no artifact override is supplied', async () => {
  const fixture = await createFakeCommands()
  try {
    const xdg = join(fixture.root, 'xdg-data')
    const result = runInstaller(fixture, { XDG_DATA_HOME: xdg, XDG_CACHE_HOME: join(fixture.root, 'must-not-use') })
    assert.equal(result.status, 0, result.stderr)
    const manifestPath = result.stdout.match(/Verified manifest: (.+)\n/u)?.[1]
    assert.ok(manifestPath)
    assert.ok(manifestPath.startsWith(join(xdg, 'dsh-evoforge', 'packs')))
    assert.equal(existsSync(manifestPath), true)
  } finally {
    await fixture.dispose()
  }
})

test('CLI reports add failure and preserves the exact recovery pack', async () => {
  const fixture = await createFakeCommands()
  try {
    const artifacts = join(fixture.root, 'artifacts')
    const result = runInstaller(fixture, { EVOFORGE_TEST_FAIL_ADD: '1' }, ['--artifact-dir', artifacts])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /DSH plugin add failed with exit 7/u)
    const recovery = result.stderr.match(/Persistent recovery pack: (.+)\n/u)?.[1]
    assert.ok(recovery)
    assert.equal(existsSync(recovery), true)
    assert.ok(recovery.startsWith(artifacts))
  } finally {
    await fixture.dispose()
  }
})

test('CLI distinguishes a failed post-install dump from a failed add', async () => {
  const fixture = await createFakeCommands()
  try {
    const artifacts = join(fixture.root, 'artifacts')
    const result = runInstaller(fixture, { EVOFORGE_TEST_FAIL_POST_DUMP: '1' }, ['--artifact-dir', artifacts])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /post-install DSH dump failed with exit 9/u)
    assert.match(result.stderr, /add command succeeded before a later check failed/u)
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /PROFILE_DUMP_SECRET_MARKER/u)
    const recovery = result.stderr.match(/Persistent recovery pack: (.+)\n/u)?.[1]
    assert.ok(recovery)
    assert.equal(existsSync(recovery), true)
  } finally {
    await fixture.dispose()
  }
})

function runInstaller(fixture, overrides = {}, args = []) {
  return spawnSync(process.execPath, [installer, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...overrides,
      PATH: `${fixture.bin}:${process.env.PATH ?? ''}`,
      EVOFORGE_TEST_CALL_LOG: fixture.log,
    },
  })
}

async function createFakeCommands() {
  const root = await mkdtemp(join(tmpdir(), 'evoforge-installer-cli-'))
  const bin = join(root, 'bin')
  await (await import('node:fs/promises')).mkdir(bin)
  const log = join(root, 'dsh-calls.jsonl')
  await writeExecutable(join(bin, 'pnpm'), `#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
const args = process.argv.slice(2)
const value = flag => args[args.indexOf(flag) + 1]
const suite = value('--suite')
const channel = args.includes('--channel') ? value('--channel') : undefined
const output = value('--out')
const id = channel === undefined ? suite : \`${'${suite}-${channel}'}\`
const dir = join(output, id)
await mkdir(dir, { recursive: true })
const filename = 'dsh-evoforge-test-0.0.0.tgz'
const bytes = Buffer.from('installer integration fixture')
await writeFile(join(dir, filename), bytes)
await writeFile(join(dir, 'evoforge-suite.json'), JSON.stringify({
  packages: [{ filename, sha256: createHash('sha256').update(bytes).digest('hex') }],
}))
process.stdout.write('PACK_BUILD_NOISE_MARKER\\n')
`)
  await writeExecutable(join(bin, 'dsh'), `#!/usr/bin/env node
import { appendFile, readFile } from 'node:fs/promises'
const args = process.argv.slice(2)
const log = process.env.EVOFORGE_TEST_CALL_LOG
await appendFile(log, JSON.stringify(args) + '\\n')
if (args.includes('--dump-config')) {
  process.stdout.write('PROFILE_DUMP_SECRET_MARKER=stdout-secret\\n')
  process.stderr.write('token: PROFILE_DUMP_SECRET_MARKER-stderr-secret\\n')
}
if (args.includes('list')) process.stdout.write('{"private":"PLUGIN_LIST_PRIVATE_MARKER"}\\n')
if (args.includes('add')) process.stdout.write('PLUGIN_ADD_NOISE_MARKER\\n')
if (process.env.EVOFORGE_TEST_BROKEN_BEFORE_ADD === '1' && args.includes('--dump-config')) {
  const calls = (await readFile(log, 'utf8')).trim().split('\\n').map(JSON.parse)
  if (!calls.some(call => call.includes('add'))) process.exit(23)
}
if (process.env.EVOFORGE_TEST_FAIL_ADD === '1' && args.includes('add')) process.exit(7)
if (process.env.EVOFORGE_TEST_FAIL_POST_DUMP === '1' && args.includes('--dump-config')) {
  const calls = (await readFile(log, 'utf8')).trim().split('\\n').map(JSON.parse)
  if (calls.some(call => call.includes('add'))) process.exit(9)
}
`)
  return { root, bin, log, dispose: () => rm(root, { recursive: true, force: true }) }
}

async function writeExecutable(path, source) {
  await writeFile(path, source)
  await chmod(path, 0o755)
}

async function readCalls(path) {
  return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)
}

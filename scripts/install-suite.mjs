import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DEFAULT_SUITE_ID, getSuite } from './suite-manifest.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2))
}

async function main(values) {
  let stagingRoot
  let persistentDir
  let addSucceeded = false
  let profile = 'web'
  try {
    const args = parseArgs(values)
    if (args.help) {
      process.stdout.write(`Usage: pnpm run dsh:install -- [--suite ${DEFAULT_SUITE_ID}|delivery|continuity] [--profile web] [--channel feishu|telegram] [--artifact-dir DIR]\n`)
      return
    }
    const suite = getSuite(args.suite)
    profile = args.profile
    const artifactRoot = resolveArtifactRoot(args.artifactDir)
    await mkdir(artifactRoot, { recursive: true })
    stagingRoot = await mkdtemp(join(artifactRoot, '.staging-'))
    const outputId = args.channel === undefined ? suite.id : `${suite.id}-${args.channel}`
    const stagingOutputDir = join(stagingRoot, outputId)

    const packArgs = ['run', 'pack:suite', '--', '--suite', suite.id, '--out', stagingRoot]
    if (args.channel !== undefined) packArgs.push('--channel', args.channel)
    checkedRun('pnpm', packArgs, 'suite packaging', {
      capture: true,
      captureFailureNotice: '. Build output was withheld; run pnpm run pack:suite directly for detailed diagnostics',
    })

    const stagingManifestPath = join(stagingOutputDir, 'evoforge-suite.json')
    const stagingManifest = await readJson(stagingManifestPath)
    await verifyManifest(stagingManifest, stagingOutputDir)
    persistentDir = await persistPack(stagingOutputDir, artifactRoot, outputId)
    const manifestPath = join(persistentDir, 'evoforge-suite.json')
    const manifest = await readJson(manifestPath)
    const packageFiles = await verifyManifest(manifest, persistentDir)

    checkedRun(
      'dsh',
      ['plugin', '--profile', profile, 'list', '--depth=0', '--json'],
      'DSH plugin inventory preflight',
      { capture: true },
    )
    // EvoForge publishes prebuilt Bundles. Explicitly disable dependency install
    // scripts so a clean DSH profile does not stop at pnpm's allowBuilds prompt
    // (notably protobufjs through the Feishu SDK), and so installation never
    // grants third-party build authority on the user's behalf.
    checkedRun(
      'dsh',
      ['plugin', '--profile', profile, 'add', ...packageFiles, '--ignore-scripts'],
      'DSH plugin add',
      {
        capture: true,
        captureFailureNotice: '. Package-manager output was withheld to avoid exposing profile paths',
      },
    )
    addSucceeded = true
    checkedRun(
      'dsh',
      ['--profile', profile, '--dump-config'],
      'post-install DSH dump',
      {
        capture: true,
        partialWarning: `Packages may already be installed. Inspect profile ${profile} and use ${manifestPath} for exact recovery names.`,
      },
    )

    process.stdout.write(`Installed ${suite.id}${args.channel === undefined ? '' : `/${args.channel}`} into profile ${profile}.\n`)
    process.stdout.write(`Verified manifest: ${manifestPath}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    if (addSucceeded) process.stderr.write(`The add command succeeded before a later check failed; inspect profile ${profile} before retrying.\n`)
    if (persistentDir !== undefined) process.stderr.write(`Persistent recovery pack: ${persistentDir}\n`)
    process.exitCode = 1
  } finally {
    if (stagingRoot !== undefined && persistentDir !== undefined) {
      await rm(stagingRoot, { recursive: true, force: true })
    } else if (stagingRoot !== undefined) {
      process.stderr.write(`Staging kept for recovery: ${stagingRoot}\n`)
    }
  }
}

export function parseArgs(values) {
  const result = { suite: DEFAULT_SUITE_ID, profile: 'web', help: false }
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === '--') continue
    if (value === '--suite') result.suite = required(values, ++index, '--suite')
    else if (value === '--profile') result.profile = required(values, ++index, '--profile')
    else if (value === '--channel') result.channel = required(values, ++index, '--channel')
    else if (value === '--artifact-dir') result.artifactDir = required(values, ++index, '--artifact-dir')
    else if (value === '--help' || value === '-h') result.help = true
    else throw new Error(`Unknown argument: ${value}`)
  }
  if (!/^[A-Za-z0-9._-]+$/u.test(result.profile)) throw new Error('--profile must be a simple DSH profile name')
  return result
}

function required(values, index, flag) {
  const value = values[index]
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

function checkedRun(command, args, label, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    ...(options.capture
      ? { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }
      : { stdio: 'inherit' }),
    shell: false,
  })
  const partialWarning = options.partialWarning === undefined ? '' : `. ${options.partialWarning}`
  if (result.error !== undefined) {
    const code = typeof result.error.code === 'string' ? ` (${result.error.code})` : ''
    const withheld = options.capture
      ? (options.captureFailureNotice ?? '. Captured output was withheld to protect profile data')
      : ''
    throw new Error(`${label} could not start${code}${withheld}${partialWarning}`)
  }
  if (result.status !== 0) {
    const signal = result.signal === null ? '' : `, signal ${result.signal}`
    const withheld = options.capture
      ? (options.captureFailureNotice ?? '. Captured output was withheld to protect profile data')
      : ''
    throw new Error(`${label} failed with exit ${result.status ?? 'unknown'}${signal}${withheld}${partialWarning}`)
  }
}

function resolveArtifactRoot(artifactDir) {
  if (artifactDir !== undefined) return resolve(repositoryRoot, artifactDir)
  const xdg = process.env.XDG_DATA_HOME?.trim()
  if (xdg !== undefined && xdg.length > 0 && isAbsolute(xdg)) return join(xdg, 'dsh-evoforge', 'packs')
  const userHome = homedir()
  if (process.platform === 'darwin') return join(userHome, 'Library', 'Application Support', 'dsh-evoforge', 'packs')
  const localAppData = process.env.LOCALAPPDATA?.trim()
  if (process.platform === 'win32' && localAppData !== undefined && localAppData.length > 0 && isAbsolute(localAppData)) {
    return join(localAppData, 'dsh-evoforge', 'packs')
  }
  return join(userHome, '.local', 'share', 'dsh-evoforge', 'packs')
}

async function persistPack(stagingOutputDir, artifactRoot, outputId) {
  const manifestBytes = await readFile(join(stagingOutputDir, 'evoforge-suite.json'))
  const manifestHash = createHash('sha256').update(manifestBytes).digest('hex')
  const suiteArtifacts = join(artifactRoot, outputId)
  const destination = join(suiteArtifacts, manifestHash)
  await mkdir(suiteArtifacts, { recursive: true })
  try {
    await rename(stagingOutputDir, destination)
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined
    if (code !== 'EEXIST' && code !== 'ENOTEMPTY') throw error
    const existingManifest = await readFile(join(destination, 'evoforge-suite.json'))
    const existingHash = createHash('sha256').update(existingManifest).digest('hex')
    if (existingHash !== manifestHash) throw new Error(`Persistent artifact collision at ${destination}`)
    await verifyManifest(JSON.parse(existingManifest.toString('utf8')), destination)
  }
  return destination
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch (error) {
    throw new Error(`Cannot read generated suite manifest ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function verifyManifest(manifest, outputDir) {
  if (!Array.isArray(manifest.packages) || manifest.packages.length === 0) throw new Error('Generated suite manifest has no packages')
  const files = []
  for (const item of manifest.packages) {
    if (typeof item?.filename !== 'string' || basename(item.filename) !== item.filename || isAbsolute(item.filename)) {
      throw new Error('Generated suite manifest contains an unsafe filename')
    }
    if (!/^[a-f0-9]{64}$/u.test(item.sha256 ?? '')) throw new Error(`Invalid SHA-256 for ${item.filename}`)
    const path = join(outputDir, item.filename)
    try {
      if (!(await stat(path)).isFile()) throw new Error('not a file')
    } catch {
      throw new Error(`Missing generated package ${path}`)
    }
    const digest = createHash('sha256').update(await readFile(path)).digest('hex')
    if (digest !== item.sha256) throw new Error(`SHA-256 mismatch for ${item.filename}`)
    files.push(path)
  }
  return files
}

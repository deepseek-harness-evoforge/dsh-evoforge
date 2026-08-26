/** Pure user-level launchd/systemd adapter behind the DSH-native control command. */
import { execFile as execFileCallback } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

export type Manager = 'launchd' | 'systemd'

const execFile = promisify(execFileCallback)

export interface Plan {
  schemaVersion: 1
  action: 'plan'
  manager: Manager
  serviceId: string
  unitPath: string
  profile: string
  dshHome: string
  cwd: string
  nodeBin: string
  dshEntry: string
  command: readonly [string, string, '--profile', string, ...string[]]
  definition: string
  logRoot?: string
}

export interface ServiceLocation {
  manager: Manager
  serviceId: string
  unitPath: string
  profile: string
  dshHome: string
}

export async function createPlan(input: {
  manager: Manager
  profile: string
  dshEntry: string
  nodeBin: string
  dshHome: string
  cwd: string
  /** Disable the Web app's default browser handoff when the target is a Web profile. */
  noOpen?: boolean
}): Promise<Plan> {
  validateProfile(input.profile)
  const [dshEntry, nodeBin, dshHome, cwd, userHome] = await Promise.all([
    existingAbsoluteFile(input.dshEntry, '--dsh-entry'),
    existingExecutable(input.nodeBin, '--node-bin'),
    existingAbsoluteDirectory(input.dshHome, '--dsh-home'),
    existingAbsoluteDirectory(input.cwd, '--cwd'),
    existingAbsoluteDirectory(process.env.HOME ?? homedir(), 'user home'),
  ])
  const { identity, serviceId, unitPath } = await createLocation({
    manager: input.manager,
    profile: input.profile,
    dshHome,
    userHome,
  })
  const command = [
    nodeBin,
    dshEntry,
    '--profile',
    input.profile,
    ...(input.noOpen === true ? ['--no-open'] : []),
  ] as Plan['command']
  if (input.manager === 'launchd') {
    const logRoot = join(dshHome, 'resident', identity)
    return {
      schemaVersion: 1,
      action: 'plan',
      manager: input.manager,
      serviceId,
      unitPath,
      profile: input.profile,
      dshHome,
      cwd,
      nodeBin,
      dshEntry,
      command,
      logRoot,
      definition: renderLaunchd({
        serviceId,
        command,
        dshHome,
        cwd,
        stdoutPath: join(logRoot, 'stdout.log'),
        stderrPath: join(logRoot, 'stderr.log'),
      }),
    }
  }
  return {
    schemaVersion: 1,
    action: 'plan',
    manager: input.manager,
    serviceId,
    unitPath,
    profile: input.profile,
    dshHome,
    cwd,
    nodeBin,
    dshEntry,
    command,
    definition: renderSystemd({ profile: input.profile, dshHome, cwd, command }),
  }
}

export async function createLocation(input: {
  manager: Manager
  profile: string
  dshHome: string
  userHome?: string
}): Promise<ServiceLocation & { identity: string }> {
  validateProfile(input.profile)
  const dshHome = absolute(input.dshHome, '--dsh-home')
  const userHome = input.userHome
    ?? await existingAbsoluteDirectory(process.env.HOME ?? homedir(), 'user home')
  const identity = createHash('sha256')
    .update(dshHome)
    .update('\0')
    .update(input.profile)
    .digest('hex')
    .slice(0, 16)
  const serviceId = `io.evoforge.dsh.${identity}`
  const unitPath = input.manager === 'launchd'
    ? join(userHome, 'Library', 'LaunchAgents', `${serviceId}.plist`)
    : join(userHome, '.config', 'systemd', 'user', `${serviceId}.service`)
  return {
    manager: input.manager,
    serviceId,
    unitPath,
    profile: input.profile,
    dshHome,
    identity,
  }
}

export async function applyPlan(plan: Plan): Promise<Record<string, unknown>> {
  await mkdir(dirname(plan.unitPath), { recursive: true, mode: 0o700 })
  if (plan.logRoot !== undefined) await mkdir(plan.logRoot, { recursive: true, mode: 0o700 })
  await atomicWrite(plan.unitPath, plan.definition)
  if (plan.manager === 'systemd') {
    const unit = unitName(plan.unitPath)
    await runSystemctl(['daemon-reload'])
    await runSystemctl(['enable', unit])
    await runSystemctl(['restart', unit])
    const current = await systemdState(unit)
    if (!current.registered || !current.active) {
      throw new Error(`systemd did not enable and start ${unit}`)
    }
    return appliedStatus(plan, current.registered, current.active)
  }
  const target = launchdTarget(plan.serviceId)
  if (await isLaunchdRegistered(plan.serviceId)) {
    await runLaunchctl(['bootout', target])
  }
  await runLaunchctl(['bootstrap', launchdDomain(), plan.unitPath])
  const current = await launchdState(plan.serviceId)
  if (!current.registered) {
    throw new Error(`launchd did not register ${plan.serviceId}`)
  }
  return appliedStatus(plan, true, current.active)
}

function appliedStatus(plan: Plan, registered: boolean, active: boolean): Record<string, unknown> {
  return {
    schemaVersion: 1,
    action: 'applied',
    manager: plan.manager,
    serviceId: plan.serviceId,
    unitPath: plan.unitPath,
    profile: plan.profile,
    dshHome: plan.dshHome,
    registered,
    active,
    unitPresent: true,
    ...(plan.logRoot === undefined ? {} : { logRoot: plan.logRoot }),
  }
}

export async function status(location: ServiceLocation): Promise<Record<string, unknown>> {
  if (location.manager === 'systemd') {
    const current = await systemdState(unitName(location.unitPath))
    return serviceStatus(location, current.registered, 'status', current.active)
  }
  const current = await launchdState(location.serviceId)
  return serviceStatus(location, current.registered, 'status', current.active)
}

export async function removeService(location: ServiceLocation): Promise<Record<string, unknown>> {
  if (location.manager === 'systemd') {
    const unit = unitName(location.unitPath)
    const current = await systemdState(unit)
    if (current.registered || current.active) {
      await runSystemctl(['disable', '--now', unit])
    }
    await rm(location.unitPath, { force: true })
    await runSystemctl(['daemon-reload'])
    return serviceStatus(location, false, 'removed', false)
  }
  if (await isLaunchdRegistered(location.serviceId)) {
    await runLaunchctl(['bootout', launchdTarget(location.serviceId)])
  }
  await rm(location.unitPath, { force: true })
  return serviceStatus(location, false, 'removed', false)
}

async function serviceStatus(
  location: ServiceLocation,
  registered: boolean,
  action: 'status' | 'removed' = 'status',
  active = registered,
): Promise<Record<string, unknown>> {
  return {
    schemaVersion: 1,
    action,
    manager: location.manager,
    serviceId: location.serviceId,
    unitPath: location.unitPath,
    profile: location.profile,
    dshHome: location.dshHome,
    registered,
    active,
    unitPresent: await exists(location.unitPath),
  }
}

function unitName(unitPath: string): string {
  return unitPath.slice(unitPath.lastIndexOf('/') + 1)
}

async function systemdState(unit: string): Promise<{ registered: boolean; active: boolean }> {
  const registered = await systemctlQuery(['is-enabled', unit], [1, 3, 4])
  const active = await systemctlQuery(['is-active', unit], [1, 3, 4])
  return { registered, active }
}

async function systemctlQuery(args: readonly string[], falseCodes: readonly number[]): Promise<boolean> {
  try {
    await runSystemctl(args)
    return true
  } catch (error: unknown) {
    const code = typeof error === 'object' && error !== null
      ? (error as { code?: unknown }).code
      : undefined
    if (typeof code === 'number' && falseCodes.includes(code)) return false
    throw error
  }
}

async function runSystemctl(args: readonly string[]): Promise<void> {
  const executable = resolveSystemctl()
  try {
    await execFile(executable, ['--user', ...args], { encoding: 'utf8', timeout: 10_000 })
  } catch (error: unknown) {
    const failed = error as { code?: unknown; stdout?: string; stderr?: string }
    const detail = `${failed.stdout ?? ''}${failed.stderr ?? ''}`.trim()
    throw Object.assign(
      new Error(`systemctl ${args[0] ?? ''} failed${detail === '' ? '' : `: ${detail}`}`, { cause: error }),
      { code: failed.code },
    )
  }
}

function resolveSystemctl(): string {
  const override = process.env.DSH_RESIDENT_TEST_SYSTEMCTL
  if (override !== undefined) {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('DSH_RESIDENT_TEST_SYSTEMCTL is accepted only under NODE_ENV=test')
    }
    return absolute(override, 'DSH_RESIDENT_TEST_SYSTEMCTL')
  }
  return '/usr/bin/systemctl'
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false)
}

function launchdDomain(): string {
  const uid = process.getuid?.()
  if (uid === undefined) throw new Error('launchd requires a POSIX user id')
  return `gui/${uid}`
}

function launchdTarget(serviceId: string): string {
  return `${launchdDomain()}/${serviceId}`
}

async function isLaunchdRegistered(serviceId: string): Promise<boolean> {
  return (await launchdState(serviceId)).registered
}

async function launchdState(serviceId: string): Promise<{ registered: boolean; active: boolean }> {
  try {
    const output = await runLaunchctl(['print', launchdTarget(serviceId)])
    return { registered: true, active: /\bstate = running\b/u.test(output) }
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 113) {
      return { registered: false, active: false }
    }
    throw error
  }
}

async function runLaunchctl(args: readonly string[]): Promise<string> {
  try {
    return (await execFile('/bin/launchctl', [...args], { encoding: 'utf8', timeout: 10_000 })).stdout
  } catch (error: unknown) {
    const failed = error as { code?: unknown; stdout?: string; stderr?: string }
    const detail = `${failed.stdout ?? ''}${failed.stderr ?? ''}`.trim()
    throw Object.assign(
      new Error(`launchctl ${args[0] ?? ''} failed${detail === '' ? '' : `: ${detail}`}`, { cause: error }),
      { code: failed.code },
    )
  }
}

export function requireNativeManager(manager: Manager): void {
  if (manager === 'systemd'
    && process.env.NODE_ENV === 'test'
    && process.env.DSH_RESIDENT_TEST_SYSTEMCTL !== undefined) return
  const expected: Manager | undefined = process.platform === 'darwin'
    ? 'launchd'
    : process.platform === 'linux'
      ? 'systemd'
      : undefined
  if (manager !== expected) {
    throw new Error(`${manager} deployment is not supported on ${process.platform}`)
  }
}

function renderLaunchd(input: {
  serviceId: string
  command: Plan['command']
  dshHome: string
  cwd: string
  stdoutPath: string
  stderrPath: string
}): string {
  const xml = escapeXml
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(input.serviceId)}</string>
  <key>ProgramArguments</key>
  <array>
${input.command.map(value => `    <string>${xml(value)}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(input.cwd)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>DSH_HOME</key>
    <string>${xml(input.dshHome)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(input.stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(input.stderrPath)}</string>
</dict>
</plist>
`
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function renderSystemd(input: {
  profile: string
  dshHome: string
  cwd: string
  command: Plan['command']
}): string {
  return `[Unit]
Description=DeepSeek Harness resident profile ${input.profile.replaceAll('%', '%%')}
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
ExecStart=${input.command.map(value => quoteSystemd(value)).join(' ')}
WorkingDirectory=${escapeSystemdPath(input.cwd)}
Environment=${quoteSystemd(`DSH_HOME=${input.dshHome}`, false)}
Restart=always
RestartSec=5s
KillSignal=SIGTERM
TimeoutStopSec=10s

[Install]
WantedBy=default.target
`
}

function quoteSystemd(value: string, expandEnvironment = true): string {
  return `"${value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('$', () => expandEnvironment ? '$$' : '$')
    .replaceAll('%', '%%')}"`
}

function escapeSystemdPath(value: string): string {
  return value
    .replaceAll('%', '%%')
    .replace(/[\\ "'#;]/gu, character => `\\x${character.charCodeAt(0).toString(16).padStart(2, '0')}`)
}

export function resolveManager(value: string | undefined): Manager {
  if (value === 'launchd' || value === 'systemd') return value
  if (value !== undefined) throw new Error('--manager must be launchd or systemd')
  if (process.platform === 'darwin') return 'launchd'
  if (process.platform === 'linux') return 'systemd'
  throw new Error(`unsupported platform ${process.platform}; use launchd or systemd explicitly for plan`)
}

function validateProfile(value: string): void {
  if (value === '' || value === '.' || value === '..' || value === 'node_modules'
    || value.includes('/') || value.includes('\\') || /[\u0000-\u001f\u007f]/u.test(value)
    || Buffer.byteLength(value) > 128) {
    throw new Error('invalid DSH profile name')
  }
}

async function existingAbsoluteFile(value: string, flag: string): Promise<string> {
  const path = absolute(value, flag)
  const info = await stat(path).catch(() => undefined)
  if (info?.isFile() !== true) throw new Error(`${flag} must name an existing file`)
  return path
}

async function existingExecutable(value: string, flag: string): Promise<string> {
  const path = absolute(value, flag)
  const info = await stat(path).catch(() => undefined)
  if (info?.isFile() !== true) throw new Error(`${flag} must name an existing file`)
  if ((info.mode & 0o111) === 0) throw new Error(`${flag} must be executable`)
  return path
}

async function existingAbsoluteDirectory(value: string, flag: string): Promise<string> {
  const path = absolute(value, flag)
  const info = await stat(path).catch(() => undefined)
  if (info?.isDirectory() !== true) throw new Error(`${flag} must name an existing directory`)
  return path
}

function absolute(value: string, flag: string): string {
  if (/[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`${flag} must not contain control characters`)
  const path = resolve(value)
  if (path !== value) throw new Error(`${flag} must be an absolute normalized path`)
  return path
}

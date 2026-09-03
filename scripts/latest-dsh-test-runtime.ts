import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Boot a legacy-style test composition on the current DSH profile.
 *
 * Older plugin fixtures embedded dsh-base's patch file as a nested Include
 * tree. DSH alpha.5 made bundles profile-owned layers, so that shape is no
 * longer a valid public composition. This adapter reads the fixture's own
 * rows, converts them into one overlay, and composes them over the exact
 * latest `headless` profile selected by the caller.
 */
export async function bootLatestDshProfile(options: {
  binName: string
  configPath: string
  dshSourceDir: string
  home: string
  userLayer?: boolean
}): Promise<any> {
  const appBoot = await import(pathToFileURL(
    join(options.dshSourceDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js'),
  ).href)
  const installAnchor = join(options.dshSourceDir, 'apps', 'cli', 'package.json')
  const profile = appBoot.loadProfile(
    options.binName,
    'headless',
    installAnchor,
    options.home,
    { userLayer: options.userLayer ?? false },
  )
  await appBoot.healProfilesModuleFallback({ installAnchor, profile, home: options.home })

  const raw = JSON.parse(await readFile(options.configPath, 'utf8')) as unknown
  if (!Array.isArray(raw)) throw new Error(`${options.binName}: test config must be a top-level entry array`)
  const entries = raw.filter(isEntry)
  const base = entries.find(entry => entry.id === 'base')
  const basePatches = isRecord(base?.config) && Array.isArray(base.config.patches)
    ? base.config.patches
    : []
  const directRows = entries.filter(entry => entry.id !== 'base')
  const knownNames = new Map<string, string>()
  for (const layer of profile.layers) collectIds(layer.patches, knownNames)
  const knownIds = new Set(knownNames.keys())
  const patches = [
    // These runners are only for the shipped headless CLI. Legacy plugin
    // fixtures create their own Agent and would otherwise leave them pending.
    { id: 'headless-startup', disabled: true },
    { id: 'headless-runner', disabled: true },
    ...basePatches,
    ...directRows.map(row => {
      if (!knownIds.has(row.id)) return { insert: [row] }
      const expectedName = knownNames.get(row.id)
      // Legacy fixtures used absolute source paths for rows now owned by the
      // profile bundle. A name mismatch is not a harmless config override in
      // Cordis; omit it so the current bundle identity remains authoritative.
      if (expectedName !== undefined && row.name !== undefined && row.name !== expectedName) {
        const { name: _legacyName, ...configOnly } = row
        return configOnly
      }
      return row
    }),
  ]
  const basePath = join(profile.dir, `${safeName(options.binName)}.cordis.yml`)
  await writeFile(basePath, '[]\n')
  const config = appBoot.renderConfigDump(
    options.binName,
    basePath,
    [
      ...profile.layers.map((layer: { packageName: string; patches: unknown[] }) => ({
        label: layer.packageName,
        patches: layer.patches,
      })),
      { label: options.configPath, patches },
    ],
  )
  await writeFile(basePath, config)
  return await appBoot.boot(options.binName, basePath)
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEntry(value: unknown): value is { id: string; [key: string]: any } {
  return isRecord(value) && typeof value.id === 'string'
}

function collectIds(value: unknown, target: Map<string, string>): void {
  if (!Array.isArray(value)) return
  for (const patch of value) {
    if (!isRecord(patch)) continue
    if (typeof patch.id === 'string' && typeof patch.name === 'string') target.set(patch.id, patch.name)
    if (Array.isArray(patch.insert)) {
      for (const entry of patch.insert) {
        if (isEntry(entry) && typeof entry.name === 'string') target.set(entry.id, entry.name)
        if (isRecord(entry) && Array.isArray(entry.config)) collectIds(entry.config, target)
      }
    }
  }
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'dsh-test'
}

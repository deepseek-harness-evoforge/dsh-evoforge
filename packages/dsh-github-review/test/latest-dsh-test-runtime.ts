export interface LatestDshTestRuntimeOptions {
  binName: string
  configPath: string
  dshSourceDir: string
  home: string
  userLayer?: boolean
}

/** Keep the repository-level fixture adapter outside this package's emitted source graph. */
export async function bootLatestDshProfile(options: LatestDshTestRuntimeOptions): Promise<any> {
  const moduleUrl = new URL('../../../scripts/latest-dsh-test-runtime.ts', import.meta.url).href
  const runtime = await import(moduleUrl) as {
    bootLatestDshProfile(input: LatestDshTestRuntimeOptions): Promise<any>
  }
  return runtime.bootLatestDshProfile(options)
}

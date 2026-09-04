import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-telegram-credentials-bootstrap'

/** Package-boundary credential seam: the installed adapter must not read process.env. */
export function apply(ctx: Context): void {
  ctx.provide('credentials' as never, {
    resolve: async (reference: string) => reference === 'DSH_TELEGRAM_PACKAGE_TEST_TOKEN'
      ? { value: 'package-test-token', source: 'fixture' }
      : undefined,
  } as never)
}

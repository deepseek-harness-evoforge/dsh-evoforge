/** The caller owns the native read deadline. Unavailable evidence never authorizes more work. */
export type ConversationSourceCheck = () => boolean | Promise<boolean>

export async function conversationSourceAvailable(check: ConversationSourceCheck, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return false
  try { return await check() === true && !signal.aborted }
  catch { return false }
}

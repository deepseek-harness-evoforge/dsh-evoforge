import {
  canonicalHeader,
  headerEquals,
  type EpochHeader,
} from '@deepseek-ai/dsh-session'

/** Read-only historical header shape, not a header emitted to the live Host. */
type TranscriptRequestHeader = EpochHeader & { readonly system?: string }

// alpha.5 stores the system prompt in request/header; rc.2 moved it to the
// message surface. The caller validates the selected dialect before using
// these helpers (including rejecting `system` in v3). Current native helpers
// still own config/default/tool semantics, but no longer retain the v0 field.
export function canonicalTranscriptHeader(
  header: TranscriptRequestHeader,
): TranscriptRequestHeader {
  return {
    ...canonicalHeader(header),
    ...(header.system !== undefined && header.system.length > 0
      ? { system: header.system }
      : {}),
  }
}

export function transcriptHeaderEquals(
  left: TranscriptRequestHeader,
  right: TranscriptRequestHeader,
): boolean {
  return left.system === right.system && headerEquals(left, right)
}

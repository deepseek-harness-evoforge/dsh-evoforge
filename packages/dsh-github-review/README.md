# dsh-github-review

Maintainer-only experiment that can append one bounded, untrusted GitHub `CHANGES_REQUESTED` review to the originating
DSH Session for an exact Draft PR head. It never merges, marks ready, releases, deploys, or grants Protected Action authority.

## Distribution status

This package is deliberately excluded from the public `delivery` suite. Private-repository access still uses a temporary
environment-reference compatibility field instead of DSH CredentialProvider, so public install, registry release, and
private-repository claims are blocked. Public repositories can be read without a token, but this does not make the package
a supported user feature.

Maintainers who test it must pack this one workspace package into a fresh directory, verify the produced filename and
SHA-256, preserve that directory as the profile's local package source, and use the official DSH `plugin add`. Do not use
the `delivery` suite or a wildcard: that suite intentionally contains only `dsh-software-delivery`.

## Boundary

- Only an allowlisted human review on the exact watched repository/head may enter the original Session.
- Bot, stale head, malformed/paginated-over-limit, rate-limited, or uncertain input does not enter the model.
- The package registers no Tool, Skill, Prompt, or idle model call. Actionable text is appended as one bounded user message.
- Durable prepared/delivered identities prevent duplicate follow-up after restart.

The package remains outside release claims until CredentialProvider migration and clean-profile/real-repository gates pass.

```sh
dsh plugin --profile web remove dsh-github-review
```

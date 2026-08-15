# Changelog

All notable changes will be recorded here. The project has not published a stable release.

## Unreleased

### Added

- Initial EvoForge research baseline, including the DSH 171-plugin catalog and comparisons with Claude Code Rev and Hermes Agent.
- `build-dsh-plugin`, an executable development Skill for cache-safe out-of-tree DSH extensions.
- `dsh-evolve` P0A.1 Shadow safety tracer with owned-path, symlink, integrity, token-budget and credential-persistence tests.
- A macOS Sealed Trial execution primitive with real read, write, process, network, environment, timeout and output-limit tests; it is not yet connected to `shadow`.
- Public status, contributor, support and security documentation.

### Security

- Candidate-generated code is not executed by `shadow` until an integrated Sealed Trial path can prove the declared read, write, process and network boundaries.

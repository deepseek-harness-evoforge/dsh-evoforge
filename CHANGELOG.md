# Changelog

All notable changes will be recorded here. The project has not published a stable release.

## Unreleased

### Added

- Initial EvoForge research baseline, including the DSH 171-plugin catalog and comparisons with Claude Code Rev and Hermes Agent.
- `build-dsh-plugin`, an executable development Skill for cache-safe out-of-tree DSH extensions.
- `dsh-evolve` P0A.1 Shadow safety tracer with owned-path, symlink, integrity, token-budget and credential-persistence tests.
- A macOS Sealed Trial execution primitive with real read, write, process, network, environment, timeout and output-limit tests.
- A calibrated `shadow` vertical slice that exposes only search evidence to the proposer, runs known-bad, known-correction, baseline and Candidate in separate macOS Sealed Trials, and keeps the final-test evaluator hidden.
- Public status, contributor, support and security documentation.

### Security

- `shadow` executes only the trusted single-file Case Pack evaluator inside the integrated macOS boundary. Candidate files are treated as inactive data; arbitrary Candidate code and assembled Agent execution remain disabled.

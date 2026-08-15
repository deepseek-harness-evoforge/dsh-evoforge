---
status: accepted
---

# Fail closed until Trial execution is sealed

DSH `sandbox-local` is a same-world file-effect boundary: it can constrain writes, but its public contract does not promise that candidate code cannot read the case pack, evaluator, other host files, or use the network. EvoForge therefore treats a Trial as sealed only when its execution path can attest the declared read, write, process, and network boundaries; otherwise `dsh-evolve shadow` returns `2 + incomplete` and never executes candidate-generated code or emits a recommendation. The proposer remains a no-tools model call over explicitly selected data, while Trial orchestration stays in `dsh-evolve` and reuses DSH capability seams; executor variation remains private until two real adapters justify a public seam.

## Considered options

- Treat `sandbox-local` as full Trial isolation: rejected because that would claim protections outside its documented contract.
- Run generated code unconfined and label the result experimental: rejected because it exposes sealed cases and host data before evaluator trust is established.
- Require one container product in the public interface now: rejected because it creates premature deployment lock-in before a second real execution environment exists.

## Consequences

P0A can keep advancing through hashing, scope, budget, report, calibration-data and static validation slices, but a real parse/test/build/assembled Candidate Trial cannot promote or reject until a sealed executor is integrated. The first private adapter is a macOS Seatbelt primitive; tests prove declared read/write/process/network boundaries, a clean environment, timeout and bounded captured output. It is wired only to a trusted single-file deterministic evaluator: Candidate files remain inactive data. It has no workspace disk quota and is not a cross-platform or arbitrary-code claim. Lack of a suitable integrated adapter is an expected incomplete result, not a reason to weaken the boundary or create a second Agent runtime.

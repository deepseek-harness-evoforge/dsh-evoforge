---
status: accepted isolation principle; proposer/target operation superseded by ADR-0068
---

# Fail closed until Trial execution is sealed

DSH `sandbox-local` is a same-world file-effect boundary: it can constrain writes, but its public contract does not promise that candidate code cannot read the case pack, evaluator, other host files, or use the network. EvoForge therefore treats a Trial as sealed only when its execution path can attest the declared read, write, process, and network boundaries; otherwise the Shadow run yields `incomplete` and never executes candidate-generated code or emits a recommendation. Candidate authoring may use a bounded no-tools model call in the separate internal author plane. Shadow itself no longer calls a proposer or accepts selected targets; it only executes one exact internally authored Candidate under the installed `dsh-evolve` Bundle. Executor variation remains private until two real adapters justify a public seam.

ADR-0041 superseded the original standalone process/exit-code entry surface. ADR-0068 later removed the target Command/proposer path. The fail-closed Trial decision remains accepted; current operational submission is internal supervisor/Job orchestration with an exact Candidate.

## Considered options

- Treat `sandbox-local` as full Trial isolation: rejected because that would claim protections outside its documented contract.
- Run generated code unconfined and label the result experimental: rejected because it exposes sealed cases and host data before evaluator trust is established.
- Require one container product in the public interface now: rejected because it creates premature deployment lock-in before a second real execution environment exists.

## Consequences

P0A can keep advancing through hashing, scope, budget, report, calibration-data and static validation slices, but a real parse/test/build/assembled Candidate Trial cannot promote or reject until its exact execution path is sealed. The first private adapter is a macOS Seatbelt primitive; tests prove declared read/write/process/network boundaries, a clean environment, timeout and bounded captured output. It first ran trusted single-file deterministic evaluators, then added an opt-in trusted assembled evaluator that verifies one exact DSH checkout and mounts only required DSH runtime trees read-only; checkout-root secrets and `.git` are outside the readable set. The Trial normally permits only declared Node/Bash processes. A profile-install fixture may separately declare `dshProfileInstall`; this is valid only with `dshAssembled`, resolves the repository-pinned `bin.pnpm` directly instead of trusting a mutable `.bin` wrapper, adds that pnpm package plus DSH `native/` as exact read-only roots, runs local install offline with scripts disabled, and still has no network or writes outside the Trial workspace. Other assembled fixtures do not inherit package-manager authority. Candidate remains Skill data: arbitrary Candidate code is not executed. The same runner may accept an externally discovered exact Candidate only for an assembled Trial, without calling a proposer. It derives a text-only proposal that the existing Generation publisher can reproduce exactly, refuses deletions and identity drift, and marks successful evidence for human provenance review so the automatic promotion policy cannot consume it. The executor still has no workspace disk quota and is not a cross-platform claim. Every future parse/build/plugin-code fixture must declare and test its extra executable and read boundary before it can influence a recommendation. Lack of a suitable integrated adapter is an expected incomplete result, not a reason to weaken the boundary or create a second Agent runtime.

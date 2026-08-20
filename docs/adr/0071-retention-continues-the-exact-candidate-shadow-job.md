# Retention continues the exact Candidate Shadow job

Accepted.

An internal Skill Candidate may enter Retention only after its exact qualified Admission has completed a promotable assembled Shadow. Admission re-resolves Evaluation Envelope v5 and hands off the optional Retention Case Pack path, exact content hash, and isolated run root together with the existing Candidate lineage. A v4 Envelope has no Retention partition and abstains without a Trial.

Retention is not a configured target and does not introduce another scheduler. The existing native DSH Jobs Shadow task continues into `InternalSkillRetention.evaluate(...)` after Shadow reaches a durable complete result. Before spending the Trial budget, the module re-reads the Shadow run state and report and requires exact agreement on Candidate, Admission, Envelope, lineage, capability-absent subject, Candidate tree, holdout identity, DSH revision, paired result, and non-target composition. It then replays the exact Candidate against the separately authored fifth-Goal Case Pack with zero proposer calls.

The run identity is content-addressed by Candidate, Admission, Envelope, Shadow run, and Retention Case Pack. A lock, immutable prepared identity, and terminal result make completed evaluation idempotent and recoverable; a mismatched or internally inconsistent durable verdict is rejected rather than reused. `retained` requires calibrated assembled evaluation, a passing prior-case baseline, a passing exact Candidate, stable composition, and unchanged governance inputs. A passing baseline with a failing Candidate is `regressed`; calibration, baseline, composition, execution, or integrity uncertainty is `incomplete`.

Every result has `releaseAuthority: none`. Retention does not publish, activate, approve, promote, mutate the current Session, run a canary, or replace the future release gate.

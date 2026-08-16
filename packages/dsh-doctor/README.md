# dsh-doctor

`dsh-doctor` is a removable, zero-token DSH Bundle that turns the current native Loader state into one actionable runtime-readiness answer. It does not repair DSH, replace package invariants, or maintain a second health database.

## Install

```bash
dsh plugin --profile web add dsh-doctor
```

The Bundle inserts one Host plugin row named `evoforge-doctor`. Remove it completely with:

```bash
dsh plugin --profile web remove dsh-doctor
```

By default, the report requires only `dsh-doctor` itself. To verify an expected EvoForge composition, add a later profile patch:

```yaml
- id: evoforge-doctor
  config:
    requiredModules:
      - dsh-doctor
      - dsh-evolve
      - dsh-evolve-web
      - dsh-software-delivery
```

Then run this from any interactive DSH surface that supports native Commands:

```text
/doctor
```

## Semantics

The report is point-in-time and three-state:

- `READY`: every configured required module has an enabled active Loader entry, and no enabled entry is failed;
- `NOT READY`: a required module is missing, disabled, or failed, or any enabled entry is failed;
- `UNKNOWN`: a required module is pending, loading, unloading, or has no live fiber; run the command again after Loader activity settles.

The output names exact module and entry ids plus a bounded next action. It never changes configuration, enables or disables a plugin, restarts DSH, reads credentials, or performs network/model calls.

## Cache contract

`dsh-doctor` registers one human Command and no Tool, Prompt, Skill, System Message, Session model surface, or background poller. Native Command input/output stays in the host plane, so normal Agent requests gain zero model tokens and retain their existing cacheable prefix and Tool Schema.

## Known limitations

- It diagnoses a runtime that booted far enough to provide native Loader and Commands; it cannot explain a profile that cannot boot at all.
- It reports the current snapshot only, with no uptime, history, provenance, ports, filesystem probes, or alerting.
- A `READY` report means the configured plugins are active, not that every external provider, credential, or downstream service is healthy.
- Auto-repair and background health monitoring are intentionally out of scope until real user evidence justifies them.

See [ADR-0027](../../docs/adr/0027-runtime-readiness-is-a-read-only-loader-projection.md) and the [implementation evidence](../../docs/evidence/dsh-doctor-runtime-readiness.zh.md).

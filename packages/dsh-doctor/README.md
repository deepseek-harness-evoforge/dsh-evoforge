# dsh-doctor

Read-only DSH Bundle that combines live Loader entries and redacted Gateway transport health into a bounded
`ready | not-ready | unknown` report. It registers `/doctor` and, when Control Center is present, a child surface that runs
the same command.

Normal users receive it with the complete product:

```sh
pnpm run dsh:install
```

Run `/doctor` in a native Session. Doctor does not inspect credentials, call a platform/model, poll, repair, restart, persist
health history, or create a second inventory. Loader remains Bundle authority; Gateway remains transport authority.

```sh
dsh plugin --profile web remove dsh-evoforge-doctor
```

# dsh-doctor

`dsh-doctor` is a read-only DSH Bundle. It projects the live native Loader entries and the existing `dsh-gateway` transport health snapshot into a bounded `ready | not-ready | unknown` report, then registers `/doctor` in the existing DSH Commands service.

```sh
dsh plugin --profile web add /absolute/path/dsh-doctor-0.1.0-alpha.1.tgz
dsh --profile web
```

Run `/doctor` inside a DSH session. Configure exact required module names by overriding `evoforge-doctor` in the profile patch. When `dsh-feishu` or `dsh-telegram` is required and active, the command also classifies the corresponding live Gateway transport as unavailable, connecting, ready, degraded, or stopping. A malformed or throwing Gateway snapshot fails closed as unavailable.

The plugin does not inspect credentials, call a platform, poll, repair, restart, persist health history, add model Tools/Skills, or create a second inventory. Loader remains the plugin lifecycle authority and Gateway remains the transport health authority.

```sh
dsh plugin --profile web remove dsh-doctor
```

The Command registration disappears with the plugin fiber.

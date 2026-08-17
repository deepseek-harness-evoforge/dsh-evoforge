# dsh-doctor

`dsh-doctor` is a read-only DSH Bundle. It projects the live native Loader entries into a bounded `ready | not-ready | unknown` report and registers `/doctor` in the existing DSH Commands service.

```sh
dsh plugin --profile web add /absolute/path/dsh-doctor-0.1.0-alpha.1.tgz
dsh --profile web
```

Run `/doctor` inside a DSH session. Configure exact required module names by overriding `evoforge-doctor` in the profile patch. The plugin does not poll, repair, restart, persist health history, add model Tools/Skills, or create a second inventory.

```sh
dsh plugin --profile web remove dsh-doctor
```

The Command registration disappears with the plugin fiber.

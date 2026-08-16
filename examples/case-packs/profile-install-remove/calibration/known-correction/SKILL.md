---
name: build-dsh-plugin
description: Build an installable DeepSeek Harness plugin.
---

# Build a DSH Plugin

Use a Bundle when installation should automatically add a profile patch layer. Export `cordis.patch.yml`, declare it in `dsh.bundle`, inspect the exact dump, boot the profile, remove through `dsh plugin`, and prove the native dump and boot are restored.

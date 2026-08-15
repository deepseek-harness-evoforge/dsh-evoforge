# Check cache stability at the composition surface

EvoForge treats DSH's reusable model prefix as a suite-wide design constraint, but measures it only when a plugin changes the complete model-visible composition. Stable prompt sections, tool names, schemas, and ordering are snapshotted together; changing runtime state is appended after the reusable prefix, while storage-only, UI-only, and telemetry-only plugins incur no artificial cache-reporting process.

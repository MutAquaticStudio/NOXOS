# NØX-OS

Gate 1 cloud engineering foundation for the NØX-OS modular monolith.

This repository contains no Gate 2+ business capability. It establishes the registry,
shell, provider-neutral ports, cloud automation contracts, and verification surface
required for later gates.

## Cloud-first commands

```text
pnpm validate
pnpm contracts:check-frozen-inputs
pnpm db:validate
pnpm infra:check
```

Routine operation is performed by GitHub Actions and provider integrations; users do
not need to run a local database, migration, or deployment workflow.

See [the operations guide](docs/operations/cloud-bootstrap.md).

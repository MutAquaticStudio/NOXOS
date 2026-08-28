# ADR 0002: Trusted Preview bootstrap and evidence gating

## Status

Accepted as G1 amendment B-001.

## Context

Preview acceptance uses `pull_request_target` and checks out the trusted base revision so that
untrusted pull-request code cannot execute with Vercel credentials. A Vercel deployment API
metadata shape change made the base verifier reject a legitimate Preview, but a repair in a PR
cannot validate itself because the workflow deliberately runs the old base verifier.

## Decision

The trusted verifier accepts both the legacy project field and Vercel's current nested
`project.id` shape, while requiring exact GitHub organization, repository, ref, SHA, READY
state, Preview target, and generated Vercel URL.

After successful HTTP, browser, isolation, and provider checks, Preview publishes a
SHA-bound attestation artifact. The Staging resolver requires the successful trusted
`preview-acceptance` run and its non-expired artifact for the exact merged PR head before
performing any operation with infrastructure, migration, or deployment side effects.

One administrator bypass is allowed only for the bootstrap PR described in the G1 contract.
The resulting main workflow must stop at the new missing-attestation gate. The next normal PR
creates the first valid attestation and is the first commit eligible for Staging deployment.

## Consequences

This keeps Preview secretless, preserves the normal Preview-before-Staging rule after bootstrap,
and makes a failed or forged status check insufficient for Staging. The bootstrap exception is
auditable and cannot be reused as a general merge policy.

## Amendment B-002: Persistent Staging is a Vercel custom environment

The NØX-OS Vercel project disables automatic Git deployment for `main`. A merge to `main` is
therefore not a Production deployment. The protected Staging workflow reconciles exactly one
Vercel custom environment with slug `staging`, then performs the exact-SHA deployment through
that environment from the configured application root (`apps/nox-os`).

The reconciliation reads first, creates only when absent, reads back after creation, and stops
on duplicate `staging` environments. Production deployment remains an explicit, separate
pipeline concern and is not exercised by Gate 1.

## Amendment B-003: Vercel CLI identity

The protected CI environment supplies `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` as the
project identity contract. The deployer passes the Vercel token explicitly and runs from
`apps/nox-os`, but does not map the internal Vercel team ID to the CLI `--scope` flag; that
flag expects a team slug and would fail closed with a provider user lookup error. This preserves
the existing cloud identity boundary without adding a second, manually maintained team name.

## Amendment B-004: Protected Staging configuration is not pulled by the Vercel CLI

The protected GitHub `staging` environment is the runtime configuration authority for the
Staging workflow. The deployer therefore does not execute `vercel pull --environment=staging`.
It uses the checked-in Vercel project configuration, explicit protected CI identity, and a
target-aware `vercel build --target=staging` to create the prebuilt output before deployment.

This prevents a Vercel CLI custom-environment settings lookup from becoming a second mutable
configuration authority or blocking an otherwise verified Staging deployment. Production is
unchanged and remains outside Gate 1 execution.

## Amendment B-005: Explicit Vercel CLI project selection

Every Vercel CLI invocation receives `--project` with the protected `VERCEL_PROJECT_ID`, in
addition to the existing CI identity environment. This follows the Vercel CLI project-selection
contract and removes any dependency on an ambient local link or repository-directory inference.
The target remains the reconciled `staging` environment; no Production command is executed.

## Amendment B-006: Vercel configured root is applied exactly once

The Vercel project already declares `apps/nox-os` as its root directory. CI invokes the CLI from
the repository root with explicit project selection and does not add a second `--cwd apps/nox-os`.
This avoids a doubled application path during Vercel's target-aware build.

## Amendment B-007: Ephemeral repository-root Vercel project link

The Staging build creates an ignored `.vercel/project.json` only when absent. Its `orgId` and
`projectId` must match protected CI identity; an existing conflicting link fails closed. This lets
the Vercel CLI resolve the configured monorepo root from the repository root without relying on
an ambient developer link, while leaving GitHub's protected Staging environment as the runtime
configuration authority. No secret is written to this link and no Production command is executed.

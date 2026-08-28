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

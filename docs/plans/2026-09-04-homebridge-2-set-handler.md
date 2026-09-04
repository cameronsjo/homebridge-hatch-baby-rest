---
status: awaiting-merge
issue: https://github.com/cameronsjo/homebridge-hatch-baby-rest/issues/2
---

# Modernize the shared Homebridge set handler

## Goal

Remove Hatch's final legacy Homebridge callback handler, propagate asynchronous setter failures correctly, and establish focused compatibility evidence for stable Homebridge 2.x without claiming the whole estate can migrate.

## Chosen approach

Land the change against Cameron's fork first, based on fresh `origin/main`; do not mix the fork's roughly 30-commit upstream divergence into this fix. Replace the shared `.on('set', callback)` registration with `.onSet()` returning the setter result, add focused tests around the shared helper, update both published packages' Homebridge engine declarations, and compile against stable Homebridge 2.x.

## Alternatives declined

- A minimal untested handler swap would leave the shared blast radius unprotected and metadata inconsistent.
- A full Homebridge boot harness is disproportionate to one helper and would mostly test mocks rather than Hatch behavior.
- Upstream-first delivery would defer the fork's fix and force unrelated reconciliation work into the critical path; a clean upstream cherry-pick can follow.

## Checklist

- [x] Replace the callback handler and remove obsolete callback types.
- [x] Test registration, value forwarding, promise completion and rejection, absent setters, and deduplicated observable updates.
- [x] Update both public package engine declarations for stable Homebridge 2.x.
- [x] Compile the shared package against a pinned stable Homebridge 2 release and refresh the lockfile.
- [x] Add the release-managed patch changeset for both packages.
- [x] Run build, tests, lint, search checks, and package inspection.
- [x] Keep production on Homebridge 1.x while SimpliSafe remains the estate-level blocker.
- [ ] Merge pull request #3; issue #2 closes automatically.

## Next step

Merge [pull request #3](https://github.com/cameronsjo/homebridge-hatch-baby-rest/pull/3), optionally deploy the Hatch tarball to the existing Homebridge 1.x host for an on/off and volume smoke test, and do not upgrade the estate to Homebridge 2.x while SimpliSafe remains blocked.

# Locale Unification Design

Date: 2026-04-01

## Context

The project currently keeps locale data in two source directories:

- `locales/<lang>/common.json` is imported directly by `src/ui/i18n/i18n.js`.
- `public/locales/<lang>/translation.json` is fetched as the local fallback by `src/ui/i18n/translationBundle.js`.

This split makes locale maintenance harder and leaves `public/locales/<lang>/common.json` as effectively duplicated data with no clear runtime owner.

## Decision

Keep `locales/` as the single source of truth for all local translation assets:

- `locales/en/common.json`
- `locales/en/translation.json`
- `locales/zh/common.json`
- `locales/zh/translation.json`

Remove `public/locales/` from the source tree.

## Runtime Design

`src/ui/i18n/i18n.js` will continue importing local `common.json` bundles from `locales/`.

`src/ui/i18n/translationBundle.js` will keep the existing priority order:

1. Try to load the official translation bundle from Milky Way Idle.
2. If that fails, fall back to the local `translation.json` bundles.

The fallback implementation will change from HTTP fetches against `/locales/.../translation.json` to direct module imports from `locales/`. This removes the need for `public/locales/` while preserving the user-visible behavior.

## Test Design

Update locale tests so they read all local translation assets from `locales/`.

Keep a regression test for the fallback path in `translationBundle.test.js`, but assert that the returned local bundle is used when official loading fails instead of asserting fetches to `public/locales`.

## Build Verification

Update `scripts/verify-pages-build.js` so it no longer requires `dist/locales/...` files. After this change, locale assets are part of the application bundle rather than copied as standalone static files.

## Risks And Mitigations

- Risk: bundling local `translation.json` increases the main JS payload.
  Mitigation: accept the trade-off for simpler source management in this refactor; no runtime behavior change is introduced beyond asset loading strategy.

- Risk: tests may still assume `public/locales` exists.
  Mitigation: update all path-based tests and run the relevant test suite plus a production build.

## Implementation Outline

1. Move `translation.json` from `public/locales` to `locales`.
2. Refactor local translation fallback to use imports from `locales`.
3. Remove `public/locales`.
4. Update tests and build verification script.
5. Run tests and build verification.

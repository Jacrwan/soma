# Canvas and subscription regression fixes

## Changes

- Canvas connection in Settings, onboarding, and the Canvas page now awaits course persistence. Re-sync matches existing course IDs or normalized names and preserves renamed courses, archived courses, colors, and manual courses. A save failure is shown instead of reporting successful connection.
- Day View no longer deletes archived courses or courses excluded by a name heuristic when it mounts.
- Trial dismissal persists for the user in the current browser-tab session. Auth refresh and navigation do not reopen it.
- Subscription reads share one authenticated store, refresh on auth changes, ignore stale responses from another account, and expose lookup failures with Retry. A failed refresh preserves the last known status for that account.
- The subscription API distinguishes a database failure (503) from a successful lookup with no subscription (free).
- AppShell calls all hooks before conditional login/paywall returns.

## Verification

- Seven browser regressions failed before the fixes and passed afterward.
- `npm test`: 14 passing cases, including onboarding, repeat sync, paid-account refresh, and subscription API errors.
- `npm run build`: passes; Vite reports the existing large-bundle warning.
- Separate TypeScript check of tests and Playwright config: passes.
- Targeted React hook-order lint: no errors.
- `npm run lint` remains unavailable: the repository has no ESLint configuration.

Tests use mocked Canvas, authentication, database, and subscription responses. They do not access customer accounts, create charges, or change the production database. Install dependencies with `npm ci`, install Chromium with `npx playwright install chromium`, then run `npm test`.

These are source changes only. Production deployment and verification against a real Canvas feed and paid account are still required. Courses previously deleted by the old Day View behavior are not automatically restored; re-sync can recreate courses present in the feed, but cannot recover their previous metadata or links.

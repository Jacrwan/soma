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

## Insights loading and tab-switch latency

- Loading now lasts until the data resolves. An empty message requires a successful query confirming there are no study sessions; errors offer Retry.
- One paginated session read supplies all eight charts, replacing their separate session reads and repeated auth calls. Subjects and todos load in parallel for correct names and estimates even on a direct visit.
- An in-memory cache is scoped by account. Repeat visits within 30 seconds reuse the result without a fetch. Older data remains visible during background refresh; local-day changes also expire the cache.
- Successful timer saves/deletions invalidate cached Insights, including while the page is unmounted. Existing subject/todo change events also invalidate it.
- Week and month navigation calculate from the loaded history, without another request. Pagination preserves records beyond the database's 1000-row response cap.
- Eleven new browser regressions cover loading, cache reuse and expiration, failed loads and refreshes, save invalidation, account isolation, pagination, empty accounts, and all chart calculations. Tests use mocked responses, so they prove removal of redundant requests and blocking UI behavior rather than a production millisecond latency target.

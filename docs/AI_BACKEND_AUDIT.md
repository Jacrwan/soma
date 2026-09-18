# AI backend audit — September 17, 2026

Scope: authenticated `/api/chat`, the AI page, dashboard Ask Soma, action persistence, current plan context, and document context. Changes are local and have not been deployed as part of this audit.

## Fixed

- Accepting generated todos used the replacement-list API, which could delete unrelated tasks. Suggestions now append through checked individual writes, deduplicate retries, and preserve existing tasks.
- Action execution could announce success before database writes completed. Writes now run sequentially, propagate failures, stop later actions on failure, and compensate newly created task/session records when scheduling fails. Partial failures are explicitly reported.
- AI mutations validate action shape, owned records, subject IDs, time intervals, and current scheduling constraints. Arbitrary artifact wrappers no longer trigger actions. Voice responses do not execute action tags.
- Both chat surfaces obtain fresh plan data and use shared schedule validation. Canvas context includes assignment/course IDs. Task reads paginate instead of silently stopping at the database's default 1,000-row limit.
- Dashboard conversation memory and document context caches are isolated across accounts. Replies are rejected if the account changes while a request is pending. Chat history writes are awaited, ordered per conversation, and show persistence errors.
- Authentication, missing subscriptions, and subscription lookup outages now produce distinct responses. Invalid trial dates no longer grant indefinite access.
- Provider and browser requests have timeouts. Non-JSON provider errors, overload, rate limiting, missing configuration, empty responses, and truncated output produce understandable failures. Truncated action responses cannot execute.
- Request validation limits roles, message counts, text lengths, and attachment types. Multi-block text responses are preserved. Long assistant replies remain valid in follow-up requests.
- Document context accurately describes excerpts and truncation instead of claiming the entire source was read.

## Verification

- Production frontend build and API TypeScript check.
- Full Playwright regression suite: **141 passed**, including new backend/action tests and browser checks for append-only task acceptance, failed saves, fresh context, and account switching.
- Whitespace/error check with `git diff --check`.

External services are mocked in these tests. They do not verify live Anthropic availability, deployed environment variables, or production database policies. No production records were modified.

## Remaining boundaries and follow-ups

- The burst limiter is per server instance; enforcing a global quota requires shared storage or gateway limits.
- Multi-record actions use compensating writes rather than a database transaction. A network failure during compensation is reported; transactional database functions would provide stronger atomicity.
- Legacy Canvas/Google local caches and local-to-cloud migrations remain broader account-lifecycle concerns. This audit's account-isolation fixes cover chat memory, pending replies, and document context; they are not a claim that every legacy browser cache is account-scoped.
- The document extraction endpoint checks document ownership, but its status writes still need checked persistence and dedicated failure-path tests. That endpoint was inspected but not changed in this pass.
- Automated coverage reduces known failure paths; it cannot guarantee that provider outages, future schema changes, or all future model outputs will never produce errors.

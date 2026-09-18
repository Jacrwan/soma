# Soma persistent memory backend

## Behavior

Both the AI page and dashboard Ask Soma can save explicitly supplied facts across chats and browser sessions. This is separate from conversation history, tasks, calendars, document excerpts, and timer data. Existing chats are not automatically mined for memories. The model cannot write memory through generated actions.

Supported chat commands:

- `/remember study-time: I prefer studying in the morning` — save a fact. Reusing `study-time` updates it.
- `/memories` — list saved keys and excerpts (up to 160 characters per fact).
- `/forget study-time` — remove that fact.
- `/memory off` — pause retrieval and prevent new memories; existing facts remain stored.
- `/memory on` — resume memory.
- `/memory clear` — erase all saved facts, preserving the enabled/disabled setting.

These commands call the authenticated memory API directly and return confirmations only after persistence succeeds. No model request is used. Forgetting memories does not erase chat history: information already present in the current conversation may still be visible to the model. Start a new conversation to stop supplying that history. Account deletion cascades to the memory record.

## Storage and authorization

`ai_memory_migration.sql` creates `public.soma_ai_memory`, separate from any legacy `ai_memory` table. Each account has one row containing an enabled flag, revision, and bounded array of structured facts. The table has a foreign key to `auth.users` with `ON DELETE CASCADE`. RLS permits authenticated users to read only their own row. Browser roles have no write grants. Server writes use a verified bearer-token user ID and explicit ownership filters.

Updates compare the previous revision and retry bounded conflicts. Concurrent saves to distinct keys do not silently overwrite each other. The same key has last-successful-write semantics. Clear retains the row and increments its revision, avoiding a delete/recreate revision race. Retrying a save cannot create duplicate keys. Limits: 100 facts, 600 characters each, keys up to 80 lowercase letters/digits/hyphens/underscores.

## API

`GET /api/memory` returns `{revision, enabled, entries}`. `POST /api/memory` accepts one of:

```json
{"action":"remember","key":"study-time","content":"I prefer mornings","category":"preference","expiresAt":null}
```

```json
{"action":"forget","key":"study-time"}
```

```json
{"action":"clear"}
```

```json
{"action":"set_enabled","enabled":false}
```

Category is `preference`, `goal`, or `fact` (default). Optional `expiresAt` must be a future parseable date. Expired entries are excluded from retrieval/listing immediately and removed on the next mutation. Unknown fields, including caller-supplied ownership, are rejected. Errors are sanitized and responses are `no-store`. Management does not require an active subscription; normal model requests retain the existing entitlement checks.

`src/lib/aiMemory.ts` exports typed request helpers for a future settings UI. The command parser accepts only complete explicit commands from the latest user turn. Displayed memory text cannot emit executable AI action tags.

## Retrieval

`api/chat.ts` retrieves memory server-side for the authenticated account before calling the existing model. It supplies at most 12 unexpired facts, ranked by term overlap with the current question and then recency. No embeddings, additional model extraction calls, or new third-party services are introduced. Saved text is framed as untrusted reference data. Current instructions and live app data take precedence; saved facts cannot establish task completion or authorize actions.

If the feature is off or storage is unavailable, ordinary chat continues with an explicit instruction not to claim persistent recall. Memory writes fail visibly instead of claiming success. The burst limiter is per instance, matching the existing infrastructure; it is not a global quota.

## Activation

The project owner approved migration and activation on 2026-09-18. The migration is **not yet applied**: browser access to supabase.com was rejected by a saved permission setting. Release preparation can proceed with memory disabled.

1. Review and approve `ai_memory_migration.sql` for the intended Supabase project.
2. Apply it once through the normal migration workflow. It contains no changes to existing tables.
3. Deploy the code through a preview branch, with server-only `SOMA_MEMORY_ENABLED=true`. The existing `VITE_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are required. Never expose the service key through a Vite variable.
4. Verify save, reload, new chat recall, update, forget, pause, clear, and separate-account access using test accounts.
5. Promote only after the preview works. To roll back availability, disable `SOMA_MEMORY_ENABLED`; retained data is not destroyed.

Project rule: `docs/CLAUDE.md` requires explicit approval before applying database schema changes.

## Validation

Baseline: 147 existing tests and production build passed. New tests cover ownership, forged IDs, duplicate updates, concurrent saves, clear/forget, pause, expiry, capacity, validation, bounded retrieval, database failures, conflict exhaustion, feature gating, authenticated chat injection, action-tag escaping, and both chat surfaces across reloads.

Database tests use a fake revision store, and browser tests mock the API. The actual SQL migration, deployed RLS permissions, and live model recall must be checked after migration approval; local tests are not evidence that those live checks have occurred.

Final local results: production build, API TypeScript check, and `git diff --check` passed. All 16 new memory tests passed. The final full serial run passed 160/163 tests; the three existing date/Canvas/timer tests timed out, then all three passed unchanged in an isolated rerun. Earlier runs also had intermittent browser/server failures. No assertion or timeout in the existing tests was relaxed. This is not a claim of one uninterrupted green full-suite run.

Release verification on 2026-09-18: a fresh full run passed **163/163 tests** in one uninterrupted run, and the production build passed. Supabase migration remains blocked by the saved browser permission; memory has not been enabled.

## Automatic learning (added 2026-09-18)

Soma now saves lasting facts without the user typing a command.

- **When:** after each chat reply is sent, via `waitUntil` from
  `@vercel/functions`, so learning never adds latency or breaks a reply.
- **Input:** only the student's newest message, plus the last 600 characters of
  the previous assistant reply to interpret short answers ("until 7"). The system
  prompt — documents, Canvas data, the plan — is never passed in, so uploaded
  content cannot plant a memory.
- **What it keeps:** lasting preferences, routines, goals and standing
  constraints. Not one-off tasks, not facts the student did not state, not
  passwords, contact details or sensitive personal information.
- **Safety net:** model output is parsed strictly; every suggestion goes through
  the same `parseMemoryAction` validation as a manual save; at most five
  saves and five forgets per message; forgets only apply to keys that exist.
  Unreadable output writes nothing. Paused memory skips the model call entirely.
- **Visibility:** Settings → Memory lists every entry, marked "Learned" or
  "Saved by you", with Forget, Forget everything (confirmed), and an on/off
  switch.
- **Cost:** one small Haiku call per substantive message (four words or more);
  existing memories are passed truncated to 160 characters each.

-- One-off: give renamed tasks back their recorded study time.
--
-- Run this in your Supabase SQL editor:
-- Dashboard → SQL Editor → New query → paste → Run
-- Run PART 1 on its own first (select it, then Run) and read what it would
-- change. Then run PART 2.
--
-- Focus time (timer_sessions) is found by task title. Until 2026-10-01 a
-- rename, in the block editor or by accepting Soma's, left the time under the
-- old title. The dashboard still showed it, spread over that day's blocks for
-- the subject; Insights lost it from the task, and so did Soma's estimates.
-- New renames move it (savePlanBlock); this repairs the ones before that.
--
-- A session is repaired only when there is no doubt where it belongs: no task
-- has its title any more, and exactly one task in the same subject was on the
-- plan that day, the same block the dashboard already shows the time on.
-- Anything else is left alone and counted in PART 1's summary:
--   ambiguous: two or more tasks in that subject that day; the dashboard
--              splits the time between them, so no single owner is known.
--   no task that day: the block was moved to another day or deleted.
-- Only task_text changes. Minutes, dates and subjects stay exactly as they are,
-- so the day and subject totals in Insights don't move.

-- ── PART 1: preview (changes nothing) ──────────────────────────────────────

WITH orphans AS (
  SELECT ts.id, ts.user_id, ts.subject_id, ts.task_text, ts.date::date AS day, ts.duration_seconds
  FROM timer_sessions ts
  WHERE ts.task_text IS NOT NULL AND ts.subject_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM todos t
      WHERE t.user_id = ts.user_id AND t.subject_id::text = ts.subject_id::text AND t.text = ts.task_text
    )
),
-- The tasks on the plan that day: a scheduled block that day, or a task dated
-- that day with no time at all (how the dashboard builds its day).
peers AS (
  SELECT o.id AS session_id, t.id AS todo_id, t.text
  FROM orphans o
  JOIN todos t ON t.user_id = o.user_id AND t.subject_id::text = o.subject_id::text
  WHERE EXISTS (SELECT 1 FROM todo_sessions s WHERE s.todo_id = t.id AND s.date::date = o.day)
     OR (t.date::date = o.day AND NOT EXISTS (SELECT 1 FROM todo_sessions s WHERE s.todo_id = t.id))
),
counted AS (
  SELECT o.*, COUNT(DISTINCT p.todo_id) AS candidates, MIN(p.text) AS new_title
  FROM orphans o LEFT JOIN peers p ON p.session_id = o.id
  GROUP BY o.id, o.user_id, o.subject_id, o.task_text, o.day, o.duration_seconds
)
SELECT
  CASE WHEN candidates = 1 THEN 'will fix' WHEN candidates = 0 THEN 'no task that day' ELSE 'ambiguous' END AS outcome,
  COUNT(*) AS sessions,
  ROUND(SUM(duration_seconds) / 3600.0, 1) AS hours,
  COUNT(DISTINCT user_id) AS students
FROM counted
GROUP BY 1
ORDER BY 1;

-- The individual sessions PART 2 would retitle:
WITH orphans AS (
  SELECT ts.id, ts.user_id, ts.subject_id, ts.task_text, ts.date::date AS day, ts.duration_seconds
  FROM timer_sessions ts
  WHERE ts.task_text IS NOT NULL AND ts.subject_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM todos t
      WHERE t.user_id = ts.user_id AND t.subject_id::text = ts.subject_id::text AND t.text = ts.task_text
    )
),
peers AS (
  SELECT o.id AS session_id, t.id AS todo_id, t.text
  FROM orphans o
  JOIN todos t ON t.user_id = o.user_id AND t.subject_id::text = o.subject_id::text
  WHERE EXISTS (SELECT 1 FROM todo_sessions s WHERE s.todo_id = t.id AND s.date::date = o.day)
     OR (t.date::date = o.day AND NOT EXISTS (SELECT 1 FROM todo_sessions s WHERE s.todo_id = t.id))
)
SELECT o.day, o.task_text AS old_title, MIN(p.text) AS new_title, ROUND(o.duration_seconds / 60.0) AS minutes, o.user_id
FROM orphans o JOIN peers p ON p.session_id = o.id
GROUP BY o.id, o.day, o.task_text, o.duration_seconds, o.user_id
HAVING COUNT(DISTINCT p.todo_id) = 1
ORDER BY o.user_id, o.day, o.task_text;

-- ── PART 2: apply ──────────────────────────────────────────────────────────

BEGIN;

WITH orphans AS (
  SELECT ts.id, ts.user_id, ts.subject_id, ts.date::date AS day
  FROM timer_sessions ts
  WHERE ts.task_text IS NOT NULL AND ts.subject_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM todos t
      WHERE t.user_id = ts.user_id AND t.subject_id::text = ts.subject_id::text AND t.text = ts.task_text
    )
),
peers AS (
  SELECT o.id AS session_id, t.id AS todo_id, t.text
  FROM orphans o
  JOIN todos t ON t.user_id = o.user_id AND t.subject_id::text = o.subject_id::text
  WHERE EXISTS (SELECT 1 FROM todo_sessions s WHERE s.todo_id = t.id AND s.date::date = o.day)
     OR (t.date::date = o.day AND NOT EXISTS (SELECT 1 FROM todo_sessions s WHERE s.todo_id = t.id))
),
owners AS (
  SELECT session_id, MIN(text) AS new_title
  FROM peers
  GROUP BY session_id
  HAVING COUNT(DISTINCT todo_id) = 1
)
UPDATE timer_sessions ts
SET task_text = owners.new_title
FROM owners
WHERE ts.id = owners.session_id;

COMMIT;

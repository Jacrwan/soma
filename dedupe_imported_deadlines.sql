-- One-off: remove deadlines a course-site import added twice.
--
-- Run this in your Supabase SQL editor:
-- Dashboard → SQL Editor → New query → paste → Run
-- Run PART 1 on its own first (select it, then Run) and read what it would
-- delete. Then run PART 2.
--
-- Each read of a course site words a deadline a little differently, and an
-- import used to match only titles that differ in case or punctuation (and
-- before 2026-10-06, not even those). So Deadlines showed "Project 4: Animator
-- checkpoint", "Project 4: Animator - Checkpoint" and "Project 4: Animator
-- (TypeScript) checkpoint", all due Nov 13. New imports match these
-- (CourseSiteImport sameDeadline); this removes the ones already saved.
--
-- Two tasks are the same deadline when they are the same student's, in the
-- same course, due the same day, of the same kind (or one has none), and every
-- word of the shorter title is in the longer one (at least two words). The
-- fuller title is kept. A task is deleted only when nothing has been done
-- with it: not started, not linked to Canvas, no notes, never scheduled, no
-- reading sections, and no study time logged under its title. Pairs where
-- both have been used are left alone.

-- ── PART 1: preview (changes nothing) ──────────────────────────────────────

WITH t AS (
  SELECT td.id, td.user_id, td.subject_id, td.due_date, td.kind, td.text,
    regexp_split_to_array(trim(regexp_replace(lower(td.text), '[^a-z0-9]+', ' ', 'g')), ' ') AS words,
    (td.status = 'nothing' AND td.assignment_id IS NULL AND coalesce(td.notes, '') = ''
      AND NOT EXISTS (SELECT 1 FROM todo_sessions s WHERE s.todo_id::text = td.id::text)
      AND NOT EXISTS (SELECT 1 FROM course_items c WHERE c.todo_id::text = td.id::text)
      AND NOT EXISTS (SELECT 1 FROM timer_sessions ts WHERE ts.user_id::text = td.user_id::text AND ts.subject_id::text = td.subject_id::text AND ts.task_text = td.text)
    ) AS untouched
  FROM todos td
  WHERE td.due_date IS NOT NULL AND td.subject_id IS NOT NULL
    AND td.kind IN ('homework', 'lab', 'project', 'exam', 'quiz')
),
dupes AS (
  SELECT DISTINCT ON (a.id) a.id, a.user_id, a.due_date, a.text AS deleted, b.text AS kept
  FROM t a JOIN t b
    ON a.user_id = b.user_id AND a.subject_id = b.subject_id AND a.due_date = b.due_date
   AND a.id <> b.id AND (a.kind IS NULL OR b.kind IS NULL OR a.kind = b.kind)
  WHERE a.untouched
    AND ((a.words <@ b.words AND cardinality(a.words) >= 2) OR (b.words <@ a.words AND cardinality(b.words) >= 2))
    AND (
      NOT b.untouched                                                -- the other one has been used
      OR (a.words <@ b.words AND NOT b.words <@ a.words)              -- the other's title is fuller
      OR (a.words <@ b.words AND b.words <@ a.words AND a.id > b.id)  -- same words: keep one
    )
  -- Name the one that stays: a used one, else the fullest title.
  ORDER BY a.id, b.untouched, cardinality(b.words) DESC, b.id
)
SELECT user_id, due_date, deleted, kept FROM dupes ORDER BY user_id, due_date, kept;

-- ── PART 2: delete them ────────────────────────────────────────────────────

WITH t AS (
  SELECT td.id, td.user_id, td.subject_id, td.due_date, td.kind, td.text,
    regexp_split_to_array(trim(regexp_replace(lower(td.text), '[^a-z0-9]+', ' ', 'g')), ' ') AS words,
    (td.status = 'nothing' AND td.assignment_id IS NULL AND coalesce(td.notes, '') = ''
      AND NOT EXISTS (SELECT 1 FROM todo_sessions s WHERE s.todo_id::text = td.id::text)
      AND NOT EXISTS (SELECT 1 FROM course_items c WHERE c.todo_id::text = td.id::text)
      AND NOT EXISTS (SELECT 1 FROM timer_sessions ts WHERE ts.user_id::text = td.user_id::text AND ts.subject_id::text = td.subject_id::text AND ts.task_text = td.text)
    ) AS untouched
  FROM todos td
  WHERE td.due_date IS NOT NULL AND td.subject_id IS NOT NULL
    AND td.kind IN ('homework', 'lab', 'project', 'exam', 'quiz')
),
dupes AS (
  SELECT DISTINCT a.id
  FROM t a JOIN t b
    ON a.user_id = b.user_id AND a.subject_id = b.subject_id AND a.due_date = b.due_date
   AND a.id <> b.id AND (a.kind IS NULL OR b.kind IS NULL OR a.kind = b.kind)
  WHERE a.untouched
    AND ((a.words <@ b.words AND cardinality(a.words) >= 2) OR (b.words <@ a.words AND cardinality(b.words) >= 2))
    AND (
      NOT b.untouched
      OR (a.words <@ b.words AND NOT b.words <@ a.words)
      OR (a.words <@ b.words AND b.words <@ a.words AND a.id > b.id)
    )
)
DELETE FROM todos WHERE id IN (SELECT id FROM dupes);

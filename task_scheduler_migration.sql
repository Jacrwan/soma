-- Task scheduler (2026-11-15): tasks with a due date place and re-place their
-- own sittings, with no AI. See src/lib/taskScheduler.ts.
--
-- Run in the Supabase SQL editor once:
-- Dashboard → SQL Editor → New query → paste → Run
--
-- Until this runs, the app still loads and saves tasks as before. Dragging a
-- task's priority, "Schedule it", checking off one sitting and pinning a sitting
-- fail with a "run the migration" message, because those write these columns.

-- A task's place in the priority list (lower = more important). NULL means
-- Soma's guess (due date, nudged by the kind of work) until the student drags it.
ALTER TABLE todos ADD COLUMN IF NOT EXISTS rank DOUBLE PRECISION;

-- TRUE: Soma schedules this task's sittings. FALSE: the student turned it off.
-- NULL: the default (imported work with a due date is scheduled when the
-- "Schedule imported assignments" setting is on).
ALTER TABLE todos ADD COLUMN IF NOT EXISTS auto_schedule BOOLEAN;

-- One sitting of a scheduled task checked off, without finishing the task.
ALTER TABLE todo_sessions ADD COLUMN IF NOT EXISTS done_at TIMESTAMPTZ;

-- A sitting the student placed or pinned: the scheduler never moves it.
ALTER TABLE todo_sessions ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;

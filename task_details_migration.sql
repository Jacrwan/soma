-- Task details (2026-11-15): open a task to set your own deadline, the days
-- you'll work on it, how many sittings, or named steps that replace generic
-- sittings. See src/components/Tasks/TaskDetail.tsx and src/lib/taskScheduler.ts.
--
-- Run in the Supabase SQL editor once:
-- Dashboard → SQL Editor → New query → paste → Run
--
-- Needs task_scheduler_migration.sql first. Until this runs, everything else
-- works; saving a task's details shows a "run the migration" message.

-- Your own deadline when it differs from the posted one ("due Wed" that you
-- treat as due Tue). Same form as due_date. NULL: the posted due date.
ALTER TABLE todos ADD COLUMN IF NOT EXISTS my_due TEXT;

-- The days you'll work on it: no sittings before work_from or after
-- work_until. NULL: Soma picks (a start window before the finish day).
ALTER TABLE todos ADD COLUMN IF NOT EXISTS work_from DATE;
ALTER TABLE todos ADD COLUMN IF NOT EXISTS work_until DATE;

-- How many sittings the work is split into. NULL: Soma picks from the length.
ALTER TABLE todos ADD COLUMN IF NOT EXISTS sitting_count INTEGER;

-- Named steps, in order: [{ "id", "title", "minutes", "done" }]. When set,
-- each open step gets one sitting of its own, in order, instead of generic ones.
ALTER TABLE todos ADD COLUMN IF NOT EXISTS steps JSONB;

-- Which step a sitting is for (a step's id from todos.steps).
ALTER TABLE todo_sessions ADD COLUMN IF NOT EXISTS step_id TEXT;

-- Exam prep v1: priority on each study-list item (1 = low … 5 = high).
-- The exam_plans table and course_items.exam_id / study_day / minutes already
-- exist from exam_study_migration.sql (ran 2026-11-06). This only adds priority.
-- Deadline anchors (never after exam / due) use those existing columns + todos
-- — no extra schema.
--
-- Run in the Supabase SQL editor once:
-- Dashboard → SQL Editor → New query → paste → Run
--
-- Until this runs, saving an exam study list still works; priority stays at the
-- app default (3) and is not persisted.

ALTER TABLE course_items
  ADD COLUMN IF NOT EXISTS priority INTEGER
  CHECK (priority IS NULL OR (priority >= 1 AND priority <= 5));

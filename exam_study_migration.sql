-- NO LONGER USED. Exam study plans were taken out on 2026-11-06, the day
-- this was run on production. Do not run it again. What it left behind is
-- unused: the exam_plans table, and the exam_id / study_day / minutes columns
-- on course_items. The app skips course_items rows that have an exam_id.
--
-- Run this in your Supabase SQL editor:
-- Dashboard → SQL Editor → New query → paste → Run
--
-- Exam study plans. One row in exam_plans per exam the student is studying
-- for (a midterm, a final, a quiz). Its study list lives in course_items, the
-- table reading lists already use, so checking off a block marks the list's
-- items done exactly the way it marks reading done:
--   exam_id    the exam the item is for (NULL for reading-list sections)
--   study_day  the day the plan puts it on (YYYY-MM-DD)
--   minutes    how long it should take
-- label is the material by name ("Worksheet 3", "Practice midterm A"), title
-- the detail ("problems 1–12, related rates"), document_id the upload it
-- comes from.
--
-- New table plus three nullable columns; no existing row is changed, and
-- reading lists work as before. The course_items CREATE is here only in case
-- course_items_migration.sql was never run; it does nothing when it was.
-- Until this runs, saving an exam study list says it needs this update and
-- everything else works as before.

CREATE TABLE IF NOT EXISTS course_items (
  id           UUID        PRIMARY KEY,
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_id   UUID        NOT NULL,
  label        TEXT        NOT NULL,
  title        TEXT,
  due_date     DATE,
  position     INTEGER     NOT NULL,
  done_at      TIMESTAMPTZ,
  todo_id      UUID,
  document_id  UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS course_items_user_idx
  ON course_items (user_id, subject_id, position);

ALTER TABLE course_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own course items" ON course_items;
CREATE POLICY "Users can manage own course items"
  ON course_items FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS exam_plans (
  id          UUID        PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_id  UUID        NOT NULL,
  title       TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  exam_date   DATE        NOT NULL,
  todo_id     UUID,                       -- the exam's own task, when it has one
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS exam_plans_user_idx
  ON exam_plans (user_id, exam_date);

ALTER TABLE exam_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own exam plans" ON exam_plans;
CREATE POLICY "Users can manage own exam plans"
  ON exam_plans FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

ALTER TABLE course_items
  ADD COLUMN IF NOT EXISTS exam_id   UUID REFERENCES exam_plans(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS study_day DATE,
  ADD COLUMN IF NOT EXISTS minutes   INTEGER CHECK (minutes IS NULL OR minutes BETWEEN 5 AND 600);

CREATE INDEX IF NOT EXISTS course_items_exam_idx
  ON course_items (user_id, exam_id) WHERE exam_id IS NOT NULL;

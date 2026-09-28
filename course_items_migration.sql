-- Run this in your Supabase SQL editor:
-- Dashboard → SQL Editor → New query → paste → Run
--
-- A course's work, one row per section, in the order it is assigned — e.g.
-- Physics 5A §4.1, §4.2, … — built once from a reading guide or syllabus and
-- reviewed by the student. It is the only record of what is actually done:
-- `done_at` is set when the student checks off a block that covers the item
-- (or says how far they got), never because a due date has passed. `todo_id`
-- is the task currently planned to cover it; the AI reads "done through …",
-- "next …" and "behind" from this table instead of guessing from the syllabus.
--
-- New table only; no existing row is touched. Until this runs the app shows
-- no reading lists and everything else works as before.

CREATE TABLE IF NOT EXISTS course_items (
  id           UUID        PRIMARY KEY,
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_id   UUID        NOT NULL,
  label        TEXT        NOT NULL,          -- "4.1"
  title        TEXT,                          -- "Momentum"
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

CREATE POLICY "Users can manage own course items"
  ON course_items FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

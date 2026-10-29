-- Run this in your Supabase SQL editor:
-- Dashboard → SQL Editor → New query → paste → Run
--
-- A course's grade book on the Grades page, one row per course:
--   categories  how the course is graded, read from its syllabus by the AI and
--               checked by the student: [{id, name, weight, covers, drop, match}]
--   scale       the letter cutoffs the syllabus gives, [{letter, min}], or null
--   entries     scores the student typed in themselves (Gradescope and other
--               sites Soma can't read): [{id, name, score, max, categoryId, date}]
--   picks       the category the student chose for a synced score, by its key
--               ("canvas:123") → category id
--   starred     shown on the Grades page when any course is starred
-- course_key is the Soma course ("subject:<id>"), or the synced course when it
-- has none ("school.instructure.com:456").
--
-- New table only; no existing row is touched. Until this runs the Grades page
-- shows synced grades as before, and saving a grade book says it needs this.

CREATE TABLE IF NOT EXISTS grade_books (
  id          UUID        PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_key  TEXT        NOT NULL,
  categories  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  scale       JSONB,
  entries     JSONB       NOT NULL DEFAULT '[]'::jsonb,
  picks       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  starred     BOOLEAN     NOT NULL DEFAULT FALSE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, course_key)
);

ALTER TABLE grade_books ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own grade books"
  ON grade_books FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Approved by the project owner on 2026-09-22; apply once to the intended Supabase project.
-- Run this in your Supabase SQL editor:
-- Dashboard → SQL Editor → New query → paste → Run
--
-- Records what a task IS, so the Deadlines page can show work that has to be
-- handed in and leave study tasks out of it. The course-site import already
-- classifies every item it finds (homework, lab, project, exam, quiz,
-- reading, discussion, other) and shows that label while you choose what to
-- import — it just had nowhere to store it.
--
-- Adds one nullable column and modifies no existing row. Tasks saved before
-- this ran stay NULL, meaning "unclassified": the Deadlines page lists those
-- separately rather than guessing, and re-importing a course site fills them
-- in.

ALTER TABLE todos
  ADD COLUMN IF NOT EXISTS kind TEXT;

COMMENT ON COLUMN todos.kind IS
  'What the task is: homework, lab, project, exam, quiz, reading, discussion, other. NULL means it predates the column or was written by hand.';

-- Run this in your Supabase SQL editor:
-- Dashboard → SQL Editor → New query → paste → Run
--
-- The dashboard's brain dump, one row per line the student typed, so the list
-- is the same on every device. A line leaves the table when it's put on the
-- plan (+) or removed (×). id is made in the browser, so a line added while
-- offline keeps its id when it's saved.
--
-- New table only; no existing row is touched. Until this runs the brain dump
-- keeps its list in each browser, as it does today.

CREATE TABLE IF NOT EXISTS brain_dump_items (
  id          UUID        PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text        TEXT        NOT NULL CHECK (char_length(text) BETWEEN 1 AND 200),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS brain_dump_items_user_id_idx
  ON brain_dump_items (user_id, created_at);

ALTER TABLE brain_dump_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own brain dump"
  ON brain_dump_items FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

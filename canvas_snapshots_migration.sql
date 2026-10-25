-- Run this in your Supabase SQL editor:
-- Dashboard → SQL Editor → New query → paste → Run
--
-- What the Soma for Canvas browser extension read from the student's own
-- Canvas session: courses (with current grades when the student allows it),
-- assignment groups and weights, assignments with their descriptions and
-- submission state, and recent announcements. One row per student per Canvas
-- site, replaced whole on every sync; `payload` is the extension's snapshot
-- after the app has validated it (src/lib/canvasDeepSync.ts).
--
-- No credential is ever stored: the extension reads Canvas inside the
-- student's browser and hands the parsed fields to the open Soma tab, which
-- saves them here under the student's own session.
--
-- New table only; no existing row is touched. Until this runs, synced data
-- stays in the browser that received it and everything else works as before.

CREATE TABLE IF NOT EXISTS canvas_snapshots (
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  host       TEXT        NOT NULL,          -- "school.instructure.com"
  payload    JSONB       NOT NULL,
  synced_at  TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, host)
);

ALTER TABLE canvas_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own canvas snapshots"
  ON canvas_snapshots FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

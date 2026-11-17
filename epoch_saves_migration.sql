-- Run this in your Supabase SQL editor:
-- Dashboard → SQL Editor → New query → paste → Run
--
-- Cloud saves for the Epoch study game (/game). One row per student: the whole
-- game state as JSON (typically under 300 KB; the game skips uploads over
-- 1.5 MB). The game writes it with the student's own session through the REST
-- API, at most every ~20 seconds and when the page is hidden. Until this runs,
-- progress stays in the browser's localStorage only, as before.
--
-- New table only; no existing row is touched. Account deletion removes the row
-- (api/_deleteUserData.ts), and it also cascades from auth.users.

CREATE TABLE IF NOT EXISTS epoch_saves (
  user_id    UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  data       JSONB       NOT NULL,
  version    INT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE epoch_saves ENABLE ROW LEVEL SECURITY;

-- Students read and write their own save only. No delete policy: the game
-- never deletes a save; account deletion uses the service role.
CREATE POLICY "Users can read own epoch save"
  ON epoch_saves FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own epoch save"
  ON epoch_saves FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own epoch save"
  ON epoch_saves FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

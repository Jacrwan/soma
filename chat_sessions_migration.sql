-- Run this in your Supabase SQL editor:
-- Dashboard → SQL Editor → New query → paste → Run

CREATE TABLE IF NOT EXISTS chat_sessions (
  id          TEXT        PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date        TEXT        NOT NULL,
  title       TEXT        NOT NULL DEFAULT '',
  messages    JSONB       NOT NULL DEFAULT '[]',
  subject_key TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_sessions_user_id_idx
  ON chat_sessions (user_id, updated_at DESC);

ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own chat sessions"
  ON chat_sessions FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

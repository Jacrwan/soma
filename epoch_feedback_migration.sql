-- Run this in your Supabase SQL editor:
-- Dashboard → SQL Editor → New query → paste → Run
--
-- Epoch beta feedback: the "Send feedback" button in the game's Settings.
--
-- Who can do what:
--   * anyone playing (signed in or a guest) can add a row; signed-in players
--     can only add rows as themselves, guests only without a user;
--   * nobody but the owner can read rows (is_soma_owner(), from
--     widget_requests_migration.sql: run that one first if you haven't);
--   * nobody can change or delete rows from the app.
--
-- New table only; no existing row is touched. Until this runs the game says
-- feedback couldn't be sent.

CREATE TABLE IF NOT EXISTS public.epoch_feedback (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  mood text CHECK (mood IS NULL OR mood IN ('love', 'ok', 'meh', 'bug')),
  context text CHECK (context IS NULL OR char_length(context) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.epoch_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "epoch_feedback insert" ON public.epoch_feedback;
CREATE POLICY "epoch_feedback insert" ON public.epoch_feedback
  FOR INSERT TO anon, authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

DROP POLICY IF EXISTS "epoch_feedback owner reads" ON public.epoch_feedback;
CREATE POLICY "epoch_feedback owner reads" ON public.epoch_feedback
  FOR SELECT TO authenticated
  USING (public.is_soma_owner());

GRANT INSERT ON public.epoch_feedback TO anon, authenticated;
GRANT SELECT ON public.epoch_feedback TO authenticated;

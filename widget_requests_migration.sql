-- Run this in your Supabase SQL editor:
-- Dashboard → SQL Editor → New query → paste → Run
--
-- Widget ideas: a student suggests a dashboard widget (Customize → Suggest a
-- widget) and the owner decides whether to build it. One row per idea.
--
-- Who can do what:
--   * a student adds ideas and sees only their own, with the decision and any
--     note; they can't change an idea once sent, or decide anything;
--   * the owner (the Soma account below, email confirmed) sees every idea and
--     sets its status and note. The app asks is_soma_owner() to know whether
--     to show the review list; the policies are what actually enforce it.
--
-- status: new (waiting for review) → planned (will be built) → built,
-- or declined (not planned).
--
-- New table and function only; no existing row is touched. Until this runs
-- the app says widget ideas aren't set up yet.
--
-- To change the owner, edit the email in is_soma_owner() and run that part again.

CREATE OR REPLACE FUNCTION public.is_soma_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid()
      AND lower(email) = 'jacrwan1k@gmail.com'
      AND email_confirmed_at IS NOT NULL
  );
$$;

REVOKE ALL ON FUNCTION public.is_soma_owner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_soma_owner() TO authenticated;

CREATE TABLE IF NOT EXISTS widget_requests (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  details     TEXT        NOT NULL DEFAULT '' CHECK (char_length(details) <= 1000),
  status      TEXT        NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'planned', 'built', 'declined')),
  owner_note  TEXT        CHECK (char_length(owner_note) <= 500),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS widget_requests_user_id_idx ON widget_requests (user_id, created_at);
CREATE INDEX IF NOT EXISTS widget_requests_status_idx  ON widget_requests (status, created_at);

ALTER TABLE widget_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students read own widget ideas"
  ON widget_requests FOR SELECT
  USING (auth.uid() = user_id OR public.is_soma_owner());

-- A new idea starts undecided, and a student can have at most ten waiting.
CREATE POLICY "Students send widget ideas"
  ON widget_requests FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'new'
    AND owner_note IS NULL
    AND decided_at IS NULL
    AND (SELECT count(*) FROM widget_requests w WHERE w.user_id = auth.uid() AND w.status = 'new') < 10
  );

CREATE POLICY "Owner decides widget ideas"
  ON widget_requests FOR UPDATE
  USING (public.is_soma_owner())
  WITH CHECK (public.is_soma_owner());

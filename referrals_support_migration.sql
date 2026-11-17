-- Run this in your Supabase SQL editor:
-- Dashboard → SQL Editor → New query → paste → Run
--
-- Two features, 2026-11-17:
--
-- 1. Invite friends (Settings → Invite friends). Each student has a link
--    (somastudy.app/?ref=<code>). A friend who signs up with it counts for
--    them. 5 friends within 2 months earn one free week, and at most one
--    free week every 2 months (10 friends at once is still one week).
--    The server (api/stripe.ts, service role) does every write; students
--    only read their own rows.
--
-- 2. Message the developer (the chat bubble, bottom right). A student writes,
--    the server saves it and pings the owner's Discord; the owner replies from
--    the same bubble, which shows every conversation to is_soma_owner().
--
-- New tables, two functions and one column on subscriptions; no existing row
-- is changed. Needs is_soma_owner() from widget_requests_migration.sql.
-- Until this runs, the invite card and the chat say they aren't set up yet.

-- ── Invite friends ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS referral_codes (
  user_id    UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  code       TEXT        NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9]{6,16}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per friend: a student can be referred once.
CREATE TABLE IF NOT EXISTS referrals (
  referred_user_id UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  referrer_user_id UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (referred_user_id <> referrer_user_id)
);
CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON referrals (referrer_user_id, created_at);

-- A free week earned. applied = given (how says which way); pending = the
-- student had nothing to extend, so their next checkout adds the week;
-- not_needed = they already have free access (an account set up by hand).
CREATE TABLE IF NOT EXISTS referral_rewards (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status     TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'not_needed')),
  how        TEXT,
  ends_at    TIMESTAMPTZ,
  applied_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS referral_rewards_user_idx ON referral_rewards (user_id, granted_at);

-- A paying student's free week moves their next charge 7 days later, which
-- Stripe runs as a trial. Until this date Soma still treats them as a
-- subscriber (status, AI budget, top-ups): api/_trial.ts paidFreeWeek.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS free_week_until TIMESTAMPTZ;

ALTER TABLE referral_codes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_rewards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read own referral code" ON referral_codes;
CREATE POLICY "Read own referral code" ON referral_codes FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Read own referrals" ON referrals;
CREATE POLICY "Read own referrals" ON referrals FOR SELECT USING (auth.uid() = referrer_user_id);
DROP POLICY IF EXISTS "Read own referral rewards" ON referral_rewards;
CREATE POLICY "Read own referral rewards" ON referral_rewards FOR SELECT USING (auth.uid() = user_id);

-- ── Message the developer ───────────────────────────────────────────────────

-- One conversation per student (thread_user_id). sender 'user' is the
-- student, 'owner' is you.
CREATE TABLE IF NOT EXISTS support_messages (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_user_id UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender         TEXT        NOT NULL CHECK (sender IN ('user', 'owner')),
  body           TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  page           TEXT        CHECK (char_length(page) <= 200),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS support_messages_thread_idx ON support_messages (thread_user_id, created_at);

ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read own support messages" ON support_messages;
CREATE POLICY "Read own support messages" ON support_messages FOR SELECT
  USING (auth.uid() = thread_user_id OR public.is_soma_owner());

-- Students send through the server, which also pings Discord; only the owner
-- writes replies directly.
DROP POLICY IF EXISTS "Owner replies" ON support_messages;
CREATE POLICY "Owner replies" ON support_messages FOR INSERT
  WITH CHECK (public.is_soma_owner() AND sender = 'owner' AND read_at IS NULL);

-- Marks the other side's messages in a conversation as read.
CREATE OR REPLACE FUNCTION public.mark_support_read(p_thread UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() = p_thread THEN
    UPDATE public.support_messages SET read_at = NOW()
      WHERE thread_user_id = p_thread AND sender = 'owner' AND read_at IS NULL;
  ELSIF public.is_soma_owner() THEN
    UPDATE public.support_messages SET read_at = NOW()
      WHERE thread_user_id = p_thread AND sender = 'user' AND read_at IS NULL;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_support_read(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_support_read(UUID) TO authenticated;

-- The owner's inbox: one row per conversation, newest first, with the
-- student's email. Empty for anyone else.
CREATE OR REPLACE FUNCTION public.support_threads()
RETURNS TABLE (thread_user_id UUID, email TEXT, last_body TEXT, last_sender TEXT, last_at TIMESTAMPTZ, unread INT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT t.thread_user_id, u.email::text, l.body, l.sender, l.created_at,
         (SELECT count(*)::int FROM public.support_messages m
            WHERE m.thread_user_id = t.thread_user_id AND m.sender = 'user' AND m.read_at IS NULL)
  FROM (SELECT DISTINCT s.thread_user_id FROM public.support_messages s) t
  JOIN LATERAL (
    SELECT s.body, s.sender, s.created_at FROM public.support_messages s
    WHERE s.thread_user_id = t.thread_user_id ORDER BY s.created_at DESC LIMIT 1
  ) l ON true
  LEFT JOIN auth.users u ON u.id = t.thread_user_id
  WHERE public.is_soma_owner()
  ORDER BY l.created_at DESC
  LIMIT 200;
$$;
REVOKE ALL ON FUNCTION public.support_threads() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_threads() TO authenticated;

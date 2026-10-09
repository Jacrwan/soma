-- Notes on past conversations (added 2026-10-08): one short, dated note per
-- chat of what was discussed, decided and planned, so Soma can recall it in a
-- later chat when it matches what the student asks. Written by the server;
-- students can read their own, and edit or delete them through /api/memory.
-- Run once on Supabase. Until then, notes are simply not written or recalled.
BEGIN;
CREATE TABLE public.soma_conversation_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id text NOT NULL CHECK (char_length(conversation_id) BETWEEN 1 AND 80),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  note text NOT NULL CHECK (char_length(note) BETWEEN 1 AND 1500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  search tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, title || ' ' || note)) STORED,
  UNIQUE (user_id, conversation_id)
);
CREATE INDEX soma_conversation_notes_search ON public.soma_conversation_notes USING gin (search);
CREATE INDEX soma_conversation_notes_user_time ON public.soma_conversation_notes (user_id, updated_at DESC);
ALTER TABLE public.soma_conversation_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.soma_conversation_notes FROM anon, authenticated;
GRANT SELECT ON public.soma_conversation_notes TO authenticated;
GRANT ALL ON public.soma_conversation_notes TO service_role;
CREATE POLICY "Read own conversation notes" ON public.soma_conversation_notes FOR SELECT TO authenticated USING (auth.uid() = user_id);
COMMENT ON TABLE public.soma_conversation_notes IS 'One note per Soma conversation. Account deletion cascades; /memory clear deletes them.';
COMMIT;

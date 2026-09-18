-- Approved by the project owner on 2026-09-18; apply once to the intended Supabase project.
-- Independent of the legacy ai_memory table; no existing data is modified.
BEGIN;
CREATE TABLE public.soma_ai_memory (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  enabled boolean NOT NULL DEFAULT true,
  entries jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(entries) = 'array' AND jsonb_array_length(entries) <= 100 AND octet_length(entries::text) <= 400000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.soma_ai_memory ENABLE ROW LEVEL SECURITY;
-- Clients may inspect their data; writes go through the validated server API.
REVOKE ALL ON public.soma_ai_memory FROM anon, authenticated;
GRANT SELECT ON public.soma_ai_memory TO authenticated;
GRANT ALL ON public.soma_ai_memory TO service_role;
CREATE POLICY "Read own Soma memory" ON public.soma_ai_memory FOR SELECT TO authenticated USING (auth.uid() = user_id);
COMMENT ON TABLE public.soma_ai_memory IS 'Explicitly saved user memory. Revision enables optimistic concurrency; account deletion cascades.';
COMMIT;

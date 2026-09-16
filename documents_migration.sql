-- Run this in your Supabase SQL editor:
-- Dashboard → SQL Editor → New query → paste → Run
--
-- Adds per-subject document storage (syllabus, readings, guides) that the
-- Documents page reads and writes, replacing the Google Drive / Study Folder
-- integration.

CREATE TABLE IF NOT EXISTS documents (
  id            UUID        PRIMARY KEY,
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_id    UUID        REFERENCES subjects(id) ON DELETE CASCADE,
  file_name     TEXT        NOT NULL,
  storage_path  TEXT        NOT NULL,
  file_type     TEXT        NOT NULL,
  size_bytes    BIGINT      NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS documents_user_id_idx
  ON documents (user_id, subject_id, created_at DESC);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own documents"
  ON documents FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Storage bucket: private, one folder per user (path is "{user_id}/{doc_id}-{file_name}")
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can manage own document files"
  ON storage.objects FOR ALL
  USING  (bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1]);

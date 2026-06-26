-- Links externos (Google Drive) sem usar Supabase Storage

ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'storage',
  ADD COLUMN IF NOT EXISTS external_url TEXT;

ALTER TABLE public.files ALTER COLUMN storage_path DROP NOT NULL;

ALTER TABLE public.files DROP CONSTRAINT IF EXISTS files_storage_or_external_check;
ALTER TABLE public.files ADD CONSTRAINT files_storage_or_external_check CHECK (
  (source = 'storage' AND storage_path IS NOT NULL AND storage_path <> '')
  OR (source = 'drive' AND external_url IS NOT NULL AND external_url <> '')
);

CREATE INDEX IF NOT EXISTS idx_files_source ON public.files(source);

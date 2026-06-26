-- Pastas de arquivos por cliente (ordenáveis, excluíveis)

CREATE TABLE public.file_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  label TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '📁',
  bucket_hint TEXT NOT NULL DEFAULT 'files',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(client_id, slug)
);

CREATE INDEX idx_file_folders_client ON public.file_folders(client_id, sort_order);

ALTER TABLE public.file_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "file_folders_select" ON public.file_folders FOR SELECT TO authenticated
  USING (
    public.is_staff()
    OR (client_id IS NOT NULL AND public.can_access_client(client_id))
  );

CREATE POLICY "file_folders_insert" ON public.file_folders FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());

CREATE POLICY "file_folders_update" ON public.file_folders FOR UPDATE TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

CREATE POLICY "file_folders_delete" ON public.file_folders FOR DELETE TO authenticated
  USING (public.is_admin_or_gestor() OR public.is_staff());

-- Pastas padrão para clientes existentes
INSERT INTO public.file_folders (client_id, slug, label, icon, bucket_hint, sort_order)
SELECT c.id, d.slug, d.label, d.icon, d.bucket_hint, d.sort_order
FROM public.clients c
CROSS JOIN (VALUES
  ('4k', '4K / Câmera', '🎥', 'videos', 0),
  ('videos', 'Vídeos', '🎬', 'videos', 1),
  ('imagens', 'Imagens', '🖼️', 'images', 2),
  ('documentos', 'Documentos', '📄', 'files', 3)
) AS d(slug, label, icon, bucket_hint, sort_order)
ON CONFLICT (client_id, slug) DO NOTHING;

CREATE OR REPLACE FUNCTION public.seed_file_folders_for_client()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.file_folders (client_id, slug, label, icon, bucket_hint, sort_order)
  VALUES
    (NEW.id, '4k', '4K / Câmera', '🎥', 'videos', 0),
    (NEW.id, 'videos', 'Vídeos', '🎬', 'videos', 1),
    (NEW.id, 'imagens', 'Imagens', '🖼️', 'images', 2),
    (NEW.id, 'documentos', 'Documentos', '📄', 'files', 3)
  ON CONFLICT (client_id, slug) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seed_file_folders_on_client ON public.clients;
CREATE TRIGGER seed_file_folders_on_client
  AFTER INSERT ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.seed_file_folders_for_client();

-- Remove pastas Documentos de todos os clientes

DELETE FROM public.files
WHERE folder_path IN ('/documentos/', 'documentos/', '/documentos');

DELETE FROM public.file_folders WHERE slug = 'documentos';

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
    (NEW.id, 'wanessa', 'Wanessa', '📁', 'files', 3)
  ON CONFLICT (client_id, slug) DO NOTHING;
  RETURN NEW;
END;
$$;

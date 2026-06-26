-- Remove pastas 4K / Câmera de todos os clientes

DELETE FROM public.files
WHERE folder_path IN ('/4k/', '4k/') OR folder_path LIKE '%/4k/%';

DELETE FROM public.file_folders WHERE slug = '4k';

CREATE OR REPLACE FUNCTION public.seed_file_folders_for_client()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.file_folders (client_id, slug, label, icon, bucket_hint, sort_order)
  VALUES
    (NEW.id, 'videos', 'Vídeos', '🎬', 'videos', 0),
    (NEW.id, 'imagens', 'Imagens', '🖼️', 'images', 1),
    (NEW.id, 'wanessa', 'Wanessa', '📁', 'files', 2)
  ON CONFLICT (client_id, slug) DO NOTHING;
  RETURN NEW;
END;
$$;

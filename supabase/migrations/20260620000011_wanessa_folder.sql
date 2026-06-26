-- Pasta Wanessa em todos os clientes + seed automático para novos clientes

INSERT INTO public.file_folders (client_id, slug, label, icon, bucket_hint, sort_order)
SELECT c.id, 'wanessa', 'Wanessa', '👤', 'files',
  COALESCE((SELECT MAX(ff.sort_order) + 1 FROM public.file_folders ff WHERE ff.client_id = c.id), 4)
FROM public.clients c
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
    (NEW.id, 'wanessa', 'Wanessa', '📁', 'files', 3)
  ON CONFLICT (client_id, slug) DO NOTHING;
  RETURN NEW;
END;
$$;

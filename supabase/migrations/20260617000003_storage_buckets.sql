-- CDM Central - Storage Buckets

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('files', 'files', false, 524288000, NULL),
  ('images', 'images', false, 52428800, ARRAY['image/jpeg','image/png','image/webp','image/gif','image/svg+xml']),
  ('videos', 'videos', false, 1073741824, ARRAY['video/mp4','video/webm','video/quicktime']),
  ('contracts', 'contracts', false, 52428800, ARRAY['application/pdf']),
  ('invoices', 'invoices', false, 52428800, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: staff pode ler/escrever, clientes só seus arquivos
CREATE POLICY "storage_files_select" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id IN ('files','images','videos','contracts','invoices')
    AND (
      public.is_admin_or_gestor()
      OR (storage.foldername(name))[1] = auth.uid()::text
      OR EXISTS (
        SELECT 1 FROM public.profiles pr
        WHERE pr.id = auth.uid()
        AND pr.role = 'cliente'
        AND (storage.foldername(name))[1] = pr.client_id::text
      )
      OR public.is_staff()
    )
  );

CREATE POLICY "storage_files_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id IN ('files','images','videos','contracts','invoices')
    AND public.is_staff()
  );

CREATE POLICY "storage_files_update" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id IN ('files','images','videos','contracts','invoices')
    AND public.is_staff()
  )
  WITH CHECK (
    bucket_id IN ('files','images','videos','contracts','invoices')
    AND public.is_staff()
  );

CREATE POLICY "storage_files_delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id IN ('files','images','videos','contracts','invoices')
    AND (public.is_admin_or_gestor() OR owner = auth.uid())
  );

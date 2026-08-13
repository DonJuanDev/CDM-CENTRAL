-- Concluído em notas pessoais e gerais

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS is_completed BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_notes_completed ON public.notes(is_completed, created_at DESC);

DROP POLICY IF EXISTS "notes_update" ON public.notes;

CREATE POLICY "notes_update" ON public.notes FOR UPDATE TO authenticated
  USING (
    (note_type = 'personal' AND author_id = auth.uid())
    OR (
      note_type = 'general'
      AND public.is_staff()
      AND (author_id = auth.uid() OR assigned_to = auth.uid() OR public.is_admin_or_gestor())
    )
  )
  WITH CHECK (
    (note_type = 'personal' AND author_id = auth.uid())
    OR (
      note_type = 'general'
      AND public.is_staff()
      AND (author_id = auth.uid() OR assigned_to = auth.uid() OR public.is_admin_or_gestor())
    )
  );

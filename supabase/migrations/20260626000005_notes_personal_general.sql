-- Notas pessoais (só o autor) vs notas gerais (equipe) com responsável

CREATE TYPE public.note_type AS ENUM ('personal', 'general');

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS note_type public.note_type NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notes_type_author ON public.notes(note_type, author_id);
CREATE INDEX IF NOT EXISTS idx_notes_assigned ON public.notes(assigned_to) WHERE assigned_to IS NOT NULL;

-- Políticas anteriores (acesso por cliente/autor)
DROP POLICY IF EXISTS "notes_select" ON public.notes;
DROP POLICY IF EXISTS "notes_insert" ON public.notes;
DROP POLICY IF EXISTS "notes_update" ON public.notes;
DROP POLICY IF EXISTS "notes_delete" ON public.notes;

CREATE POLICY "notes_select" ON public.notes FOR SELECT TO authenticated
  USING (
    (note_type = 'personal' AND author_id = auth.uid())
    OR (note_type = 'general' AND public.is_staff())
  );

CREATE POLICY "notes_insert" ON public.notes FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND public.is_staff()
    AND note_type IN ('personal', 'general')
  );

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
    author_id = auth.uid() OR public.is_admin_or_gestor()
  );

CREATE POLICY "notes_delete" ON public.notes FOR DELETE TO authenticated
  USING (
    (note_type = 'personal' AND author_id = auth.uid())
    OR (note_type = 'general' AND (author_id = auth.uid() OR public.is_admin_or_gestor()))
  );

-- Notificar responsável em nota geral
CREATE OR REPLACE FUNCTION public.notify_note_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor TEXT;
BEGIN
  IF NEW.note_type IS DISTINCT FROM 'general' OR NEW.assigned_to IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.assigned_to IS NOT DISTINCT FROM NEW.assigned_to THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL AND NEW.assigned_to = auth.uid() THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO v_actor FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.notifications (user_id, title, message, type, link, entity_type, entity_id)
  VALUES (
    NEW.assigned_to,
    COALESCE(v_actor, 'Equipe CDM') || ' atribuiu você a uma nota',
    NEW.title,
    'info',
    '#/notas-gerais?nota=' || NEW.id::text,
    'notes',
    NEW.id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_note_assignment ON public.notes;
CREATE TRIGGER trg_notify_note_assignment
  AFTER INSERT OR UPDATE OF assigned_to ON public.notes
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_note_assignment();

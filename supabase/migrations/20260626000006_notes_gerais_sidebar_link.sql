-- Atualiza deep link de notificação para Notas Gerais na sidebar
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

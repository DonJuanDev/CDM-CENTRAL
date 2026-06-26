-- Equipe interna: mesmo calendário e clientes para admin/gestor/colaborador
DROP POLICY IF EXISTS "clients_select" ON public.clients;
CREATE POLICY "clients_select" ON public.clients FOR SELECT TO authenticated
  USING (
    get_my_role() IN ('admin', 'gestor', 'colaborador')
    OR can_access_client(id)
  );

DROP POLICY IF EXISTS "tasks_select" ON public.tasks;
CREATE POLICY "tasks_select" ON public.tasks FOR SELECT TO authenticated
  USING (
    get_my_role() IN ('admin', 'gestor', 'colaborador')
    OR (client_id IS NOT NULL AND can_access_client(client_id))
    OR assigned_to = auth.uid()
    OR created_by = auth.uid()
  );

DROP POLICY IF EXISTS "tasks_update" ON public.tasks;
CREATE POLICY "tasks_update" ON public.tasks FOR UPDATE TO authenticated
  USING (
    get_my_role() IN ('admin', 'gestor', 'colaborador')
    OR assigned_to = auth.uid()
    OR created_by = auth.uid()
  )
  WITH CHECK (
    get_my_role() IN ('admin', 'gestor', 'colaborador')
    OR assigned_to = auth.uid()
    OR created_by = auth.uid()
  );

-- Colaboradores veem perfis da equipe (select de responsável)
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR get_my_role() IN ('admin', 'gestor', 'colaborador')
  );

-- Metadados de notificação para deep link
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS entity_type TEXT,
  ADD COLUMN IF NOT EXISTS entity_id UUID;

CREATE INDEX IF NOT EXISTS idx_notifications_entity ON public.notifications(entity_type, entity_id);

-- Notificar quando alguém é atribuído a uma tarefa
CREATE OR REPLACE FUNCTION public.notify_task_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor TEXT;
BEGIN
  IF NEW.assigned_to IS NULL THEN
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
    COALESCE(v_actor, 'Equipe CDM') || ' atribuiu você a um conteúdo',
    NEW.title,
    'info',
    '#/calendario?task=' || NEW.id::text
      || CASE WHEN NEW.due_date IS NOT NULL THEN '&date=' || NEW.due_date::text ELSE '' END,
    'tasks',
    NEW.id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_task_assignment ON public.tasks;
CREATE TRIGGER trg_notify_task_assignment
  AFTER INSERT OR UPDATE OF assigned_to ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_task_assignment();

-- Criar usuários da equipe (senha padrão definida no seed)
CREATE OR REPLACE FUNCTION public.seed_team_user(
  p_email TEXT,
  p_password TEXT,
  p_full_name TEXT,
  p_role public.user_role DEFAULT 'colaborador'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user_id UUID;
  v_encrypted_pw TEXT;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = lower(p_email) LIMIT 1;

  IF v_user_id IS NOT NULL THEN
    UPDATE public.profiles
    SET full_name = p_full_name, role = p_role, email = lower(p_email), is_active = true
    WHERE id = v_user_id;
    RETURN v_user_id;
  END IF;

  v_user_id := gen_random_uuid();
  v_encrypted_pw := crypt(p_password, gen_salt('bf'));

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, is_super_admin
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    lower(p_email),
    v_encrypted_pw,
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('full_name', p_full_name),
    now(),
    now(),
    '',
    false
  );

  INSERT INTO auth.identities (
    provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at, id
  ) VALUES (
    lower(p_email),
    v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', lower(p_email), 'email_verified', true),
    'email',
    now(),
    now(),
    now(),
    gen_random_uuid()
  );

  INSERT INTO public.profiles (id, email, full_name, role, is_active)
  VALUES (v_user_id, lower(p_email), p_full_name, p_role, true)
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name, role = EXCLUDED.role, email = EXCLUDED.email, is_active = true;

  RETURN v_user_id;
END;
$$;

DO $$
BEGIN
  PERFORM public.seed_team_user('ney@r5wf.com.br', 'Mariah775566', 'Ney', 'admin');
  PERFORM public.seed_team_user('mariah@cdmmkt.com.br', 'Mariah775566', 'Mariah Caciatore', 'admin');
  PERFORM public.seed_team_user('bernardo@cdmmkt.com.br', 'Mariah775566', 'Bernardo', 'admin');
  PERFORM public.seed_team_user('juan@cdmmkt.com.br', 'Mariah775566', 'Juan Canada', 'admin');
END;
$$;

REVOKE ALL ON FUNCTION public.seed_team_user(TEXT, TEXT, TEXT, public.user_role) FROM PUBLIC, anon, authenticated;

-- Vincular tarefas existentes ao perfil pelo assignee_name
UPDATE public.tasks t
SET assigned_to = p.id
FROM public.profiles p
WHERE t.assigned_to IS NULL
  AND t.assignee_name IS NOT NULL
  AND (
    (lower(t.assignee_name) LIKE '%ney%' AND lower(p.email) = 'ney@r5wf.com.br')
    OR (lower(t.assignee_name) LIKE '%mariah%' AND lower(p.email) = 'mariah@cdmmkt.com.br')
    OR (lower(t.assignee_name) LIKE '%juan%' AND lower(p.email) = 'juan@cdmmkt.com.br')
    OR (lower(t.assignee_name) LIKE '%bernardo%' AND lower(p.email) = 'bernardo@cdmmkt.com.br')
  );

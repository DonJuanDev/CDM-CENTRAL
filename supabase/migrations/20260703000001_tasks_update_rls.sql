-- Colaboradores com acesso ao cliente podem editar tarefas desse cliente

DROP POLICY IF EXISTS "tasks_update" ON public.tasks;

CREATE POLICY "tasks_update" ON public.tasks FOR UPDATE TO authenticated
  USING (
    is_admin_or_gestor()
    OR assigned_to = auth.uid()
    OR created_by = auth.uid()
    OR (
      client_id IS NOT NULL
      AND can_access_client(client_id)
      AND is_staff()
      AND get_my_role() != 'cliente'
    )
  )
  WITH CHECK (
    is_admin_or_gestor()
    OR assigned_to = auth.uid()
    OR created_by = auth.uid()
    OR (
      client_id IS NOT NULL
      AND can_access_client(client_id)
      AND is_staff()
      AND get_my_role() != 'cliente'
    )
  );

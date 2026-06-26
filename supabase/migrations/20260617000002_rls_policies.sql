-- CDM Central - Row Level Security

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_sync_logs ENABLE ROW LEVEL SECURITY;

-- PROFILES
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR is_admin_or_gestor());

CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_admin_all" ON public.profiles FOR ALL TO authenticated
  USING (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');

-- CLIENTS
CREATE POLICY "clients_select" ON public.clients FOR SELECT TO authenticated
  USING (can_access_client(id));

CREATE POLICY "clients_insert" ON public.clients FOR INSERT TO authenticated
  WITH CHECK (is_staff() AND get_my_role() != 'cliente');

CREATE POLICY "clients_update" ON public.clients FOR UPDATE TO authenticated
  USING (can_access_client(id) AND get_my_role() != 'cliente')
  WITH CHECK (can_access_client(id) AND get_my_role() != 'cliente');

CREATE POLICY "clients_delete" ON public.clients FOR DELETE TO authenticated
  USING (is_admin_or_gestor());

-- PROJECTS
CREATE POLICY "projects_select" ON public.projects FOR SELECT TO authenticated
  USING (can_access_client(client_id));

CREATE POLICY "projects_insert" ON public.projects FOR INSERT TO authenticated
  WITH CHECK (is_staff() AND get_my_role() != 'cliente');

CREATE POLICY "projects_update" ON public.projects FOR UPDATE TO authenticated
  USING (can_access_client(client_id) AND get_my_role() != 'cliente')
  WITH CHECK (can_access_client(client_id) AND get_my_role() != 'cliente');

CREATE POLICY "projects_delete" ON public.projects FOR DELETE TO authenticated
  USING (is_admin_or_gestor());

-- PROJECT MEMBERS
CREATE POLICY "project_members_select" ON public.project_members FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND can_access_client(p.client_id)));

CREATE POLICY "project_members_manage" ON public.project_members FOR ALL TO authenticated
  USING (is_admin_or_gestor())
  WITH CHECK (is_admin_or_gestor());

-- TASKS
CREATE POLICY "tasks_select" ON public.tasks FOR SELECT TO authenticated
  USING (
    (client_id IS NOT NULL AND can_access_client(client_id))
    OR assigned_to = auth.uid()
    OR created_by = auth.uid()
    OR is_admin_or_gestor()
  );

CREATE POLICY "tasks_insert" ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (is_staff() AND get_my_role() != 'cliente');

CREATE POLICY "tasks_update" ON public.tasks FOR UPDATE TO authenticated
  USING (
    assigned_to = auth.uid() OR created_by = auth.uid() OR is_admin_or_gestor()
  )
  WITH CHECK (
    assigned_to = auth.uid() OR created_by = auth.uid() OR is_admin_or_gestor()
  );

CREATE POLICY "tasks_delete" ON public.tasks FOR DELETE TO authenticated
  USING (is_admin_or_gestor() OR created_by = auth.uid());

-- TASK COMMENTS
CREATE POLICY "task_comments_select" ON public.task_comments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND (
    t.assigned_to = auth.uid() OR t.created_by = auth.uid() OR is_admin_or_gestor()
    OR (t.client_id IS NOT NULL AND can_access_client(t.client_id))
  )));

CREATE POLICY "task_comments_insert" ON public.task_comments FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND is_staff());

-- CALENDAR EVENTS
CREATE POLICY "calendar_events_select" ON public.calendar_events FOR SELECT TO authenticated
  USING (
    (client_id IS NULL AND is_staff())
    OR (client_id IS NOT NULL AND can_access_client(client_id))
    OR auth.uid() = ANY(responsaveis)
  );

CREATE POLICY "calendar_events_insert" ON public.calendar_events FOR INSERT TO authenticated
  WITH CHECK (is_staff() AND get_my_role() != 'cliente');

CREATE POLICY "calendar_events_update" ON public.calendar_events FOR UPDATE TO authenticated
  USING (is_staff() AND get_my_role() != 'cliente')
  WITH CHECK (is_staff() AND get_my_role() != 'cliente');

CREATE POLICY "calendar_events_delete" ON public.calendar_events FOR DELETE TO authenticated
  USING (is_admin_or_gestor() OR created_by = auth.uid());

-- MEETINGS
CREATE POLICY "meetings_select" ON public.meetings FOR SELECT TO authenticated
  USING (
    (client_id IS NULL AND is_staff())
    OR (client_id IS NOT NULL AND can_access_client(client_id))
    OR auth.uid() = ANY(attendees)
  );

CREATE POLICY "meetings_insert" ON public.meetings FOR INSERT TO authenticated
  WITH CHECK (is_staff());

CREATE POLICY "meetings_update" ON public.meetings FOR UPDATE TO authenticated
  USING (is_staff())
  WITH CHECK (is_staff());

CREATE POLICY "meetings_delete" ON public.meetings FOR DELETE TO authenticated
  USING (is_admin_or_gestor());

-- INVOICES
CREATE POLICY "invoices_select" ON public.invoices FOR SELECT TO authenticated
  USING (can_access_client(client_id));

CREATE POLICY "invoices_insert" ON public.invoices FOR INSERT TO authenticated
  WITH CHECK (is_admin_or_gestor());

CREATE POLICY "invoices_update" ON public.invoices FOR UPDATE TO authenticated
  USING (is_admin_or_gestor())
  WITH CHECK (is_admin_or_gestor());

CREATE POLICY "invoices_delete" ON public.invoices FOR DELETE TO authenticated
  USING (get_my_role() = 'admin');

-- PAYMENTS
CREATE POLICY "payments_select" ON public.payments FOR SELECT TO authenticated
  USING (
    get_my_role() IN ('admin', 'gestor')
    OR (client_id IS NOT NULL AND can_access_client(client_id) AND get_my_role() = 'cliente')
  );

CREATE POLICY "payments_insert" ON public.payments FOR INSERT TO authenticated
  WITH CHECK (is_admin_or_gestor());

CREATE POLICY "payments_update" ON public.payments FOR UPDATE TO authenticated
  USING (is_admin_or_gestor())
  WITH CHECK (is_admin_or_gestor());

CREATE POLICY "payments_delete" ON public.payments FOR DELETE TO authenticated
  USING (get_my_role() = 'admin');

-- CAMPAIGNS
CREATE POLICY "campaigns_select" ON public.campaigns FOR SELECT TO authenticated
  USING (can_access_client(client_id));

CREATE POLICY "campaigns_insert" ON public.campaigns FOR INSERT TO authenticated
  WITH CHECK (is_staff() AND get_my_role() != 'cliente');

CREATE POLICY "campaigns_update" ON public.campaigns FOR UPDATE TO authenticated
  USING (is_staff() AND get_my_role() != 'cliente')
  WITH CHECK (is_staff() AND get_my_role() != 'cliente');

CREATE POLICY "campaigns_delete" ON public.campaigns FOR DELETE TO authenticated
  USING (is_admin_or_gestor());

-- CREATIVES
CREATE POLICY "creatives_select" ON public.creatives FOR SELECT TO authenticated
  USING (can_access_client(client_id));

CREATE POLICY "creatives_insert" ON public.creatives FOR INSERT TO authenticated
  WITH CHECK (is_staff() AND get_my_role() != 'cliente');

CREATE POLICY "creatives_update" ON public.creatives FOR UPDATE TO authenticated
  USING (is_staff() AND get_my_role() != 'cliente')
  WITH CHECK (is_staff() AND get_my_role() != 'cliente');

CREATE POLICY "creatives_delete" ON public.creatives FOR DELETE TO authenticated
  USING (is_admin_or_gestor());

-- VIDEOS
CREATE POLICY "videos_select" ON public.videos FOR SELECT TO authenticated
  USING (can_access_client(client_id));

CREATE POLICY "videos_insert" ON public.videos FOR INSERT TO authenticated
  WITH CHECK (is_staff() AND get_my_role() != 'cliente');

CREATE POLICY "videos_update" ON public.videos FOR UPDATE TO authenticated
  USING (is_staff() AND get_my_role() != 'cliente')
  WITH CHECK (is_staff() AND get_my_role() != 'cliente');

CREATE POLICY "videos_delete" ON public.videos FOR DELETE TO authenticated
  USING (is_admin_or_gestor());

-- FILES
CREATE POLICY "files_select" ON public.files FOR SELECT TO authenticated
  USING (
    (client_id IS NULL AND is_staff())
    OR (client_id IS NOT NULL AND can_access_client(client_id))
  );

CREATE POLICY "files_insert" ON public.files FOR INSERT TO authenticated
  WITH CHECK (is_staff());

CREATE POLICY "files_update" ON public.files FOR UPDATE TO authenticated
  USING (uploaded_by = auth.uid() OR is_admin_or_gestor())
  WITH CHECK (uploaded_by = auth.uid() OR is_admin_or_gestor());

CREATE POLICY "files_delete" ON public.files FOR DELETE TO authenticated
  USING (uploaded_by = auth.uid() OR is_admin_or_gestor());

-- NOTES
CREATE POLICY "notes_select" ON public.notes FOR SELECT TO authenticated
  USING (
    author_id = auth.uid()
    OR is_admin_or_gestor()
    OR (client_id IS NOT NULL AND can_access_client(client_id))
  );

CREATE POLICY "notes_insert" ON public.notes FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid());

CREATE POLICY "notes_update" ON public.notes FOR UPDATE TO authenticated
  USING (author_id = auth.uid() OR is_admin_or_gestor())
  WITH CHECK (author_id = auth.uid() OR is_admin_or_gestor());

CREATE POLICY "notes_delete" ON public.notes FOR DELETE TO authenticated
  USING (author_id = auth.uid() OR is_admin_or_gestor());

-- NOTIFICATIONS
CREATE POLICY "notifications_select" ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "notifications_update" ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "notifications_insert" ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (is_staff());

CREATE POLICY "notifications_delete" ON public.notifications FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR is_admin_or_gestor());

-- INTEGRATIONS
CREATE POLICY "integrations_select" ON public.integrations FOR SELECT TO authenticated
  USING (
    is_admin_or_gestor()
    OR (client_id IS NOT NULL AND can_access_client(client_id) AND get_my_role() = 'cliente')
  );

CREATE POLICY "integrations_manage" ON public.integrations FOR ALL TO authenticated
  USING (is_admin_or_gestor())
  WITH CHECK (is_admin_or_gestor());

-- INTEGRATION SYNC LOGS
CREATE POLICY "sync_logs_select" ON public.integration_sync_logs FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.integrations i
    WHERE i.id = integration_id AND (
      is_admin_or_gestor()
      OR (i.client_id IS NOT NULL AND can_access_client(i.client_id))
    )
  ));

CREATE POLICY "sync_logs_insert" ON public.integration_sync_logs FOR INSERT TO authenticated
  WITH CHECK (is_admin_or_gestor());

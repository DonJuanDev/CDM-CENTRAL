-- Escritório CDM: Canva catalog + office jobs

-- Integração mãe Canva (sem client_id), igual ao Meta Ads
CREATE UNIQUE INDEX IF NOT EXISTS integrations_canva_master_unique
  ON public.integrations (provider)
  WHERE client_id IS NULL AND provider = 'canva';

-- Pastas sincronizadas do Canva
CREATE TABLE IF NOT EXISTS public.canva_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  parent_folder_id TEXT,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canva_folders_client ON public.canva_folders(client_id);
CREATE INDEX IF NOT EXISTS idx_canva_folders_parent ON public.canva_folders(parent_folder_id);

-- Designs sincronizados do Canva (catálogo leve)
CREATE TABLE IF NOT EXISTS public.canva_designs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  design_id TEXT NOT NULL UNIQUE,
  folder_id TEXT REFERENCES public.canva_folders(folder_id) ON DELETE SET NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  title TEXT,
  thumbnail_url TEXT,
  page_count INTEGER DEFAULT 1,
  updated_at_canva TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canva_designs_client ON public.canva_designs(client_id);
CREATE INDEX IF NOT EXISTS idx_canva_designs_folder ON public.canva_designs(folder_id);
CREATE INDEX IF NOT EXISTS idx_canva_designs_updated ON public.canva_designs(updated_at_canva DESC NULLS LAST);

-- Jobs do expediente (agents)
CREATE TABLE IF NOT EXISTS public.office_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  agent_role TEXT NOT NULL DEFAULT 'social',
  content_type TEXT NOT NULL DEFAULT 'post',
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'studying', 'writing', 'done', 'error')),
  canva_context JSONB DEFAULT '{}'::jsonb,
  output JSONB DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_office_jobs_task ON public.office_jobs(task_id);
CREATE INDEX IF NOT EXISTS idx_office_jobs_status ON public.office_jobs(status);
CREATE INDEX IF NOT EXISTS idx_office_jobs_created ON public.office_jobs(created_at DESC);

CREATE TRIGGER set_updated_at_canva_folders
  BEFORE UPDATE ON public.canva_folders
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at_canva_designs
  BEFORE UPDATE ON public.canva_designs
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at_office_jobs
  BEFORE UPDATE ON public.office_jobs
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- RLS
ALTER TABLE public.canva_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canva_designs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.office_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "canva_folders_select" ON public.canva_folders FOR SELECT TO authenticated
  USING (public.is_staff());

CREATE POLICY "canva_folders_manage" ON public.canva_folders FOR ALL TO authenticated
  USING (public.is_admin_or_gestor())
  WITH CHECK (public.is_admin_or_gestor());

CREATE POLICY "canva_designs_select" ON public.canva_designs FOR SELECT TO authenticated
  USING (public.is_staff());

CREATE POLICY "canva_designs_manage" ON public.canva_designs FOR ALL TO authenticated
  USING (public.is_admin_or_gestor())
  WITH CHECK (public.is_admin_or_gestor());

CREATE POLICY "office_jobs_select" ON public.office_jobs FOR SELECT TO authenticated
  USING (public.is_staff());

CREATE POLICY "office_jobs_insert" ON public.office_jobs FOR INSERT TO authenticated
  WITH CHECK (public.is_staff() AND public.get_my_role() != 'cliente');

CREATE POLICY "office_jobs_update" ON public.office_jobs FOR UPDATE TO authenticated
  USING (public.is_staff() AND public.get_my_role() != 'cliente')
  WITH CHECK (public.is_staff() AND public.get_my_role() != 'cliente');

CREATE POLICY "office_jobs_delete" ON public.office_jobs FOR DELETE TO authenticated
  USING (public.is_admin_or_gestor());

-- Realtime para o Escritório
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'office_jobs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.office_jobs;
  END IF;
END $$;

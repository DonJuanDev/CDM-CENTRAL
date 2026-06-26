-- Planejamento diário por usuário (tarefas e anotações por dia)

CREATE TABLE public.daily_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_date DATE NOT NULL,
  notes TEXT DEFAULT '',
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, plan_date)
);

CREATE INDEX daily_plans_user_date_idx ON public.daily_plans(user_id, plan_date DESC);

ALTER TABLE public.daily_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_plans_select" ON public.daily_plans FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "daily_plans_insert" ON public.daily_plans FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "daily_plans_update" ON public.daily_plans FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "daily_plans_delete" ON public.daily_plans FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.daily_plans
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

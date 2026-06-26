-- Índice único para campanhas sincronizadas de plataformas externas
-- Permite upsert correto sem duplicatas ao sincronizar do Meta Ads, Google Ads, etc.

CREATE UNIQUE INDEX IF NOT EXISTS campaigns_external_id_unique
  ON public.campaigns(external_id)
  WHERE external_id IS NOT NULL;

-- Adiciona updated_at para rastrear quando a campanha foi atualizada
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Trigger para atualizar updated_at automaticamente
DROP TRIGGER IF EXISTS set_updated_at ON public.campaigns;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

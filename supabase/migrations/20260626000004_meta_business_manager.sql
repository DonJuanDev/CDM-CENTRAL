-- Permite uma integração "conta mãe" Meta Ads (sem client_id vinculado)
CREATE UNIQUE INDEX IF NOT EXISTS integrations_meta_master_unique
  ON public.integrations (provider)
  WHERE client_id IS NULL AND provider = 'meta_ads';

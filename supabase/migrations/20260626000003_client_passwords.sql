-- Colunas dedicadas para credenciais dos clientes (aba Senhas Clientes)
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS instagram_password TEXT,
  ADD COLUMN IF NOT EXISTS tiktok_password TEXT,
  ADD COLUMN IF NOT EXISTS facebook_password TEXT,
  ADD COLUMN IF NOT EXISTS email_password TEXT,
  ADD COLUMN IF NOT EXISTS linktree_password TEXT;

COMMENT ON COLUMN public.clients.instagram IS 'Login Instagram / usuário';
COMMENT ON COLUMN public.clients.instagram_password IS 'Senha Instagram';
COMMENT ON COLUMN public.clients.tiktok_password IS 'Senha TikTok';
COMMENT ON COLUMN public.clients.facebook_password IS 'Senha login perfil Facebook';
COMMENT ON COLUMN public.clients.email_password IS 'Senha do e-mail';
COMMENT ON COLUMN public.clients.linktree IS 'Linktree / usuário';
COMMENT ON COLUMN public.clients.linktree_password IS 'Senha Linktree';

-- Helper: upsert credenciais por nome do cliente
CREATE OR REPLACE FUNCTION public.upsert_client_credentials(
  p_company_name TEXT,
  p_instagram TEXT DEFAULT NULL,
  p_instagram_password TEXT DEFAULT NULL,
  p_tiktok_password TEXT DEFAULT NULL,
  p_facebook_password TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_email_password TEXT DEFAULT NULL,
  p_linktree TEXT DEFAULT NULL,
  p_linktree_password TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_id UUID;
  v_owner UUID;
BEGIN
  SELECT id INTO v_id FROM public.clients
  WHERE lower(trim(company_name)) = lower(trim(p_company_name))
  LIMIT 1;

  IF v_id IS NULL THEN
    SELECT id INTO v_owner FROM public.profiles WHERE email = 'cdm@cdmmkt.com.br' LIMIT 1;
    INSERT INTO public.clients (company_name, status, created_by)
    VALUES (p_company_name, 'ativo', v_owner)
    RETURNING id INTO v_id;
  END IF;

  UPDATE public.clients SET
    instagram = COALESCE(p_instagram, instagram),
    instagram_password = COALESCE(p_instagram_password, instagram_password),
    tiktok_password = COALESCE(p_tiktok_password, tiktok_password),
    facebook_password = COALESCE(p_facebook_password, facebook_password),
    email = COALESCE(p_email, email),
    email_password = COALESCE(p_email_password, email_password),
    linktree = COALESCE(p_linktree, linktree),
    linktree_password = COALESCE(p_linktree_password, linktree_password),
    updated_at = now()
  WHERE id = v_id;
END;
$$ LANGUAGE plpgsql;

-- Popular credenciais
DO $$
BEGIN
  PERFORM public.upsert_client_credentials('Antichip', 'antichipppf', 'Ney775566');
  PERFORM public.upsert_client_credentials('ASWF', 'Mariah@r5wf.com.br', 'Ma130996');
  PERFORM public.upsert_client_credentials('CDM', NULL, 'Ney775566@');
  PERFORM public.upsert_client_credentials('Color Stable', 'ney775566');
  PERFORM public.upsert_client_credentials('Comercial R5WF', NULL, 'RGS@2023');
  PERFORM public.upsert_client_credentials('Grupo R5', 'grupor5br', 'R5775566@', 'Ney775566@');
  PERFORM public.upsert_client_credentials('Loja Antichip', 'lojaoficialantichipppf', 'antichipppf@2024', 'Antichip@2024', NULL, 'lojaantichip@gmail.com', 'lojaantichip775566');
  PERFORM public.upsert_client_credentials('Lunarfilm', 'lunarfilmpeliculas', 'R5Lunar@2024', 'Ney775566');
  PERFORM public.upsert_client_credentials('Phytomaster', 'phytomaster', 'phyto130996', NULL, NULL, NULL, NULL, 'fphytomaster', 'phyto775566');
  PERFORM public.upsert_client_credentials('R5 Paraná', 'R5.parana', 'R5775566');
  PERFORM public.upsert_client_credentials('R5 Santa Catarina', 'R5.santacatarina', 'R5sc775566@');
  PERFORM public.upsert_client_credentials('R5 Rio Grande do Sul', 'r5.riograndedosul', 'RGS@775566');
  PERFORM public.upsert_client_credentials('R5 São Paulo', 'r5.saopaulo', 'ney776655');
  PERFORM public.upsert_client_credentials('R5WF Brasil', 'mkt@r5wf.com.br', 'Ney775566@', 'Ney775566@');
  PERFORM public.upsert_client_credentials('RGS Film', 'rodolfo@rgsfilm.com.br', 'RGS@775566');
  PERFORM public.upsert_client_credentials('UDF', 'universidadedofilm@gmail.com', 'UDF775566');
  PERFORM public.upsert_client_credentials('Flat Glass', 'flatglassbr', 'FGCDM2025', NULL, NULL, 'flatglassbr@gmail.com', 'Ney775567');
  PERFORM public.upsert_client_credentials('Loja Oficial R5WF', 'lojaoficialr5wf', 'Ney775566-');
  PERFORM public.upsert_client_credentials('American Cut', 'Reginaldo2025@@');
  PERFORM public.upsert_client_credentials('CDM Branding', 'cdmbranding', 'Cdm2025');
  PERFORM public.upsert_client_credentials('CDL Jovem', 'cdljovemflorianopolis', 'NilseN682.pariflo');
  PERFORM public.upsert_client_credentials('Instituto Gr5 Brasil', 'institutogr5brasil', 'Ney775566@');
  PERFORM public.upsert_client_credentials('Atacadão Brasil Películas', 'atacadaobrasilpeliculas', 'neyrafa', NULL, NULL, 'atacadaobrasilpeliculas@gmail.com', 'Neyrafa775566#');
  PERFORM public.upsert_client_credentials('CDM Marketing', NULL, 'Cdm2025@@');
  PERFORM public.upsert_client_credentials('Cap Cut CDM', 'Suporte@cdmmkt.com.br', 'Cdm@2025');
END $$;

DROP FUNCTION IF EXISTS public.upsert_client_credentials(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

-- Campos extras estilo Notion
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS icon TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS claude TEXT;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS client_names TEXT,
  ADD COLUMN IF NOT EXISTS assignee_name TEXT;

-- Seed CDM Marketing (Notion)
DO $$
DECLARE
  v_owner UUID;
BEGIN
  SELECT id INTO v_owner FROM public.profiles WHERE email = 'cdm@cdmmkt.com.br' LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Usuário cdm@cdmmkt.com.br não encontrado';
  END IF;

  DELETE FROM public.tasks;
  DELETE FROM public.clients;

  INSERT INTO public.clients (id, company_name, icon, area_atuacao, notes, status, created_by, instagram, facebook, tiktok, linktree, claude) VALUES
  ('c1000001-0001-0001-0001-000000000001', 'Phytomaster', '💊', 'Cliente Final - Farmácia',
   $p$Mandar os conteúdos para aprovação:

CAMPANHA COPA DO MUNDO PHYTOMASTER — SUA SAÚDE NA SELEÇÃO DOS CAMPEÕES
Times: Energia, Recuperação, Imunidade, Sono.
Identidade: verde e amarelo, campo de futebol, escalação dos times.$p$, 'ativo', v_owner, NULL, NULL, NULL, NULL, NULL),

  ('c1000001-0001-0001-0001-000000000002', 'R5WF Brasil', '🚗', 'Cliente Final - Película', NULL, 'ativo', v_owner, NULL, NULL, NULL, NULL, NULL),
  ('c1000001-0001-0001-0001-000000000003', 'Lunarfilm', '', 'Cliente Final - Película', NULL, 'ativo', v_owner, NULL, NULL, NULL, NULL, NULL),
  ('c1000001-0001-0001-0001-000000000004', 'Antichip', '', 'Cliente Final - PPF', 'Mandar os conteúdos para aprovação', 'ativo', v_owner, NULL, NULL, NULL, NULL, NULL),
  ('c1000001-0001-0001-0001-000000000005', 'American Cut', '', 'Software', 'Mandar os conteúdos para aprovação', 'ativo', v_owner, NULL, NULL, NULL, NULL, NULL),
  ('c1000001-0001-0001-0001-000000000006', 'Atacadão Brasil Películas', '', 'Cliente Final - Película',
   $a$Tabela de preço:
PR-Prestigie: R$80/m | karbon: R$38/m | metal lux: R$25/m | dark: R$15/m
Decorativas: a partir R$25/m | PPF bobina R$200/m | PPF metro R$300/m
Película segurança: a partir R$25/m | Profissional: R$15/m | tintada: R$12/m
CS-Color Stable: Bobina R$2.000 | metro R$67/m$a$, 'ativo', v_owner, NULL, NULL, NULL, NULL, NULL),
  ('c1000001-0001-0001-0001-000000000007', 'Flat Glass', '', 'Cliente Final - Película', NULL, 'ativo', v_owner, NULL, NULL, NULL, NULL, NULL),
  ('c1000001-0001-0001-0001-000000000008', 'R5 Rio Grande do Sul', '', 'Lojista - Película', NULL, 'ativo', v_owner, NULL, NULL, NULL, NULL, NULL),
  ('c1000001-0001-0001-0001-000000000009', 'R5 Santa Catarina', '', 'Lojista - Película', NULL, 'ativo', v_owner, NULL, NULL, NULL, NULL, NULL),
  ('c1000001-0001-0001-0001-000000000010', 'R5 São Paulo', '', 'Lojista - Película', NULL, 'ativo', v_owner, NULL, NULL, NULL, NULL, NULL),
  ('c1000001-0001-0001-0001-000000000011', 'R5 Paraná', '', 'Lojista - Película', NULL, 'ativo', v_owner, NULL, NULL, NULL, NULL, NULL),
  ('c1000001-0001-0001-0001-000000000012', 'Grupo R5', '', 'Mãe de todos', NULL, 'ativo', v_owner, NULL, NULL, NULL, NULL, NULL),
  ('c1000001-0001-0001-0001-000000000013', 'Color Stable', '', 'Cliente Final - Película', NULL, 'ativo', v_owner, NULL, NULL, NULL, NULL, NULL),
  ('c1000001-0001-0001-0001-000000000014', 'Loja Antichip', '', 'Cliente Final - PPF', NULL, 'ativo', v_owner, NULL, NULL, NULL, NULL, NULL);

  INSERT INTO public.tasks (title, client_id, client_names, assignee_name, priority, status, column_name, due_date, created_by) VALUES
  ('Precisa de produto? O Atacadão resolve.', 'c1000001-0001-0001-0001-000000000006', NULL, 'Social Media CDM', 'media', 'concluida', 'concluido', '2026-06-15', v_owner),
  ('Ainda não vende decorativa?', 'c1000001-0001-0001-0001-000000000006', NULL, 'Social Media CDM', 'media', 'concluida', 'concluido', '2026-06-15', v_owner),
  ('Metal Lux R$25 o metro.', 'c1000001-0001-0001-0001-000000000006', NULL, 'Social Media CDM', 'media', 'concluida', 'concluido', '2026-06-15', v_owner),
  ('5 beneficios do ppf carrossel', 'c1000001-0001-0001-0001-000000000004', NULL, 'Social Media CDM', 'media', 'concluida', 'concluido', '2026-06-15', v_owner),
  ('Cuidado Seu carro pode estar perdendo valor.', 'c1000001-0001-0001-0001-000000000004', NULL, 'Social Media CDM', 'media', 'concluida', 'concluido', '2026-06-15', v_owner),
  ('Vídeo Reginaldo Copa', 'c1000001-0001-0001-0001-000000000005', NULL, 'Social Media CDM', 'alta', 'concluida', 'concluido', '2026-06-15', v_owner),
  ('📌Vídeo do cliente (aprovação de legenda)', 'c1000001-0001-0001-0001-000000000003', 'Lunarfilm, R5WF Brasil', 'Social Media CDM', 'alta', 'concluida', 'concluido', '2026-06-15', v_owner),
  ('Jaecoo Diamond HD Plus (aprovação legenda)', 'c1000001-0001-0001-0001-000000000003', 'Lunarfilm, R5WF Brasil', 'Social Media CDM', 'media', 'concluida', 'concluido', '2026-06-15', v_owner),
  ('Se o hexa vai vir eu não sei... Mas posso garantir as melhores películas para o seu carro.', 'c1000001-0001-0001-0001-000000000003', NULL, 'Mariah Caciatore', 'alta', 'concluida', 'concluido', '2026-06-15', v_owner),
  ('Feliz Dia dos Namorados — Celebre o amor nos pequenos cuidados de todos os dias.', 'c1000001-0001-0001-0001-000000000001', NULL, 'Social Media CDM', 'media', 'concluida', 'concluido', '2026-06-14', v_owner),
  ('Wesley distro Doc', 'c1000001-0001-0001-0001-000000000011', 'R5 Paraná, R5 Santa Catarina, Grupo R5, Lunarfilm', 'Juan Canada', 'media', 'concluida', 'concluido', '2026-06-14', v_owner),
  ('Post ok', 'c1000001-0001-0001-0001-000000000012', NULL, NULL, 'media', 'concluida', 'concluido', '2026-06-14', v_owner),

  ('Vídeo Mariah - Notinhas a', 'c1000001-0001-0001-0001-000000000012', 'Grupo R5, R5 Paraná, R5 Santa Catarina, R5 São Paulo, R5 Rio Grande do Sul', 'Mariah Caciatore', 'media', 'em_aprovacao', 'em_progresso', '2026-06-16', v_owner),
  ('Vídeo Amanda', 'c1000001-0001-0001-0001-000000000011', NULL, 'Juan Canada', 'media', 'concluida', 'concluido', '2026-06-16', v_owner),

  ('Vídeo Ben10 - Carros elétricos', 'c1000001-0001-0001-0001-000000000012', 'Grupo R5, R5 São Paulo, R5 Paraná, R5 Rio Grande do Sul, R5 Santa Catarina', 'Juan Canada', 'media', 'pendente', 'a_fazer', '2026-06-17', v_owner),
  ('Ney e Guilherme Olivato', 'c1000001-0001-0001-0001-000000000002', NULL, 'Mariah Caciatore', 'media', 'em_aprovacao', 'em_progresso', '2026-06-17', v_owner),
  ('Vídeo Tera - Antichip', 'c1000001-0001-0001-0001-000000000004', NULL, 'Mariah Caciatore', 'media', 'concluida', 'concluido', '2026-06-17', v_owner),
  ('Falar com os distribuidores e pedir foto/video COPA', NULL, NULL, 'Social Media CDM', 'media', 'concluida', 'concluido', '2026-06-17', v_owner),
  ('GlassKeeper Leandro', 'c1000001-0001-0001-0001-000000000002', NULL, 'Mariah Caciatore', 'media', 'concluida', 'concluido', '2026-06-17', v_owner),
  ('Doc aprovação', 'c1000001-0001-0001-0001-000000000006', NULL, 'Social Media CDM', 'media', 'concluida', 'concluido', '2026-06-17', v_owner),
  ('água (legenda para apro)', 'c1000001-0001-0001-0001-000000000008', 'R5 Rio Grande do Sul, R5 Santa Catarina, R5 São Paulo, R5 Paraná', 'Mariah Caciatore', 'media', 'concluida', 'concluido', '2026-06-17', v_owner),

  ('Jogue no seu nível mais alto.', 'c1000001-0001-0001-0001-000000000001', NULL, 'Social Media CDM', 'media', 'em_progresso', 'em_progresso', '2026-06-18', v_owner),
  ('Saiu a escalação do Time Energia! Disposição para jogar em alto nível do primeiro ao último minuto.', 'c1000001-0001-0001-0001-000000000001', NULL, NULL, 'media', 'pendente', 'a_fazer', '2026-06-18', v_owner),

  ('Víde Ney/Mariah/Regis - HEXA', 'c1000001-0001-0001-0001-000000000012', NULL, 'Juan Canada', 'media', 'pendente', 'a_fazer', '2026-06-19', v_owner),
  ('copa distribuidoras', 'c1000001-0001-0001-0001-000000000009', 'R5 Santa Catarina, R5 São Paulo, R5 Rio Grande do Sul, R5 Paraná', 'Social Media CDM', 'media', 'concluida', 'concluido', '2026-06-19', v_owner),
  ('SUA SAÚDE NA SELEÇÃO DOS CAMPEÕES', 'c1000001-0001-0001-0001-000000000001', NULL, 'Mariah Caciatore', 'media', 'concluida', 'concluido', '2026-06-19', v_owner),
  ('Post de sexta foi colocado no lugar (já apro)', 'c1000001-0001-0001-0001-000000000005', NULL, 'Social Media CDM', 'media', 'concluida', 'concluido', '2026-06-19', v_owner),
  ('video', 'c1000001-0001-0001-0001-000000000005', NULL, 'Social Media CDM', 'media', 'concluida', 'concluido', '2026-06-19', v_owner),
  ('Cada ajuste desnecessário custa tempo.', 'c1000001-0001-0001-0001-000000000005', NULL, 'Social Media CDM', 'media', 'concluida', 'concluido', '2026-06-19', v_owner),
  ('t-cross', 'c1000001-0001-0001-0001-000000000003', NULL, NULL, 'media', 'concluida', 'concluido', '2026-06-19', v_owner),
  ('Vision Black', 'c1000001-0001-0001-0001-000000000002', NULL, 'Mariah Caciatore', 'media', 'concluida', 'concluido', '2026-06-19', v_owner),

  ('Aplicações', 'c1000001-0001-0001-0001-000000000002', NULL, 'Juan Canada', 'media', 'concluida', 'concluido', '2026-06-20', v_owner),
  ('Vision Black - Vídeo', 'c1000001-0001-0001-0001-000000000002', NULL, NULL, 'media', 'pendente', 'a_fazer', '2026-06-20', v_owner),
  ('Foto', 'c1000001-0001-0001-0001-000000000002', NULL, 'Juan Canada', 'media', 'concluida', 'concluido', '2026-06-20', v_owner),
  ('NRI', 'c1000001-0001-0001-0001-000000000002', NULL, NULL, 'media', 'pendente', 'a_fazer', '2026-06-20', v_owner),
  ('Institucional R5WF', 'c1000001-0001-0001-0001-000000000002', NULL, 'Juan Canada', 'media', 'pendente', 'a_fazer', '2026-06-20', v_owner),
  ('Vídeo Chevette Raiz (mariah)', 'c1000001-0001-0001-0001-000000000002', NULL, NULL, 'media', 'pendente', 'a_fazer', '2026-06-20', v_owner);

  UPDATE public.profiles SET full_name = 'CDM Marketing' WHERE email = 'cdm@cdmmkt.com.br';
END $$;

-- Status "Em aprovação" (Calendário de Conteúdos estilo Notion)
ALTER TYPE public.task_status ADD VALUE IF NOT EXISTS 'em_aprovacao';

-- Redes sociais extras para tabela Senhas Clientes
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS tiktok TEXT,
  ADD COLUMN IF NOT EXISTS linktree TEXT,
  ADD COLUMN IF NOT EXISTS area_atuacao TEXT;

COMMENT ON COLUMN public.clients.area_atuacao IS 'Ex: Cliente Final - Película, Lojista, Software';

-- Cor por responsável no calendário de conteúdos
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS color_owner TEXT;

COMMENT ON COLUMN public.tasks.color_owner IS 'juan | mariah | bernardo | ney | boleto';

NOTIFY pgrst, 'reload schema';

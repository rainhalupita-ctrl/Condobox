-- ==============================================================================
-- MIGRATION 006: Garantir índice único para user_id na tabela residents
-- ==============================================================================

-- Remover duplicatas antigas se existirem (mantendo a mais recente)
DELETE FROM public.residents r1
WHERE r1.user_id IS NOT NULL
  AND r1.id NOT IN (
    SELECT DISTINCT ON (user_id) id
    FROM public.residents
    WHERE user_id IS NOT NULL
    ORDER BY user_id, created_at DESC
  );

-- Adicionar constraint UNIQUE para user_id (para permitir upsert)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'residents_user_id_key'
    ) THEN
        ALTER TABLE public.residents ADD CONSTRAINT residents_user_id_key UNIQUE (user_id);
    END IF;
END $$;

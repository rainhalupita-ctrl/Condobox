-- ==============================================================================
-- MIGRATION: TABELA DE LICENÇAS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.licenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condo_id UUID NOT NULL REFERENCES public.condos(id) ON DELETE CASCADE,
    plan VARCHAR(50) NOT NULL DEFAULT 'TRIAL',
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    expires_at TIMESTAMPTZ,
    max_apartments INTEGER NOT NULL DEFAULT 50,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.licenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read of licenses" 
    ON public.licenses 
    FOR SELECT 
    USING (true);

CREATE POLICY "Allow all actions for super admins on licenses" 
    ON public.licenses 
    FOR ALL 
    USING (true);

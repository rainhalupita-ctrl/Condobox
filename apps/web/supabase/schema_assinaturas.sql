-- =================================================================================
-- CONDOBOX - SISTEMA DE ASSINATURAS (SAAS) E ANÚNCIOS
-- Execute este script no SQL Editor do Supabase.
-- =================================================================================

-- 1. TABELA DE LICENÇAS (Assinaturas dos Condomínios)
CREATE TABLE IF NOT EXISTS public.licenses (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  condo_id text NOT NULL,
  plan text NOT NULL CHECK (plan IN ('TRIAL', 'BASIC', 'PRO', 'PRO_MAX')),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'EXPIRED', 'BLOCKED')),
  expires_at timestamptz,
  max_apartments integer NOT NULL DEFAULT 250,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Habilitar RLS e Permissões para Licenças
ALTER TABLE public.licenses ENABLE ROW LEVEL SECURITY;

-- Apenas leitura para usuários logados e morador que quiser acessar o seu plano
CREATE POLICY "Leitura de licenças permitida para autenticados" 
ON public.licenses FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "Modificação de licenças" 
ON public.licenses FOR ALL 
TO authenticated 
USING (true)
WITH CHECK (true);

-- =================================================================================

-- 2. TABELA DE ANÚNCIOS (Apenas para o Plano BASIC)
CREATE TABLE IF NOT EXISTS public.ads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  image_url text NOT NULL,
  link_url text,
  active boolean DEFAULT true,
  views integer DEFAULT 0,
  clicks integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Habilitar RLS e Permissões para Anúncios
ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;

-- Qualquer pessoa (mesmo anônima, acessando a URL pública /p/[token]) pode ver os anúncios
CREATE POLICY "Leitura publica de anuncios" 
ON public.ads FOR SELECT 
USING (active = true);

-- Apenas o administrador (você) poderia inserir anúncios
CREATE POLICY "Inserção de anuncios" 
ON public.ads FOR ALL 
TO authenticated 
USING (true)
WITH CHECK (true);

-- =================================================================================
-- Trigger para atualizar 'updated_at' da licença
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = now(); 
   RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_licenses_modtime
BEFORE UPDATE ON public.licenses
FOR EACH ROW EXECUTE PROCEDURE update_modified_column();

-- =================================================================================
-- CONDOBOX - MÓDULO FINANCEIRO SAAS (MODELO NETFLIX) & GESTÃO DE COMPROVANTES
-- Execute este script no SQL Editor do Supabase se desejar criar as tabelas dedicadas.
-- =================================================================================

-- 1. ADICIONA CAMPOS DE COBRANÇA NA TABELA LICENSES (SE NÃO EXISTIREM)
ALTER TABLE public.licenses ADD COLUMN IF NOT EXISTS monthly_price numeric(10,2) DEFAULT 149.00;
ALTER TABLE public.licenses ADD COLUMN IF NOT EXISTS billing_day integer DEFAULT 10;
ALTER TABLE public.licenses ADD COLUMN IF NOT EXISTS pix_key text;

-- 2. TABELA DE PAGAMENTOS E COMPROVANTES DE ASSINATURA (MENSALIDADES)
CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  condo_id text NOT NULL,
  amount numeric(10,2) NOT NULL DEFAULT 149.00,
  reference_month text NOT NULL, -- Ex: '2026-09'
  status text NOT NULL CHECK (status IN ('PENDING', 'UNDER_REVIEW', 'PAID', 'REJECTED', 'OVERDUE')) DEFAULT 'PENDING',
  due_date timestamptz,
  paid_at timestamptz,
  receipt_url text,
  receipt_filename text,
  sender_notes text,
  reviewer_notes text,
  reviewed_by text,
  reviewed_at timestamptz,
  days_extended integer DEFAULT 30,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_sub_payments_condo_id ON public.subscription_payments(condo_id);
CREATE INDEX IF NOT EXISTS idx_sub_payments_status ON public.subscription_payments(status);
CREATE INDEX IF NOT EXISTS idx_sub_payments_ref_month ON public.subscription_payments(reference_month);

-- 3. HABILITAR ROW LEVEL SECURITY (RLS)
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Leitura de pagamentos permitida para autenticados" 
ON public.subscription_payments FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "Modificação de pagamentos para autenticados" 
ON public.subscription_payments FOR ALL 
TO authenticated 
USING (true)
WITH CHECK (true);

-- 4. TABELA DE CONFIGURAÇÃO DE COBRANÇA GERAL (CHAVE PIX DO SÓCIO PROPRIETÁRIO)
CREATE TABLE IF NOT EXISTS public.saas_billing_settings (
  id text PRIMARY KEY DEFAULT 'default',
  pix_key text NOT NULL DEFAULT '73998419901',
  pix_key_type text DEFAULT 'PHONE', -- 'PHONE', 'CNPJ', 'EMAIL', 'RANDOM'
  beneficiary_name text DEFAULT 'CondoBox Tecnologia e Solucoes',
  bank_name text DEFAULT 'Banco Inter / Nubank',
  instructions text DEFAULT 'Ao realizar o Pix, anexe o comprovante no CondoBox para analise e liberacao imediata da sua conta.',
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.saas_billing_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Leitura de config de cobranca publica" 
ON public.saas_billing_settings FOR SELECT 
USING (true);

CREATE POLICY "Modificacao de config de cobranca" 
ON public.saas_billing_settings FOR ALL 
TO authenticated 
USING (true);

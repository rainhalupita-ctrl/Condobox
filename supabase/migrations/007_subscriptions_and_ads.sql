-- ==============================================================================
-- MIGRATION: SISTEMA DE ASSINATURAS, PLANOS E ANÚNCIOS (SaaS LICENSING & ADS)
-- ==============================================================================

-- 1. Tabela de Planos
CREATE TABLE IF NOT EXISTS public.subscription_plans (
    id TEXT PRIMARY KEY, -- 'TRIAL', 'BASIC', 'PRO', 'PRO_MAX'
    name VARCHAR(100) NOT NULL,
    max_units INTEGER NOT NULL,
    has_ads BOOLEAN NOT NULL DEFAULT FALSE,
    default_price_monthly NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabela de Assinaturas por Condomínio
CREATE TABLE IF NOT EXISTS public.condo_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condo_id UUID NOT NULL REFERENCES public.condos(id) ON DELETE CASCADE,
    plan_id TEXT NOT NULL REFERENCES public.subscription_plans(id),
    status VARCHAR(50) NOT NULL DEFAULT 'TRIAL', -- 'TRIAL', 'ACTIVE', 'EXPIRED', 'SUSPENDED'
    custom_price_monthly NUMERIC(10,2),
    trial_starts_at TIMESTAMPTZ DEFAULT NOW(),
    trial_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
    current_period_starts_at TIMESTAMPTZ DEFAULT NOW(),
    current_period_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
    license_key TEXT UNIQUE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_condo_subscription UNIQUE (condo_id)
);

-- 3. Tabela de Anúncios e Propagandas (Ads) para o Plano BASIC
CREATE TABLE IF NOT EXISTS public.ads_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    banner_url TEXT,
    cta_text VARCHAR(100) DEFAULT 'Saiba Mais',
    cta_url TEXT, -- Link para WhatsApp, iFood ou site
    whatsapp_footer_text TEXT,
    active BOOLEAN DEFAULT TRUE,
    priority INTEGER DEFAULT 1,
    views_count INTEGER DEFAULT 0,
    clicks_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Inserir Planos Padrão
INSERT INTO public.subscription_plans (id, name, max_units, has_ads, default_price_monthly, description)
VALUES 
  ('TRIAL', 'Teste Grátis 30 Dias', 250, FALSE, 0.00, 'Período experimental completo de 30 dias para novas portarias'),
  ('BASIC', 'Plano Basic (Com Ads)', 250, TRUE, 149.00, 'Até 250 apartamentos com publicidade da portaria nos links e mensagens'),
  ('PRO', 'Plano Pro (Sem Ads)', 250, FALSE, 249.00, 'Até 250 apartamentos 100% exclusivo sem anúncios'),
  ('PRO_MAX', 'Plano Pro Max', 600, FALSE, 449.00, 'Até 600 apartamentos para grandes condomínios sem anúncios')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  max_units = EXCLUDED.max_units,
  has_ads = EXCLUDED.has_ads,
  default_price_monthly = EXCLUDED.default_price_monthly,
  description = EXCLUDED.description;

-- 5. Inserir Anúncio Exemplo
INSERT INTO public.ads_campaigns (title, description, cta_text, cta_url, whatsapp_footer_text, active, priority)
VALUES (
  'Pizzaria & Delivery do Bairro',
  'Moradores do condomínio ganham 10% de desconto na primeira pizza com o cupom CONDO10!',
  'Pedir no WhatsApp',
  'https://wa.me/5511999999999?text=Ol%C3%A1%2C+sou+morador+do+condom%C3%ADnio+e+quero+meu+desconto',
  '🍕 *Pizzaria do Bairro:* 10% OFF para moradores! Peça agora: wa.me/5511999999999',
  TRUE,
  10
)
ON CONFLICT DO NOTHING;

# Especificação Técnica: Sistema de Assinaturas, Planos e Gestão de Anúncios (SaaS Licensing & Ads Engine)

## 1. Visão Geral
Implementar um sistema completo de licenciamento por assinatura, monetização por anúncios (para planos de entrada) e painel administrativo Master (Super Admin) para controle de preços, faturamento, ativação de licenças e veiculação de propagandas.

---

## 2. Estrutura dos 4 Planos

| Plano | Limite de Unidades (Aptos) | Propaganda (Ads) | Trial / Período | Preço Base (Configurável no Painel) |
| :--- | :--- | :--- | :--- | :--- |
| **TRIAL (Teste Grátis)** | Até 250 Aps | Sem Ads | 30 Dias corridos | **R$ 0,00** (Automático na instalação) |
| **BASIC** | Até 250 Aps | **COM ADS** (WhatsApp + Página do QR Code) | Mensal / Anual | **R$ 149,00 / mês** (ou definido por você) |
| **PRO** | Até 250 Aps | **SEM ADS** (100% White-label) | Mensal / Anual | **R$ 249,00 / mês** (ou definido por você) |
| **PRO MAX** | Até 600 Aps | **SEM ADS** (Alta capacidade) | Mensal / Anual | **R$ 449,00 / mês** (ou definido por você) |

---

## 3. Regras de Negócio e Validações

### A. Limite de Apartamentos / Unidades
* Ao tentar cadastrar uma nova unidade (ou importar via Excel/CSV):
  * **TRIAL / BASIC / PRO:** Limite de 250 unidades. Se atingir 250, o botão de novo cadastro bloqueia e sugere o upgrade para o **PRO MAX**.
  * **PRO MAX:** Limite de 600 unidades.

### B. Motor de Anúncios (Ads Engine para o Plano BASIC)
* Quando o condomínio estiver no plano **BASIC**, toda notificação gerada conterá publicidade controlada por você:
  1. **No WhatsApp:** Um rodapé patrocinado com texto persuasivo e link/WhatsApp do anunciante (ex: *"🍕 Pizzaria do Bairro: 10% OFF para moradores com o cupom CONDO10 -> wa.me/..."*).
  2. **Na Página de Retirada do Morador (`/p/[token]`):** Um card visual com banner, título, descrição e botão de chamada para ação (CTA) posicionado logo abaixo do QR Code.
* No plano **PRO** e **PRO MAX**, o bloco de anúncios é completamente removido.

### C. Gatekeeper de Licença (Bloqueio por Inadimplência / Expiração)
* O sistema verifica localmente e remotamente a validade da assinatura:
  * `status: 'ACTIVE'`: Operação normal.
  * `status: 'TRIAL'`: Válido por 30 dias a partir da criação do condomínio.
  * `status: 'EXPIRED' | 'SUSPENDED'`: A portaria é bloqueada e exibe uma tela amigável com QR Code do Pix / Contato do Administrador para reativação imediata via Chave de Licença (License Key).

---

## 4. Estrutura de Banco de Dados (Schema Supabase + SQLite)

```sql
-- 1. Tabela de Planos e Preços
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
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Tabela de Anúncios e Propagandas (Ads)
CREATE TABLE IF NOT EXISTS public.ads_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    banner_url TEXT,
    cta_text VARCHAR(100) DEFAULT 'Saiba Mais',
    cta_url TEXT, -- Link para site, iFood ou WhatsApp
    whatsapp_footer_text TEXT,
    active BOOLEAN DEFAULT TRUE,
    priority INTEGER DEFAULT 1,
    views_count INTEGER DEFAULT 0,
    clicks_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 5. Painel Master Super Admin (`/admin/licenciamento` & `/admin/anuncios`)

Um módulo exclusivo para você gerenciar todo o ecossistema comercial:
1. **Visão Geral Financeira**: Faturamento mensal estimado (MRR), total de condomínios ativos, em teste e expirados.
2. **Gestão de Condomínios**: Tabela com troca de plano em 1 clique, alteração de preço customizado, prorrogação de dias e emissão de License Key.
3. **Gestor de Propagandas (Ads Manager)**: Cadastro de banners de parceiros, definição de textos do WhatsApp, contadores de visualizações e cliques.
4. **Gerador de Chave de Ativação Offline**: Chave criptografada para desbloquear a portaria no computador do cliente mesmo sem internet.

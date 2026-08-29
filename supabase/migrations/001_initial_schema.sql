-- ==============================================================================
-- SCHEMA SUPABASE: GESTÃO DE ENCOMENDAS PARA CONDOMÍNIOS
-- ==============================================================================

-- 1. Habilitar extensões necessárias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Enums
CREATE TYPE package_status AS ENUM ('RECEIVED', 'NOTIFIED', 'DELIVERED', 'RETURNED');
CREATE TYPE notification_status AS ENUM ('PENDING', 'SENT', 'FAILED', 'DELIVERED');
CREATE TYPE user_role AS ENUM ('ADMIN', 'SYNDIC', 'GUARD', 'RESIDENT');

-- 3. Tabela de Condomínios (Suporte Multi-condomínio opcional)
CREATE TABLE IF NOT EXISTS public.condos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    address TEXT,
    phone VARCHAR(50),
    photo_retention_days INTEGER DEFAULT 90,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Tabela de Unidades (Apartamentos / Blocos)
CREATE TABLE IF NOT EXISTS public.units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condo_id UUID REFERENCES public.condos(id) ON DELETE CASCADE,
    block VARCHAR(50) NOT NULL, -- Ex: Bloco A, Torre 1, Bloco Único
    unit_number VARCHAR(50) NOT NULL, -- Ex: 101, 102, Cobertura 01
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_condo_block_unit UNIQUE (condo_id, block, unit_number)
);

-- 5. Tabela de Perfis de Usuário (Integrado ao Supabase Auth)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    condo_id UUID REFERENCES public.condos(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    role user_role DEFAULT 'RESIDENT',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Tabela de Moradores
CREATE TABLE IF NOT EXISTS public.residents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL, -- Telefone com DDD para WhatsApp (ex: 5511999999999)
    email VARCHAR(255),
    is_authorized_receiver BOOLEAN DEFAULT TRUE,
    is_primary BOOLEAN DEFAULT FALSE,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Tabela de Encomendas
CREATE TABLE IF NOT EXISTS public.packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condo_id UUID REFERENCES public.condos(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
    resident_id UUID REFERENCES public.residents(id) ON DELETE SET NULL,
    
    -- Dados da Encomenda
    carrier VARCHAR(100) DEFAULT 'Outro', -- Correios, Mercado Livre, Shopee, Amazon, etc.
    tracking_code VARCHAR(150),
    recipient_name_ocr VARCHAR(255),
    status package_status DEFAULT 'RECEIVED',
    
    -- Código de Retirada (4 a 6 dígitos para o morador digitar ou QR Code)
    pickup_code VARCHAR(10) NOT NULL,
    qr_token VARCHAR(100) NOT NULL UNIQUE,
    
    -- Caminhos de Armazenamento Local (PC da Portaria)
    label_image_path VARCHAR(255), -- Ex: labels/2026-08/uuid.jpg
    signature_image_path VARCHAR(255), -- Ex: signatures/2026-08/uuid.png
    
    -- Histórico de Recebimento
    received_at TIMESTAMPTZ DEFAULT NOW(),
    received_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    
    -- Histórico de Entrega / Retirada
    delivered_at TIMESTAMPTZ,
    delivered_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    delivered_to_name VARCHAR(255),
    
    -- Observações
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Tabela de Logs de Notificação WhatsApp
CREATE TABLE IF NOT EXISTS public.notifications_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id UUID NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
    resident_id UUID REFERENCES public.residents(id) ON DELETE SET NULL,
    channel VARCHAR(50) DEFAULT 'WHATSAPP',
    recipient_phone VARCHAR(50) NOT NULL,
    message_content TEXT NOT NULL,
    status notification_status DEFAULT 'PENDING',
    external_message_id VARCHAR(255),
    error_message TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Tabela de Auditoria e Segurança
CREATE TABLE IF NOT EXISTS public.security_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID,
    details JSONB,
    ip_address VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- ÍNDICES PARA PERFORMANCE
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_packages_unit_id ON public.packages(unit_id);
CREATE INDEX IF NOT EXISTS idx_packages_status ON public.packages(status);
CREATE INDEX IF NOT EXISTS idx_packages_pickup_code ON public.packages(pickup_code);
CREATE INDEX IF NOT EXISTS idx_packages_qr_token ON public.packages(qr_token);
CREATE INDEX IF NOT EXISTS idx_packages_received_at ON public.packages(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_residents_unit_id ON public.residents(unit_id);
CREATE INDEX IF NOT EXISTS idx_residents_phone ON public.residents(phone);
CREATE INDEX IF NOT EXISTS idx_units_block_number ON public.units(block, unit_number);

-- ==============================================================================
-- FUNÇÕES E TRIGGERS
-- ==============================================================================

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER trg_units_updated_at BEFORE UPDATE ON public.units FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER trg_residents_updated_at BEFORE UPDATE ON public.residents FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER trg_packages_updated_at BEFORE UPDATE ON public.packages FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ==============================================================================
-- HABILITAR REALTIME DO SUPABASE NAS TABELAS PRINCIPAIS
-- ==============================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.packages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications_log;

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================
ALTER TABLE public.condos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.residents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_audit_logs ENABLE ROW LEVEL SECURITY;

-- 1. Profiles
CREATE POLICY "Users can view their own profile" ON public.profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Guards and Admins can view all profiles in condo" ON public.profiles
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role IN ('ADMIN', 'SYNDIC', 'GUARD')
        )
    );

-- 2. Units
CREATE POLICY "Authenticated users can view units" ON public.units
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage units" ON public.units
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role IN ('ADMIN', 'SYNDIC')
        )
    );

-- 3. Residents
CREATE POLICY "Residents can view members in their own unit" ON public.residents
    FOR SELECT TO authenticated USING (
        user_id = auth.uid() OR
        EXISTS (
            SELECT 1 FROM public.residents r 
            WHERE r.user_id = auth.uid() AND r.unit_id = residents.unit_id
        ) OR
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role IN ('ADMIN', 'SYNDIC', 'GUARD')
        )
    );

CREATE POLICY "Admins and Guards can manage residents" ON public.residents
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role IN ('ADMIN', 'SYNDIC', 'GUARD')
        )
    );

-- 4. Packages
CREATE POLICY "Residents can view packages for their unit" ON public.packages
    FOR SELECT TO authenticated USING (
        EXISTS (
            SELECT 1 FROM public.residents r
            WHERE r.user_id = auth.uid() AND r.unit_id = packages.unit_id
        ) OR
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role IN ('ADMIN', 'SYNDIC', 'GUARD')
        )
    );

CREATE POLICY "Guards and Admins can insert and update packages" ON public.packages
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role IN ('ADMIN', 'SYNDIC', 'GUARD')
        )
    );

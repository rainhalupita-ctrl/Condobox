-- ==============================================================================
-- DADOS INICIAIS DE TESTE (SEED)
-- ==============================================================================

-- 1. Inserir Condomínio
INSERT INTO public.condos (id, name, address, phone, photo_retention_days)
VALUES (
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'Residencial Jardim das Flores',
    'Av. Principal, 1500 - São Paulo, SP',
    '5511988887777',
    90
) ON CONFLICT (id) DO NOTHING;

-- 2. Inserir Unidades (Bloco A e Bloco B)
INSERT INTO public.units (id, condo_id, block, unit_number) VALUES
    ('b1eebc99-9c0b-4ef8-bb6d-6bb9bd380001', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Bloco A', '101'),
    ('b1eebc99-9c0b-4ef8-bb6d-6bb9bd380002', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Bloco A', '102'),
    ('b1eebc99-9c0b-4ef8-bb6d-6bb9bd380003', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Bloco A', '201'),
    ('b1eebc99-9c0b-4ef8-bb6d-6bb9bd380004', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Bloco A', '202'),
    ('b1eebc99-9c0b-4ef8-bb6d-6bb9bd380005', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Bloco B', '101'),
    ('b1eebc99-9c0b-4ef8-bb6d-6bb9bd380006', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Bloco B', '102'),
    ('b1eebc99-9c0b-4ef8-bb6d-6bb9bd380007', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Bloco B', '201'),
    ('b1eebc99-9c0b-4ef8-bb6d-6bb9bd380008', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Bloco B', '202')
ON CONFLICT (condo_id, block, unit_number) DO NOTHING;

-- 3. Inserir Moradores de Exemplo
INSERT INTO public.residents (id, unit_id, name, phone, email, is_authorized_receiver, is_primary) VALUES
    ('c1eebc99-9c0b-4ef8-bb6d-6bb9bd380101', 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380001', 'Carlos Silva', '5511999990001', 'carlos.silva@email.com', true, true),
    ('c1eebc99-9c0b-4ef8-bb6d-6bb9bd380102', 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380001', 'Mariana Silva', '5511999990002', 'mariana.silva@email.com', true, false),
    ('c1eebc99-9c0b-4ef8-bb6d-6bb9bd380103', 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380002', 'Roberto Oliveira', '5511999990003', 'roberto@email.com', true, true),
    ('c1eebc99-9c0b-4ef8-bb6d-6bb9bd380104', 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380005', 'Fernanda Souza', '5511999990004', 'fernanda.souza@email.com', true, true),
    ('c1eebc99-9c0b-4ef8-bb6d-6bb9bd380105', 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380006', 'Lucas Pereira', '5511999990005', 'lucas@email.com', true, true)
ON CONFLICT (id) DO NOTHING;

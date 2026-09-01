-- Migration: Criar tabelas de fila (queue/buffer) para o CondoBox
-- O Supabase atua como broker temporário: o local-api consome e deleta os registros

-- ─────────────────────────────────────────────────────────────────────────────
-- TABELA: fila_encomendas
-- Publicado por: apps/web (porteiro mobile)
-- Consumido por: apps/local-api via Supabase Realtime
-- Ciclo de vida: INSERT → [Realtime trigger] → local-api processa → DELETE
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fila_encomendas (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  condo_id      UUID,
  unit_id       UUID        NOT NULL,
  resident_id   UUID,
  carrier       TEXT        NOT NULL DEFAULT 'Transportadora',
  tracking_code TEXT,
  recipient_name_ocr TEXT,
  label_image_path   TEXT,
  phone              TEXT,
  send_whatsapp      BOOLEAN     NOT NULL DEFAULT true,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice para facilitar queries por data (consumo ordenado)
CREATE INDEX IF NOT EXISTS idx_fila_encomendas_created_at ON fila_encomendas (created_at ASC);

-- RLS: porteiros anônimos podem inserir; service_role pode tudo (para o local-api deletar)
ALTER TABLE fila_encomendas ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "fila_encomendas_insert_anon"
  ON fila_encomendas
  FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "fila_encomendas_insert_authenticated"
  ON fila_encomendas
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "fila_encomendas_service_all"
  ON fila_encomendas
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABELA: fila_mensagens
-- Para disparos de WhatsApp avulsos (não vinculados a encomendas específicas)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fila_mensagens (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID,
  phone      TEXT        NOT NULL,
  message    TEXT        NOT NULL,
  tipo       TEXT        NOT NULL DEFAULT 'CHEGADA'
              CHECK (tipo IN ('CHEGADA', 'RETIRADA', 'AVISO', 'TESTE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fila_mensagens_created_at ON fila_mensagens (created_at ASC);

ALTER TABLE fila_mensagens ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "fila_mensagens_insert_anon"
  ON fila_mensagens
  FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "fila_mensagens_insert_authenticated"
  ON fila_mensagens
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "fila_mensagens_service_all"
  ON fila_mensagens
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- Habilitar Realtime nas tabelas de fila para o local-api escutar via WebSocket
-- ─────────────────────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE fila_encomendas;
ALTER PUBLICATION supabase_realtime ADD TABLE fila_mensagens;

// Script para aplicar migration das tabelas de fila no Supabase do CondoBox
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://isurnvsehvjdslpnxirn.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzdXJudnNlaHZqZHNscG54aXJuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODAzNjM4NCwiZXhwIjoyMTAzNjEyMzg0fQ.2PO_jbeh-rpMmLFbN17aHbJwxHaQr8aeWi6A2hkg708';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function applyMigration() {
  console.log('Aplicando migration de tabelas de fila no Supabase CondoBox...');

  // Criação da tabela fila_encomendas
  const { error: e1 } = await supabase.rpc('exec_sql', {
    query: `
      CREATE TABLE IF NOT EXISTS fila_encomendas (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        condo_id UUID,
        unit_id UUID NOT NULL,
        resident_id UUID,
        carrier TEXT NOT NULL DEFAULT 'Transportadora',
        tracking_code TEXT,
        recipient_name_ocr TEXT,
        label_image_path TEXT,
        phone TEXT,
        send_whatsapp BOOLEAN NOT NULL DEFAULT true,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `
  });
  if (e1) console.error('Erro fila_encomendas:', e1.message);
  else console.log('✅ Tabela fila_encomendas criada ou já existe');

  // Test insert to confirm access
  const { error: insertErr } = await supabase
    .from('fila_encomendas')
    .select('id')
    .limit(1);

  if (insertErr?.code === '42P01') {
    console.log('⚠️ Tabela não existe ainda — use o Dashboard SQL Editor do Supabase');
    console.log('URL:', `${SUPABASE_URL.replace('.co', '.co/project/isurnvsehvjdslpnxirn/sql')}`);
  } else {
    console.log('✅ Tabela fila_encomendas acessível!', insertErr || 'OK');
  }

  const { error: e2 } = await supabase
    .from('fila_mensagens')
    .select('id')
    .limit(1);

  if (e2?.code === '42P01') {
    console.log('⚠️ Tabela fila_mensagens não existe ainda');
  } else {
    console.log('✅ Tabela fila_mensagens acessível!', e2 || 'OK');
  }
}

applyMigration().catch(console.error);

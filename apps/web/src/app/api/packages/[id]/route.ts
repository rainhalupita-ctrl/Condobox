import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://isurnvsehvjdslpnxirn.supabase.co';
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzdXJudnNlaHZqZHNscG54aXJuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODAzNjM4NCwiZXhwIjoyMTAzNjEyMzg0fQ.2PO_jbeh-rpMmLFbN17aHbJwxHaQr8aeWi6A2hkg708';
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

/**
 * DELETE /api/packages/[id]
 * Exclui definitivamente uma encomenda (Ação exclusiva de Síndico/Admin)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    if (!id) {
      return NextResponse.json({ error: 'ID da encomenda obrigatório.' }, { status: 400 });
    }

    // 1. Tenta replicar a exclusão na API local (se estiver em execução)
    const localApiUrl = process.env.NEXT_PUBLIC_LOCAL_API_URL || 'http://localhost:3001';
    try {
      await fetch(`${localApiUrl.replace(/\/$/, '')}/api/packages/${id}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(2500)
      });
    } catch {}

    // 2. Exclui no Supabase (as notificações em notifications_log sofrem cascade)
    const supabase = getSupabaseClient();
    const { error: dbErr } = await supabase
      .from('packages')
      .delete()
      .eq('id', id);

    if (dbErr) {
      return NextResponse.json({ error: 'Erro ao excluir no banco de dados', details: dbErr.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Encomenda excluída definitivamente com sucesso.'
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'Falha interna ao excluir encomenda', details: err.message }, { status: 500 });
  }
}

/**
 * PATCH /api/packages/[id]
 * Atualiza status da encomenda (ex: 'RETURNED' para devolução ao entregador)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const body = await request.json().catch(() => ({}));
    const { status = 'RETURNED', reason, notes } = body;

    if (!id) {
      return NextResponse.json({ error: 'ID da encomenda obrigatório.' }, { status: 400 });
    }

    const noteText = notes || (reason ? `[DEVOLVIDA AO ENTREGADOR]: ${reason}` : '[DEVOLVIDA AO ENTREGADOR]');

    // 1. Tenta replicar na API local
    const localApiUrl = process.env.NEXT_PUBLIC_LOCAL_API_URL || 'http://localhost:3001';
    try {
      await fetch(`${localApiUrl.replace(/\/$/, '')}/api/packages/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, reason }),
        signal: AbortSignal.timeout(2500)
      });
    } catch {}

    // 2. Atualiza no Supabase
    const supabase = getSupabaseClient();
    const { error: dbErr } = await supabase
      .from('packages')
      .update({
        status,
        notes: noteText
      })
      .eq('id', id);

    if (dbErr) {
      return NextResponse.json({ error: 'Erro ao atualizar encomenda no banco', details: dbErr.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: status === 'RETURNED' ? 'Encomenda marcada como devolvida ao entregador com sucesso.' : 'Encomenda atualizada com sucesso.'
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'Falha interna ao atualizar encomenda', details: err.message }, { status: 500 });
  }
}

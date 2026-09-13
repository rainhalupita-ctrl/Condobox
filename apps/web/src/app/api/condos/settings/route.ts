import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://isurnvsehvjdslpnxirn.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const condoId = searchParams.get('condo_id');

    if (!condoId) {
      return NextResponse.json(
        { success: false, error: 'condo_id é obrigatório.' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from('security_audit_logs')
      .select('details')
      .eq('action', 'setting_stale_days_threshold')
      .eq('entity_id', condoId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn('[api/condos/settings] Erro ao buscar configuração:', error.message);
      return NextResponse.json({ success: true, stale_days_threshold: 5 });
    }

    const savedVal = data?.details?.stale_days_threshold;
    const threshold = typeof savedVal === 'number' && savedVal > 0 ? savedVal : 5;

    return NextResponse.json({
      success: true,
      condo_id: condoId,
      stale_days_threshold: threshold,
    });
  } catch (err: any) {
    console.error('[api/condos/settings] Exceção no GET:', err.message);
    return NextResponse.json({ success: true, stale_days_threshold: 5 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { condo_id, stale_days_threshold } = body;

    if (!condo_id) {
      return NextResponse.json(
        { success: false, error: 'condo_id é obrigatório.' },
        { status: 400 }
      );
    }

    const numVal = parseInt(stale_days_threshold, 10);
    const cleanThreshold = !isNaN(numVal) ? Math.max(1, Math.min(60, numVal)) : 5;

    const supabaseAdmin = getSupabaseAdmin();

    // Remove registros antigos do mesmo condomínio para não acumular linhas desnecessárias
    await supabaseAdmin
      .from('security_audit_logs')
      .delete()
      .eq('action', 'setting_stale_days_threshold')
      .eq('entity_id', condo_id);

    // Insere a nova configuração
    const { error: insertErr } = await supabaseAdmin
      .from('security_audit_logs')
      .insert({
        action: 'setting_stale_days_threshold',
        entity_type: 'condo',
        entity_id: condo_id,
        details: { stale_days_threshold: cleanThreshold },
      });

    if (insertErr) {
      console.error('[api/condos/settings] Erro ao gravar configuração:', insertErr.message);
      return NextResponse.json(
        { success: false, error: insertErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      condo_id,
      stale_days_threshold: cleanThreshold,
    });
  } catch (err: any) {
    console.error('[api/condos/settings] Exceção no POST:', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

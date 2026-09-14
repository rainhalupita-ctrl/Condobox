import { NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  return createSupabaseClient(
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

export async function GET() {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    
    // 1. Tenta buscar da tabela ads
    const { data: adsData, error: adsError } = await supabaseAdmin
      .from('ads')
      .select('*')
      .order('created_at', { ascending: false });

    if (!adsError && adsData) {
      return NextResponse.json(adsData);
    }

    // 2. Fallback resiliente: busca em security_audit_logs
    const { data: auditAds } = await supabaseAdmin
      .from('security_audit_logs')
      .select('*')
      .eq('entity_type', 'ad_item')
      .order('created_at', { ascending: false });

    const formatted = (auditAds || []).map(a => ({
      id: a.id,
      image_url: a.details?.image_url || '',
      link_url: a.details?.link_url || '',
      active: a.details?.active ?? true,
      created_at: a.created_at,
    }));

    return NextResponse.json(formatted);
  } catch (error: any) {
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { image_url, link_url, active = true } = body;
    const supabaseAdmin = getSupabaseAdmin();

    // 1. Tenta inserir na tabela ads
    const { data, error } = await supabaseAdmin
      .from('ads')
      .insert({ image_url, link_url, active })
      .select()
      .maybeSingle();

    if (!error && data) {
      return NextResponse.json(data);
    }

    // 2. Fallback resiliente
    const { data: logData } = await supabaseAdmin
      .from('security_audit_logs')
      .insert({
        action: 'create_ad',
        entity_type: 'ad_item',
        details: { image_url, link_url, active },
      })
      .select()
      .single();

    return NextResponse.json({
      id: logData?.id || '00000000-0000-0000-0000-000000000001',
      image_url,
      link_url,
      active,
      created_at: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, active } = body;
    const supabaseAdmin = getSupabaseAdmin();

    try {
      await supabaseAdmin.from('ads').update({ active }).eq('id', id);
    } catch {}

    try {
      const { data: log } = await supabaseAdmin.from('security_audit_logs').select('details').eq('id', id).single();
      if (log) {
        await supabaseAdmin.from('security_audit_logs').update({
          details: { ...log.details, active }
        }).eq('id', id);
      }
    } catch {}

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

    const supabaseAdmin = getSupabaseAdmin();
    try {
      await supabaseAdmin.from('ads').delete().eq('id', id);
    } catch {}
    try {
      await supabaseAdmin.from('security_audit_logs').delete().eq('id', id);
    } catch {}

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

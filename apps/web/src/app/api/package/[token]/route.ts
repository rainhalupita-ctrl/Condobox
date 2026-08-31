import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  const token = params.token;
  if (!token) {
    return NextResponse.json({ error: 'Token não fornecido' }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false }
  });

  try {
    // 1. Busca por qr_token, id (uuid) ou pickup_code
    let query = supabase
      .from('packages')
      .select('*, unit:units(block, unit_number), resident:residents(name, phone)');

    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);
    if (isUUID) {
      query = query.eq('id', token);
    } else {
      query = query.or(`qr_token.eq.${token},pickup_code.eq.${token}`);
    }

    const { data: pkg, error } = await query.limit(1).maybeSingle();

    if (error || !pkg) {
      return NextResponse.json(
        { error: 'Encomenda não encontrada ou código inválido.' },
        { status: 404 }
      );
    }

    // 2. Busca anúncio patrocinado ativo caso o condomínio esteja no Plano BASIC (ou houver anúncio ativo)
    let activeAd = null;
    try {
      const { data: sub } = await supabase
        .from('condo_subscriptions')
        .select('plan_id, status, plan:subscription_plans(has_ads)')
        .eq('condo_id', pkg.condo_id)
        .maybeSingle();

      const shouldShowAds = !sub || sub.plan_id === 'BASIC' || (sub.plan as any)?.has_ads === true;

      if (shouldShowAds) {
        const { data: ads } = await supabase
          .from('ads_campaigns')
          .select('*')
          .eq('active', true)
          .order('priority', { ascending: false })
          .limit(3);

        if (ads && ads.length > 0) {
          activeAd = ads[Math.floor(Math.random() * ads.length)];
          // Incrementa visualização
          supabase
            .from('ads_campaigns')
            .update({ views_count: (activeAd.views_count || 0) + 1 })
            .eq('id', activeAd.id)
            .then(() => {});
        }
      }
    } catch {}

    return NextResponse.json({
      package: {
        id: pkg.id,
        condo_id: pkg.condo_id,
        pickup_code: pkg.pickup_code,
        qr_token: pkg.qr_token,
        carrier: pkg.carrier,
        tracking_code: pkg.tracking_code,
        recipient_name: pkg.resident?.name || pkg.recipient_name_ocr || 'Morador',
        status: pkg.status,
        received_at: pkg.received_at,
        delivered_at: pkg.delivered_at,
        delivered_to_name: pkg.delivered_to_name,
        label_image_path: pkg.label_image_path,
        signature_image_path: pkg.signature_image_path,
        notes: pkg.notes,
        unit: pkg.unit ? {
          block: pkg.unit.block,
          unit_number: pkg.unit.unit_number
        } : null
      },
      ad: activeAd
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Erro interno ao consultar encomenda', details: err.message },
      { status: 500 }
    );
  }
}

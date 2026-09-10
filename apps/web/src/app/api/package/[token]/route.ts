import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  const rawToken = params.token;
  if (!rawToken) {
    return NextResponse.json({ error: 'Token não fornecido' }, { status: 400 });
  }

  const token = decodeURIComponent(rawToken).trim();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://isurnvsehvjdslpnxirn.supabase.co';
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzdXJudnNlaHZqZHNscG54aXJuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODAzNjM4NCwiZXhwIjoyMTAzNjEyMzg0fQ.2PO_jbeh-rpMmLFbN17aHbJwxHaQr8aeWi6A2hkg708';

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false }
  });

  try {
    // 1. Busca por qr_token, id (uuid) ou pickup_code
    let query = supabase
      .from('packages')
      .select('*, unit:units(block, unit_number), resident:residents(name, phone), condo:condos(phone)');

    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);
    if (isUUID) {
      query = query.eq('id', token);
    } else {
      query = query.or(`qr_token.eq.${token},pickup_code.ilike.${token},qr_token.ilike.${token},pickup_code.eq.${token}`);
    }

    let { data: pkg, error } = await query.limit(1).maybeSingle();

    // Fallback: se não encontrou com joins, busca direto na tabela packages
    if (!pkg) {
      let fallbackQuery = supabase.from('packages').select('*');
      if (isUUID) {
        fallbackQuery = fallbackQuery.eq('id', token);
      } else {
        fallbackQuery = fallbackQuery.or(`qr_token.eq.${token},pickup_code.ilike.${token},qr_token.ilike.${token},pickup_code.eq.${token}`);
      }
      const fallbackRes = await fallbackQuery.limit(1).maybeSingle();
      if (fallbackRes.data) {
        pkg = fallbackRes.data;
        if (pkg.unit_id) {
          const { data: u } = await supabase.from('units').select('block, unit_number').eq('id', pkg.unit_id).maybeSingle();
          if (u) pkg.unit = u;
        }
        if (pkg.resident_id) {
          const { data: r } = await supabase.from('residents').select('name, phone').eq('id', pkg.resident_id).maybeSingle();
          if (r) pkg.resident = r;
        }
        if (pkg.condo_id) {
          const { data: c } = await supabase.from('condos').select('phone').eq('id', pkg.condo_id).maybeSingle();
          if (c) pkg.condo = c;
        }
      }
    }

    if (!pkg) {
      return NextResponse.json(
        { error: 'Encomenda não encontrada ou código inválido.' },
        { status: 404 }
      );
    }

    // 2. Busca anúncio patrocinado ativo caso o condomínio esteja no Plano BASIC (ou não tiver plano)
    let activeAd = null;
    try {
      const { data: sub } = await supabase
        .from('licenses')
        .select('plan, status')
        .eq('condo_id', pkg.condo_id)
        .maybeSingle();

      const shouldShowAds = !sub || sub.plan === 'BASIC';

      if (shouldShowAds) {
        const { data: adsList } = await supabase
          .from('ads')
          .select('*')
          .eq('active', true)
          .limit(10);

        if (adsList && adsList.length > 0) {
          activeAd = adsList[Math.floor(Math.random() * adsList.length)];
          // Incrementa visualização
          supabase
            .from('ads')
            .update({ views: (activeAd.views || 0) + 1 })
            .eq('id', activeAd.id)
            .then(() => {});
          
          // Mapeia para o frontend existente
          activeAd = {
            id: activeAd.id,
            title: 'Oferta Especial',
            description: 'Aproveite essa promoção de parceiros locais do seu condomínio.',
            banner_url: activeAd.image_url,
            cta_url: activeAd.link_url,
            cta_text: 'Saber Mais'
          };
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
        } : null,
        condo_phone: pkg.condo?.phone || null
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

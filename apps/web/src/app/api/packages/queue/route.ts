import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

/**
 * POST /api/packages/queue
 * 
 * Rota de publicação na fila do Supabase.
 * Usada pelo PWA mobile quando a API local (localhost:3001) não está acessível.
 * O local-api consome via Realtime, processa no SQLite e dispara o WhatsApp.
 * 
 * O Supabase é um broker temporário — o local-api deleta o registro após processar.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { unitId, residentId, carrier, trackingCode, recipientNameOcr,
            labelImagePath, phone, sendWhatsApp, notes } = body;

    if (!unitId) {
      return NextResponse.json(
        { success: false, error: 'unitId é obrigatório' },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { success: false, error: 'Configuração Supabase ausente' },
        { status: 503 }
      );
    }

    // Usa a service role key no servidor para ter permissão de insert sem RLS
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false }
    });

    const payload = {
      unit_id: unitId,
      resident_id: residentId || null,
      carrier: carrier || 'Transportadora',
      tracking_code: trackingCode || null,
      recipient_name_ocr: recipientNameOcr || null,
      label_image_path: labelImagePath || null,
      phone: phone || null,
      send_whatsapp: sendWhatsApp !== false,
      notes: notes || null,
    };

    let queueId = '';
    let pickupCode = '----';

    const { data, error } = await supabase
      .from('fila_encomendas')
      .insert(payload)
      .select('id')
      .single();

    if (!error && data?.id) {
      queueId = data.id;
      console.log(`[API/packages/queue] Encomenda publicada na fila: ${data.id}`);
    } else {
      console.warn('[API/packages/queue] Fila indisponível, gravando diretamente na tabela packages:', error?.message);
      pickupCode = Array.from({length: 6}, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.charAt(Math.floor(Math.random() * 36))).join('');
      const qrToken = `pkg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      let targetCondoId = null;
      if (unitId) {
        const { data: u } = await supabase.from('units').select('condo_id').eq('id', unitId).single();
        targetCondoId = u?.condo_id || null;
      }

      const { data: pkgData, error: pkgErr } = await supabase
        .from('packages')
        .insert({
          condo_id: targetCondoId,
          unit_id: unitId,
          resident_id: residentId || null,
          carrier: carrier || 'Transportadora',
          tracking_code: trackingCode || null,
          recipient_name_ocr: recipientNameOcr || null,
          label_image_path: labelImagePath || null,
          notes: notes || null,
          pickup_code: pickupCode,
          qr_token: qrToken,
          status: 'RECEIVED',
          received_at: new Date().toISOString()
        })
        .select('id, pickup_code, status')
        .single();

      if (pkgErr || !pkgData) {
        return NextResponse.json(
          { success: false, error: pkgErr?.message || error?.message || 'Erro ao gravar encomenda' },
          { status: 500 }
        );
      }
      queueId = pkgData.id;
      pickupCode = pkgData.pickup_code;
    }

    return NextResponse.json({
      success: true,
      queued: true,
      queueId,
      message: 'Encomenda registrada com sucesso.',
      package: {
        id: queueId,
        pickup_code: pickupCode,
        status: 'RECEIVED'
      },
      whatsapp: {
        sent: false,
        queued: true
      }
    });

  } catch (err: any) {
    console.error('[API/packages/queue] Erro inesperado:', err.message);
    return NextResponse.json(
      { success: false, error: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}

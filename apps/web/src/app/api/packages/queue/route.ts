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

    const { data, error } = await supabase
      .from('fila_encomendas')
      .insert(payload)
      .select('id')
      .single();

    if (error) {
      console.error('[API/packages/queue] Erro ao inserir na fila:', error.message);
      return NextResponse.json(
        { success: false, error: `Erro na fila: ${error.message}` },
        { status: 500 }
      );
    }

    console.log(`[API/packages/queue] Encomenda publicada na fila: ${data?.id}`);

    return NextResponse.json({
      success: true,
      queued: true,
      queueId: data?.id,
      message: 'Encomenda publicada na fila. O sistema da portaria irá processar e notificar o morador.',
      package: {
        id: data?.id,
        pickup_code: '----', // Será gerado pelo local-api ao processar
        status: 'QUEUED'
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

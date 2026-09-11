import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Envia uma mensagem via WhatsApp utilizando a melhor estratégia disponível:
 * 1. Evolution API (v2) direta via HTTP
 * 2. API Local (localhost:3001) da máquina da portaria
 * 3. Fila Realtime do Supabase (fila_mensagens) consumida pelo aplicativo desktop
 */
async function dispatchWhatsAppMessage({
  supabase,
  packageId,
  phone,
  message,
}: {
  supabase: any;
  packageId: string;
  phone: string;
  message: string;
}): Promise<{ success: boolean; method: string }> {
  const cleanPhone = phone.replace(/\D/g, '');
  if (!cleanPhone) return { success: false, method: 'none' };

  const formattedPhone = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`;

  // 1. Tenta Evolution API
  const evolutionUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
  const evolutionKey = process.env.EVOLUTION_API_KEY || 'condobox_evolution_secret_key_2026';
  const instanceName = process.env.EVOLUTION_INSTANCE_NAME || 'portaria';

  if (evolutionUrl) {
    try {
      const res = await fetch(`${evolutionUrl.replace(/\/$/, '')}/message/sendText/${instanceName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: evolutionKey,
        },
        body: JSON.stringify({
          number: formattedPhone,
          text: message,
        }),
        signal: AbortSignal.timeout(6000),
      });

      if (res.ok) {
        console.log(`[Acknowledge] WhatsApp enviado via Evolution API para ${formattedPhone}`);
        return { success: true, method: 'evolution-api' };
      }
    } catch (err: any) {
      console.warn(`[Acknowledge] Evolution API indisponível (${err.message}), tentando alternativas...`);
    }
  }

  // 2. Tenta API Local do CondoBox (Porta 3001)
  const localApiUrl = process.env.NEXT_PUBLIC_LOCAL_API_URL || 'http://localhost:3001';
  try {
    const res = await fetch(`${localApiUrl.replace(/\/$/, '')}/api/whatsapp/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: formattedPhone,
        message,
      }),
      signal: AbortSignal.timeout(4000),
    });

    if (res.ok) {
      console.log(`[Acknowledge] WhatsApp enviado via API Local para ${formattedPhone}`);
      return { success: true, method: 'local-api' };
    }
  } catch (err: any) {
    console.warn(`[Acknowledge] API Local indisponível (${err.message}), enfileirando no Supabase...`);
  }

  // 3. Fallback: Fila Realtime do Supabase (fila_mensagens)
  // O aplicativo desktop da portaria consome esta tabela em tempo real via WebSocket
  try {
    const { error: queueErr } = await supabase.from('fila_mensagens').insert({
      package_id: packageId,
      phone: formattedPhone,
      message,
      tipo: 'AVISO',
    });

    if (!queueErr) {
      console.log(`[Acknowledge] Mensagem inserida na fila_mensagens para ${formattedPhone}`);
      return { success: true, method: 'supabase-queue' };
    }
  } catch (err: any) {
    console.warn(`[Acknowledge] Falha ao enfileirar no Supabase: ${err.message}`);
  }

  return { success: false, method: 'failed' };
}

export async function POST(
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
    auth: { persistSession: false },
  });

  try {
    // 1. Busca os dados da encomenda
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);
    let query = supabase
      .from('packages')
      .select('*, unit:units(block, unit_number), resident:residents(name, phone), condo:condos(name, phone)');

    if (isUUID) {
      query = query.eq('id', token);
    } else {
      query = query.or(`qr_token.eq.${token},pickup_code.ilike.${token},qr_token.ilike.${token},pickup_code.eq.${token}`);
    }

    let { data: pkg, error } = await query.limit(1).maybeSingle();

    if (!pkg) {
      return NextResponse.json(
        { error: 'Encomenda não encontrada para o código informado.' },
        { status: 404 }
      );
    }

    let body: any = {};
    try {
      body = await request.json();
    } catch {}

    // 2. Identifica os telefones e dados para a mensagem
    let recipientPhone = pkg.resident?.phone || pkg.phone || body?.phone;
    if (!recipientPhone) {
      const { data: nLog } = await supabase
        .from('notifications_log')
        .select('recipient_phone')
        .eq('package_id', pkg.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (nLog?.recipient_phone) {
        recipientPhone = nLog.recipient_phone;
      }
    }

    const condoPhone = pkg.condo?.phone && pkg.condo?.phone !== '5511988887777' ? pkg.condo.phone : null;
    const residentName = pkg.resident?.name || pkg.recipient_name_ocr || 'Morador';
    const unitText = pkg.unit ? `Bloco ${pkg.unit.block} - Apto ${pkg.unit.unit_number}` : 'sua unidade';
    const carrier = pkg.carrier || 'Transportadora';

    // Se não tiver telefone do morador mas tiver o da portaria, usa o da portaria para notificar
    const targetPhone = recipientPhone || condoPhone;

    // Monta o texto formal de confirmação de ciência
    const message =
      `👍 *CONFIRMAÇÃO DE CIÊNCIA REGISTRADA!*\n\n` +
      `Olá, *${residentName}*!\n` +
      `Registramos com sucesso sua confirmação para a encomenda da *${carrier}* (${unitText}).\n\n` +
      `🔑 *Código de Retirada:* *${pkg.pickup_code}*\n\n` +
      `🏢 *Portaria:* Notificação confirmada. Apresente o QR Code no balcão para retirar.`;

    // 3. Dispara a mensagem para o WhatsApp do morador
    let whatsappSent = false;
    let dispatchMethod = 'none';

    if (targetPhone) {
      const result = await dispatchWhatsAppMessage({
        supabase,
        packageId: pkg.id,
        phone: targetPhone,
        message,
      });
      whatsappSent = result.success;
      dispatchMethod = result.method;
    }

    // Se o condomínio tiver número próprio e for diferente do morador, envia também o aviso para a portaria
    if (condoPhone && condoPhone.replace(/\D/g, '') !== recipientPhone?.replace(/\D/g, '')) {
      const portariaAlert =
        `🔔 *CIÊNCIA DE ENCOMENDA CONFIRMADA*\n\n` +
        `Morador(a) *${residentName}* (${unitText}) confirmou que está ciente da encomenda *${carrier}* (Código: *${pkg.pickup_code}*).`;

      dispatchWhatsAppMessage({
        supabase,
        packageId: pkg.id,
        phone: condoPhone,
        message: portariaAlert,
      }).catch(() => {});
    }

    // 4. Registra no banco de dados que o morador confirmou
    const nowIso = new Date().toISOString();
    const existingNotes = pkg.notes ? `${pkg.notes} | ` : '';
    await supabase
      .from('packages')
      .update({
        notes: `${existingNotes}Ciência confirmada pelo morador via web em ${nowIso}`,
      })
      .eq('id', pkg.id);

    // Registra log na tabela de notificações
    if (recipientPhone) {
      supabase.from('notifications_log').insert({
        package_id: pkg.id,
        resident_id: pkg.resident_id || null,
        channel: 'WHATSAPP',
        recipient_phone: recipientPhone.replace(/\D/g, ''),
        message_content: message,
        status: whatsappSent ? 'SENT' : 'PENDING_QUEUE',
      }).then(() => {});
    }

    return NextResponse.json({
      success: true,
      pickup_code: pkg.pickup_code,
      whatsappSent,
      method: dispatchMethod,
      message: 'Confirmação de ciência registrada e enviada no WhatsApp!',
    });
  } catch (err: any) {
    console.error('[Acknowledge Error]', err);
    return NextResponse.json(
      { error: 'Erro ao processar confirmação de ciência', details: err.message },
      { status: 500 }
    );
  }
}

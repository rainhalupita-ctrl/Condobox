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

    // Se for UUID
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

    // Retorna os dados da encomenda sem marcar automaticamente como ciente
    return NextResponse.json({
      package: {
        id: pkg.id,
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
      }
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Erro interno ao consultar encomenda', details: err.message },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  const token = params.token;
  if (!token) {
    return NextResponse.json({ error: 'Token não fornecido' }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);
    let query = supabase
      .from('packages')
      .select('*, unit:units(block, unit_number), resident:residents(name, phone)');

    if (isUUID) {
      query = query.eq('id', token);
    } else {
      query = query.or(`qr_token.eq.${token},pickup_code.eq.${token}`);
    }

    const { data: pkg, error: findError } = await query.limit(1).maybeSingle();
    if (findError || !pkg) {
      return NextResponse.json({ error: 'Encomenda não encontrada' }, { status: 404 });
    }

    const nowIso = new Date().toISOString();
    const updatedNotes = pkg.notes?.includes('CIENTE')
      ? pkg.notes
      : (pkg.notes ? `${pkg.notes};CIENTE:${nowIso}` : `CIENTE:${nowIso}`);

    await supabase
      .from('packages')
      .update({
        notes: updatedNotes,
        status: pkg.status === 'RECEIVED' ? 'NOTIFIED' : pkg.status
      })
      .eq('id', pkg.id);

    // Envia mensagem direta pelo Evolution API
    let phone = pkg.resident?.phone;
    if (phone) {
      let cleanPhone = phone.replace(/\D/g, '');
      if (!cleanPhone.startsWith('55') && cleanPhone.length >= 10) cleanPhone = `55${cleanPhone}`;

      const evolutionUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
      const evolutionKey = process.env.EVOLUTION_API_KEY || 'condobox_evolution_secret_key_2026';
      const instanceName = process.env.EVOLUTION_INSTANCE_NAME || 'portaria';

      const name = pkg.resident?.name || pkg.recipient_name_ocr || 'Morador';
      const confirmMsg = `👍 *CONFIRMAÇÃO REGISTRADA COM SUCESSO!*\n\n` +
        `Olá, *${name}*!\n\n` +
        `Registramos sua confirmação de recebimento da encomenda da *${pkg.carrier}*.\n\n` +
        `🔑 *Código de Retirada:* *${pkg.pickup_code}*\n\n` +
        `🏢 Apresente este código ou o QR Code na portaria ao retirar.`;

      try {
        const evoRes = await fetch(`${evolutionUrl.replace(/\/$/, '')}/message/sendText/${instanceName}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': evolutionKey
          },
          body: JSON.stringify({
            number: cleanPhone,
            text: confirmMsg
          }),
          signal: AbortSignal.timeout(8000)
        });

        if (!evoRes.ok) {
          const errText = await evoRes.text();
          console.warn('[API Package Confirm] Evolution API retornou erro:', errText);
          return NextResponse.json({ error: 'Falha ao enviar mensagem de confirmação.' }, { status: 502 });
        }
      } catch (err: any) {
        console.warn('[API Package Confirm] Falha na requisição para Evolution API:', err.message);
        return NextResponse.json({ error: 'Erro de comunicação com o servidor de mensagens.' }, { status: 502 });
      }
    }

    return NextResponse.json({
      success: true,
      notes: updatedNotes,
      pickup_code: pkg.pickup_code
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'Erro ao registrar confirmação' }, { status: 500 });
  }
}

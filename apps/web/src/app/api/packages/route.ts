import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      unitId,
      residentId,
      carrier,
      trackingCode,
      recipientNameOcr,
      labelImagePath,
      notes,
      sendWhatsApp = true,
      residentPhone,
      residentName,
      unitInfo
    } = body;

    if (!unitId || !carrier) {
      return NextResponse.json(
        { error: 'Os campos "unitId" e "carrier" são obrigatórios.' },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // 1. Gera código de 4 dígitos e token único
    const pickupCode = Math.floor(1000 + Math.random() * 9000).toString();
    const qrToken = `pkg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // 2. Insere a encomenda no Supabase
    const { data: newPackage, error: dbError } = await supabase
      .from('packages')
      .insert({
        unit_id: unitId,
        resident_id: residentId || null,
        carrier,
        tracking_code: trackingCode || null,
        recipient_name_ocr: recipientNameOcr || null,
        label_image_path: labelImagePath || null,
        notes: notes || null,
        pickup_code: pickupCode,
        qr_token: qrToken,
        status: 'RECEIVED',
        received_at: new Date().toISOString()
      })
      .select('*, unit:units(block, unit_number), resident:residents(name, phone)')
      .single();

    if (dbError || !newPackage) {
      return NextResponse.json(
        { error: 'Erro ao cadastrar encomenda no banco', details: dbError?.message },
        { status: 500 }
      );
    }

    let whatsappSent = false;
    let whatsappError: string | undefined;

    // 3. Disparo de WhatsApp se solicitado
    if (sendWhatsApp) {
      let phone = residentPhone || newPackage.resident?.phone;
      let name = residentName || newPackage.resident?.name || recipientNameOcr || 'Morador';
      const unitText = unitInfo || (newPackage.unit ? `${newPackage.unit.block} - Apto ${newPackage.unit.unit_number}` : 'sua unidade');

      if (!phone && unitId) {
        const { data: unitResidents } = await supabase
          .from('residents')
          .select('name, phone, is_primary')
          .eq('unit_id', unitId);
        if (unitResidents && unitResidents.length > 0) {
          const primary = unitResidents.find(r => r.is_primary) || unitResidents[0];
          phone = primary.phone;
          if (!name || name === 'Morador') name = primary.name;
        }
      }

      if (phone) {
        // Normaliza telefone
        let cleanPhone = phone.replace(/\D/g, '');
        if (!cleanPhone.startsWith('55') && cleanPhone.length >= 10) cleanPhone = `55${cleanPhone}`;

        const webBaseUrl = process.env.WEB_APP_URL || 'https://web-eight-rust-97.vercel.app';
        const pickupUrl = `${webBaseUrl}/p/${newPackage.qr_token || newPackage.pickup_code}`;

        const messageText = `📦 *NOVA ENCOMENDA CHEGOU NA PORTARIA!*\n\n` +
          `Olá, *${name}*!\n\n` +
          `Uma encomenda da *${carrier}* acabou de ser recebida na portaria para sua unidade (*${unitText}*).\n\n` +
          `🔑 *Código de Retirada:* *${pickupCode}*\n\n` +
          `📱 *Link com QR Code (Sem login necessário):*\n` +
          `${pickupUrl}\n\n` +
          `_Apresente o QR Code no link acima ou fale o código de 4 dígitos na portaria._\n\n` +
          `🏢 Portaria do Condomínio`;

        const evolutionUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
        const evolutionKey = process.env.EVOLUTION_API_KEY || 'condobox_evolution_secret_key_2026';
        const instanceName = process.env.EVOLUTION_INSTANCE_NAME || 'portaria';
        const labelImageUrl = labelImagePath && (labelImagePath.startsWith('http://') || labelImagePath.startsWith('https://'))
          ? labelImagePath
          : undefined;

        try {
          let sendRes: Response | null = null;

          // 1. Tenta enviar como mensagem com Imagem (mediaMessage)
          if (labelImageUrl) {
            try {
              sendRes = await fetch(`${evolutionUrl.replace(/\/$/, '')}/message/sendMedia/${instanceName}`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': evolutionKey
                },
                body: JSON.stringify({
                  number: cleanPhone,
                  mediaMessage: {
                    mediatype: 'image',
                    caption: messageText,
                    media: labelImageUrl
                  }
                }),
                signal: AbortSignal.timeout(12000)
              });
            } catch (mediaErr) {
              console.warn('[WhatsApp] Falha no sendMedia, tentando sendText fallback:', mediaErr);
            }
          }

          // 2. Se não tinha imagem ou se sendMedia falhou, envia mensagem de texto padrão
          if (!sendRes || !sendRes.ok) {
            sendRes = await fetch(`${evolutionUrl.replace(/\/$/, '')}/message/sendText/${instanceName}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'apikey': evolutionKey
              },
              body: JSON.stringify({
                number: cleanPhone,
                text: messageText
              }),
              signal: AbortSignal.timeout(8000)
            });
          }

          if (sendRes && sendRes.ok) {
            whatsappSent = true;
            await supabase.from('packages').update({ status: 'NOTIFIED' }).eq('id', newPackage.id);
            newPackage.status = 'NOTIFIED';
          } else if (sendRes) {
            const errData = await sendRes.json().catch(() => ({}));
            whatsappError = errData.response?.message || 'Falha no envio';
          }
        } catch (e: any) {
          whatsappError = e.message;
        }

        // Registra log na tabela notifications_log
        await supabase.from('notifications_log').insert({
          package_id: newPackage.id,
          resident_id: newPackage.resident_id || null,
          channel: 'WHATSAPP',
          recipient_phone: cleanPhone,
          message_content: messageText,
          status: whatsappSent ? 'SENT' : 'FAILED',
          error_message: whatsappError || null,
          sent_at: whatsappSent ? new Date().toISOString() : null
        });
      }
    }

    return NextResponse.json({
      package: newPackage,
      whatsapp: {
        sent: whatsappSent,
        error: whatsappError
      }
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Falha interna ao criar encomenda', details: error.message },
      { status: 500 }
    );
  }
}

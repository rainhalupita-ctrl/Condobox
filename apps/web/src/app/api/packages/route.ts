import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      condoId,
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
      unitInfo,
      deliveredToName
    } = body;

    if (!unitId || !carrier) {
      return NextResponse.json(
        { error: 'Os campos "unitId" e "carrier" são obrigatórios.' },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://isurnvsehvjdslpnxirn.supabase.co';
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // Descobre o condo_id a partir do parâmetro ou consultando a unidade vinculada
    let targetCondoId = condoId || null;
    if (!targetCondoId && unitId) {
      const { data: u } = await supabase.from('units').select('condo_id').eq('id', unitId).single();
      targetCondoId = u?.condo_id || null;
    }

    // Gera código alfanumérico de 6 caracteres
    const pickupCode = Array.from({length: 6}, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.charAt(Math.floor(Math.random() * 36))).join('');
    const qrToken = `pkg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Se a imagem veio como Base64 (fallback garantido), salva no Supabase Storage
    let finalLabelImagePath = labelImagePath || null;
    if (labelImagePath && labelImagePath.startsWith('data:')) {
      try {
        const mimeMatch = labelImagePath.match(/^data:(image\/\w+);base64,/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
        const ext = mime.includes('png') ? 'png' : (mime.includes('webp') ? 'webp' : 'jpg');
        const base64Data = labelImagePath.replace(/^data:image\/\w+;base64,/, '');
        const buf = Buffer.from(base64Data, 'base64');
        const datePrefix = new Date().toISOString().slice(0, 7);
        const filename = `${datePrefix}/${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${ext}`;

        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from('labels')
          .upload(filename, buf, {
            contentType: mime,
            upsert: true
          });

        if (!uploadErr && uploadData) {
          const { data: pubData } = supabase.storage.from('labels').getPublicUrl(filename);
          if (pubData?.publicUrl) {
            finalLabelImagePath = pubData.publicUrl;
            console.log(`☁️ [API Packages] Imagem Base64 enviada para Supabase Storage: ${finalLabelImagePath}`);
          }
        }
      } catch (err: any) {
        console.warn('[API Packages] Falha ao enviar imagem Base64 para storage:', err.message);
      }
    }

    // 2. Insere a encomenda no Supabase
    const { data: newPackage, error: dbError } = await supabase
      .from('packages')
      .insert({
        condo_id: targetCondoId,
        unit_id: unitId,
        resident_id: residentId || null,
        carrier,
        tracking_code: trackingCode || null,
        recipient_name_ocr: recipientNameOcr || null,
        label_image_path: finalLabelImagePath,
        notes: notes || null,
        delivered_to_name: deliveredToName || null,
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
    let whatsappQueued = false;
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
          `Olá, *${name}*! 👋\n\n` +
          `Uma encomenda da *${carrier}* acabou de ser recebida na portaria para sua unidade (*${unitText}*).\n\n` +
          `📸 *Foto da etiqueta anexada acima.*\n\n` +
          `💬 *Por favor, responda esta mensagem informando quem irá retirar:*\n` +
          `• *Se for você mesmo:* responda *"Eu mesmo"* ou *"OK"*.\n` +
          `• *Se for algum terceiro retirar (familiar, amigo, vizinho ou prestador):* informe quem vai buscar (ex: *"Quem vai buscar é minha esposa Maria"* ou *"Pode entregar para o Carlos"*).\n\n` +
          `Assim que você responder, seu Código e QR Code de Retirada serão liberados automaticamente! 🔑\n\n` +
          `🏢 Portaria do Condomínio`;

        const evolutionUrl = process.env.EVOLUTION_API_URL;
        const evolutionKey = process.env.EVOLUTION_API_KEY;
        const instanceName = process.env.EVOLUTION_INSTANCE_NAME || 'portaria';
        let labelImageUrl: string | undefined = undefined;
        if (finalLabelImagePath) {
          if (finalLabelImagePath.startsWith('http://') || finalLabelImagePath.startsWith('https://') || finalLabelImagePath.startsWith('data:')) {
            labelImageUrl = finalLabelImagePath;
          } else {
            const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
            if (supabaseUrl) {
              const cleanPath = finalLabelImagePath.replace(/^\/?images\//, '').replace(/^labels\//, '');
              labelImageUrl = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/labels/${cleanPath}`;
            }
          }
        }

        // Só tenta conexão HTTP direta se houver uma URL remota válida (não localhost/127.0.0.1)
        const isRemoteEvolution = Boolean(
          evolutionUrl &&
          !evolutionUrl.includes('localhost') &&
          !evolutionUrl.includes('127.0.0.1')
        );

        if (isRemoteEvolution) {
          try {
            let sendRes: Response | null = null;

            // 1. Tenta enviar como mensagem com Imagem
            if (labelImageUrl) {
              try {
                sendRes = await fetch(`${evolutionUrl!.replace(/\/$/, '')}/message/sendMedia/${instanceName}`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'apikey': evolutionKey || ''
                  },
                  body: JSON.stringify({
                    number: cleanPhone,
                    media: labelImageUrl,
                    mediatype: 'image',
                    mimetype: 'image/jpeg',
                    caption: messageText,
                    fileName: 'etiqueta.jpg'
                  }),
                  signal: AbortSignal.timeout(3500)
                });
              } catch (mediaErr) {
                console.warn('[WhatsApp] Falha no sendMedia remoto:', mediaErr);
              }
            }

            // 2. Se não tinha imagem ou se sendMedia falhou, envia mensagem de texto padrão
            if (!sendRes || !sendRes.ok) {
              sendRes = await fetch(`${evolutionUrl!.replace(/\/$/, '')}/message/sendText/${instanceName}`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': evolutionKey || ''
                },
                body: JSON.stringify({
                  number: cleanPhone,
                  text: messageText
                }),
                signal: AbortSignal.timeout(3000)
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
        }

        // Se o WhatsApp não foi enviado diretamente pela nuvem, a encomenda permanece RECEIVED
        // e é registrada em notifications_log como PENDING.
        // O WhatsAppQueueWorker da portaria (com Baileys nativo) consome via Realtime em milissegundos.
        whatsappQueued = !whatsappSent;
        await supabase.from('notifications_log').insert({
          package_id: newPackage.id,
          resident_id: newPackage.resident_id || null,
          channel: 'WHATSAPP',
          recipient_phone: cleanPhone,
          message_content: messageText,
          status: whatsappSent ? 'SENT' : 'PENDING',
          error_message: whatsappError || null,
          sent_at: whatsappSent ? new Date().toISOString() : null
        });
      }
    }

    return NextResponse.json({
      package: newPackage,
      whatsapp: {
        sent: whatsappSent,
        queued: whatsappQueued,
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

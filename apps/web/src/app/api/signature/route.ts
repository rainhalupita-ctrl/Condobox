import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      packageId,
      signatureBase64,
      deliveredToName,
      deliveredByUserId,
      sendWhatsAppConfirmation = true
    } = body;

    if (!packageId || !signatureBase64) {
      return NextResponse.json(
        { error: 'Os campos "packageId" e "signatureBase64" são obrigatórios.' },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://isurnvsehvjdslpnxirn.supabase.co';
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzdXJudnNlaHZqZHNscG54aXJuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODAzNjM4NCwiZXhwIjoyMTAzNjEyMzg0fQ.2PO_jbeh-rpMmLFbN17aHbJwxHaQr8aeWi6A2hkg708';
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // 1. Busca a encomenda atual
    const { data: pkg, error: fetchErr } = await supabase
      .from('packages')
      .select('*, unit:units(block, unit_number), resident:residents(name, phone)')
      .eq('id', packageId)
      .single();

    if (fetchErr || !pkg) {
      return NextResponse.json(
        { error: 'Encomenda não encontrada' },
        { status: 404 }
      );
    }

    const filename = `signature_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.png`;
    let signaturePath = `signatures/${filename}`;
    const deliveredAt = new Date().toISOString();
    const deliveredTo = deliveredToName || pkg.resident?.name || 'Morador';

    // Faz upload da assinatura para o Supabase Storage (bucket 'signatures')
    try {
      const base64Data = signatureBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from('signatures')
        .upload(filename, buffer, {
          contentType: 'image/png',
          upsert: true
        });

      if (!uploadErr && uploadData) {
        const { data: pubData } = supabase.storage.from('signatures').getPublicUrl(filename);
        if (pubData?.publicUrl) {
          signaturePath = pubData.publicUrl;
        }
      }
    } catch (e: any) {
      console.warn('[api/signature] Falha ao fazer upload da assinatura:', e.message);
    }

    // 2. Atualiza a encomenda como entregue
    const { data: updatedPkg, error: updateErr } = await supabase
      .from('packages')
      .update({
        status: 'DELIVERED',
        delivered_at: deliveredAt,
        delivered_to_name: deliveredTo,
        delivered_by_user_id: deliveredByUserId || null,
        signature_image_path: signaturePath
      })
      .eq('id', packageId)
      .select('*, unit:units(block, unit_number), resident:residents(name, phone)')
      .single();

    if (updateErr) {
      return NextResponse.json(
        { error: 'Erro ao dar baixa na encomenda', details: updateErr.message },
        { status: 500 }
      );
    }

    // Dispara broadcast em tempo real para o site do morador
    try {
      const channelsToNotify = [
        `public-package-${packageId}`,
        pkg.qr_token ? `public-package-${pkg.qr_token}` : null,
        pkg.pickup_code ? `public-package-${pkg.pickup_code}` : null,
        'packages-morador-live'
      ].filter(Boolean) as string[];

      for (const chName of channelsToNotify) {
        const ch = supabase.channel(chName);
        ch.subscribe((st: string) => {
          if (st === 'SUBSCRIBED') {
            ch.send({
              type: 'broadcast',
              event: 'status-updated',
              payload: {
                status: 'DELIVERED',
                packageId,
                qrToken: pkg.qr_token,
                pickupCode: pkg.pickup_code,
                deliveredTo,
                deliveredAt,
                signatureUrl: signaturePath
              }
            }).then(() => {
              setTimeout(() => supabase.removeChannel(ch), 3000);
            }).catch(() => {});
          }
        });
      }
    } catch (realtimeErr) {
      console.warn('[api/signature] Falha ao disparar Realtime broadcast:', realtimeErr);
    }

    // 3. Dispara WhatsApp de confirmação de entrega
    let whatsappDeliveredSent = false;
    const phone = pkg.resident?.phone;

    if (sendWhatsAppConfirmation && phone) {
      let cleanPhone = phone.replace(/\D/g, '');
      if (!cleanPhone.startsWith('55') && cleanPhone.length >= 10) cleanPhone = `55${cleanPhone}`;

      const unitText = pkg.unit ? `${pkg.unit.block} - Apto ${pkg.unit.unit_number}` : 'sua unidade';
      const formattedDeliveredAt = new Date(deliveredAt).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      const messageText = `✅ *ENCOMENDA RETIRADA COM SUCESSO!*\n\n` +
        `Olá, *${pkg.resident?.name || 'Morador'}*!\n\n` +
        `A encomenda (*${pkg.carrier}*) da unidade *${unitText}* foi retirada na portaria.\n\n` +
        `👤 *Retirado por:* ${deliveredTo}\n` +
        `🕒 *Data/Hora:* ${formattedDeliveredAt}\n` +
        `✍️ *Assinatura digital arquivada com segurança no sistema.*\n\n` +
        `⚠️ *Não foi você quem retirou?*\n` +
        `Se você não recebeu esta encomenda, você pode clicar no link enviado na mensagem anterior para contestar e entrar em contato com a portaria.\n\n` +
        `🏢 Portaria do Condomínio`;

      const evolutionUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
      const evolutionKey = process.env.EVOLUTION_API_KEY || 'condobox_evolution_secret_key_2026';
      const instanceName = process.env.EVOLUTION_INSTANCE_NAME || 'portaria';

      try {
        const sendRes = await fetch(`${evolutionUrl.replace(/\/$/, '')}/message/sendText/${instanceName}`, {
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
        if (sendRes.ok) {
          whatsappDeliveredSent = true;
        }
      } catch {}
    }

    return NextResponse.json({
      success: true,
      deliveredAt,
      deliveredTo,
      signaturePath,
      package: updatedPkg,
      whatsappSent: whatsappDeliveredSent
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Falha ao registrar assinatura', details: error.message },
      { status: 500 }
    );
  }
}

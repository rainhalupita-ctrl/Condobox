import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    let force = true;
    try {
      const body = await request.json();
      if (typeof body.force === 'boolean') force = body.force;
    } catch {}

    // 1. Tenta proxy para a API local (se estiver em execução no mesmo ambiente)
    const localApiUrl = process.env.NEXT_PUBLIC_LOCAL_API_URL || 'http://localhost:3001';
    try {
      const localRes = await fetch(`${localApiUrl.replace(/\/$/, '')}/api/packages/${id}/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
        signal: AbortSignal.timeout(3000)
      });
      const data = await localRes.json().catch(() => null);
      if (localRes.ok && data) return NextResponse.json(data);
      if (data && data.error) return NextResponse.json(data, { status: localRes.status });
    } catch {}

    // 2. Fallback na nuvem: busca a encomenda no Supabase
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } }
    );

    const { data: pkg, error: pkgErr } = await supabase
      .from('packages')
      .select('*, unit:units(block, unit_number), resident:residents(name, phone)')
      .or(`id.eq.${id},pickup_code.eq.${id}`)
      .limit(1)
      .maybeSingle();

    if (pkgErr || !pkg) {
      return NextResponse.json({ success: false, error: 'Encomenda não encontrada no sistema' }, { status: 404 });
    }

    const phone = pkg.resident?.phone;
    if (!phone) {
      return NextResponse.json({
        success: false,
        error: 'Nenhum telefone de morador cadastrado para esta unidade.',
      }, { status: 400 });
    }

    // 3. Se houver Evolution API configurada na nuvem
    const evolutionUrl = process.env.EVOLUTION_API_URL;
    const evolutionKey = process.env.EVOLUTION_API_KEY;
    const instance = process.env.EVOLUTION_INSTANCE_NAME || 'portaria';

    if (evolutionUrl && evolutionKey) {
      let cleanPhone = phone.replace(/\D/g, '');
      if (!cleanPhone.startsWith('55') && cleanPhone.length >= 10) cleanPhone = `55${cleanPhone}`;
      const name = pkg.resident?.name || pkg.recipient_name_ocr || 'Morador';
      const unitText = pkg.unit ? `${pkg.unit.block} - Apto ${pkg.unit.unit_number}` : 'sua unidade';

      const messageText = `📦 *NOVA ENCOMENDA CHEGOU NA PORTARIA!*\n\n` +
        `Olá, *${name}*! 👋\n\n` +
        `Uma encomenda da *${pkg.carrier || 'Transportadora'}* acabou de ser recebida na portaria para sua unidade (*${unitText}*).\n\n` +
        `💬 *Por favor, responda esta mensagem informando quem irá retirar:*\n` +
        `• *Se for você mesmo:* responda *"Eu mesmo"* ou *"OK"*.\n` +
        `• *Se for algum terceiro retirar (familiar, amigo, vizinho ou prestador):* informe quem vai buscar (ex: *"Quem vai buscar é minha esposa Maria"* ou *"Pode entregar para o Carlos"*).\n\n` +
        `Assim que você responder, seu Código e QR Code de Retirada serão liberados automaticamente! 🔑\n\n` +
        `🏢 Portaria do Condomínio`;

      const evoRes = await fetch(`${evolutionUrl.replace(/\/$/, '')}/message/sendText/${instance}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: evolutionKey },
        body: JSON.stringify({ number: cleanPhone, text: messageText }),
      });

      if (evoRes.ok) {
        await supabase.from('packages').update({ status: 'NOTIFIED' }).eq('id', pkg.id);
        return NextResponse.json({ success: true, message: `Notificação enviada com sucesso para ${cleanPhone}!` });
      }
    }

    return NextResponse.json({
      success: false,
      error: 'WhatsApp da portaria é gerenciado localmente pelo aplicativo Desktop. Abra o CondoBox no computador da portaria.',
    }, { status: 503 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

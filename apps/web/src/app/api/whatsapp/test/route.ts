import { NextResponse, type NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const localApiUrl = process.env.NEXT_PUBLIC_LOCAL_API_URL || 'http://localhost:3001';
  let body: any = {};
  try {
    body = await request.json();
  } catch {}

  const phone = body.phone;
  if (!phone) {
    return NextResponse.json({ success: false, error: 'Telefone é obrigatório.' }, { status: 400 });
  }

  // 1. Tenta API local do Baileys
  try {
    const res = await fetch(`${localApiUrl}/api/whatsapp/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
      signal: AbortSignal.timeout(10000)
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch (err: any) {
    console.warn('[API/whatsapp/test] API local indisponível:', err.message);
  }

  // 2. Fallback para Evolution API se configurada
  const evolutionUrl = process.env.EVOLUTION_API_URL;
  const evolutionKey = process.env.EVOLUTION_API_KEY;
  const instanceName = process.env.EVOLUTION_INSTANCE_NAME || 'portaria';

  if (evolutionUrl && evolutionKey) {
    try {
      const cleanPhone = phone.replace(/\D/g, '');
      const number = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`;
      const res = await fetch(`${evolutionUrl}/message/sendText/${instanceName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: evolutionKey
        },
        body: JSON.stringify({
          number,
          text: '🔔 *CondoBox Portaria* - Teste de conexão do WhatsApp realizado com sucesso!'
        }),
        signal: AbortSignal.timeout(10000)
      });
      if (res.ok) {
        return NextResponse.json({ success: true, message: 'Mensagem de teste enviada via Evolution API!' });
      }
    } catch (err: any) {
      return NextResponse.json({ success: false, error: `Falha ao enviar: ${err.message}` }, { status: 500 });
    }
  }

  return NextResponse.json({
    success: false,
    error: 'API Local de WhatsApp offline. Abra o aplicativo CondoBox no computador da portaria.'
  }, { status: 503 });
}

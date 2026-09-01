import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  const localApiUrl = process.env.NEXT_PUBLIC_LOCAL_API_URL || 'http://localhost:3001';

  try {
    const res = await fetch(`${localApiUrl}/api/whatsapp/connect`, {
      method: 'POST',
      signal: AbortSignal.timeout(8000)
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch (err: any) {
    console.warn('[API/whatsapp/connect] API local offline ao conectar:', err.message);
  }

  // Se Evolution API estiver configurada
  const evolutionUrl = process.env.EVOLUTION_API_URL;
  const evolutionKey = process.env.EVOLUTION_API_KEY;
  const instanceName = process.env.EVOLUTION_INSTANCE_NAME || 'portaria';

  if (evolutionUrl && evolutionKey) {
    try {
      const res = await fetch(`${evolutionUrl}/instance/connect/${instanceName}`, {
        method: 'GET',
        headers: { apikey: evolutionKey },
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json({
          success: true,
          qrcode: data.base64 || data.qrcode?.base64 || null,
          pairingCode: data.pairingCode || null,
          connected: data.instance?.state === 'open'
        });
      }
    } catch {}
  }

  return NextResponse.json({
    success: false,
    error: 'API Local do WhatsApp não encontrada. Abra o CondoBox Desktop no computador da portaria.'
  });
}

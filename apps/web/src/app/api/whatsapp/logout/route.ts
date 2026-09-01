import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  const localApiUrl = process.env.NEXT_PUBLIC_LOCAL_API_URL || 'http://localhost:3001';

  try {
    const res = await fetch(`${localApiUrl}/api/whatsapp/logout`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch (err: any) {
    console.warn('[API/whatsapp/logout] API local offline ao deslogar:', err.message);
  }

  // Se Evolution API estiver configurada na nuvem
  const evolutionUrl = process.env.EVOLUTION_API_URL;
  const evolutionKey = process.env.EVOLUTION_API_KEY;
  const instanceName = process.env.EVOLUTION_INSTANCE_NAME || 'portaria';

  if (evolutionUrl && evolutionKey) {
    try {
      await fetch(`${evolutionUrl}/instance/logout/${instanceName}`, {
        method: 'DELETE',
        headers: { apikey: evolutionKey },
        signal: AbortSignal.timeout(5000)
      });
    } catch {}
  }

  return NextResponse.json({
    success: true,
    message: 'Sessão do WhatsApp desconectada com sucesso.'
  });
}

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const localApiUrl = process.env.NEXT_PUBLIC_LOCAL_API_URL || 'http://localhost:3001';

  try {
    const res = await fetch(`${localApiUrl}/api/whatsapp/status`, {
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {}

  // 2. Se Evolution API estiver configurada na nuvem
  const evolutionUrl = process.env.EVOLUTION_API_URL;
  const evolutionKey = process.env.EVOLUTION_API_KEY;
  const instanceName = process.env.EVOLUTION_INSTANCE_NAME || 'portaria';

  if (evolutionUrl && evolutionKey) {
    try {
      const res = await fetch(`${evolutionUrl}/instance/connectionState/${instanceName}`, {
        headers: { apikey: evolutionKey },
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) {
        const data = await res.json();
        const isOpen = data.instance?.state === 'open';
        return NextResponse.json({
          engine: 'Evolution API',
          instance: instanceName,
          state: isOpen ? 'open' : 'close',
          connected: isOpen
        });
      }
    } catch {}
  }

  // 3. Se nada estiver conectado
  return NextResponse.json({
    engine: 'Baileys WhatsApp Nativo',
    instance: 'portaria',
    state: 'close',
    connected: false,
    mode: 'LOCAL_DESKTOP_STANDALONE'
  });
}

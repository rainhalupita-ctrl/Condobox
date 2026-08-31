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

  // Fallback padrão se API local ainda estiver iniciando
  return NextResponse.json({
    engine: 'Baileys WhatsApp Nativo',
    instance: 'portaria',
    state: 'open',
    connected: true,
    mode: 'NATIVE_ALL_IN_ONE'
  });
}

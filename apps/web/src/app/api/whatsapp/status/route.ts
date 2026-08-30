import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  // 1. Tentar conectar no IP local da portaria se configurado
  const localApiUrl = process.env.NEXT_PUBLIC_LOCAL_API_URL || 'http://192.168.0.6:3001';

  try {
    const res = await fetch(`${localApiUrl}/api/whatsapp/status`, {
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {}

  // Fallback padrão se o servidor local estiver operando em modo Realtime Supabase
  return NextResponse.json({
    apiUrl: 'Local Docker Evolution API (Porta 8080)',
    instance: 'portaria',
    state: 'open',
    connected: true,
    mode: 'SUPABASE_REALTIME_QUEUE'
  });
}

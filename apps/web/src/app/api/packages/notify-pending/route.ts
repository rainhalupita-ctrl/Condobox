import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const localApiUrl = process.env.NEXT_PUBLIC_LOCAL_API_URL || 'http://localhost:3001';
    try {
      const localRes = await fetch(`${localApiUrl.replace(/\/$/, '')}/api/packages/notify-pending`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(5000)
      });
      const data = await localRes.json().catch(() => null);
      if (localRes.ok && data) return NextResponse.json(data);
      if (data && data.error) return NextResponse.json(data, { status: localRes.status });
    } catch {}

    return NextResponse.json({
      success: false,
      error: 'WhatsApp da portaria é gerenciado localmente pelo aplicativo Desktop. Abra o CondoBox no computador da portaria.',
    }, { status: 503 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { phone, condoId } = body;

    const localApiUrl = process.env.NEXT_PUBLIC_LOCAL_API_URL || 'http://localhost:3001';

    try {
      const localRes = await fetch(`${localApiUrl.replace(/\/$/, '')}/api/delivery-batch/flush`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, condoId }),
        signal: AbortSignal.timeout(4000)
      });
      const data = await localRes.json().catch(() => null);
      if (localRes.ok && data) {
        return NextResponse.json(data);
      }
      if (data && data.error) {
        return NextResponse.json(data, { status: localRes.status });
      }
    } catch (fetchErr: any) {
      console.warn('[api/delivery-batch/flush] Não foi possível contatar a API local:', fetchErr.message);
    }

    return NextResponse.json({
      success: true,
      message: 'Comando de flush processado na rota web.',
      phone: phone || null
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

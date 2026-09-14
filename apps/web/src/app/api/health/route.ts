import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    online: true,
    service: 'CondoBox Cloud API',
    timestamp: new Date().toISOString(),
  });
}

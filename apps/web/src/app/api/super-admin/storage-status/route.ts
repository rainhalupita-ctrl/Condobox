import { NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient } from '../../../../lib/supabase/server';
import { checkStorageGuard, purgeOldDeliveredPhotos, STORAGE_FREE_LIMIT_MB } from '../../../../lib/storage-guard';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://isurnvsehvjdslpnxirn.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

async function verifyAdminAuth(request?: Request) {
  const supabaseAdmin = getSupabaseAdmin();
  let user: any = null;

  // 1. Tenta via cabeçalho Authorization: Bearer <token>
  const authHeader = request?.headers.get('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.replace(/^bearer\s+/i, '').trim();
    if (token) {
      const { data: uData } = await supabaseAdmin.auth.getUser(token);
      if (uData?.user) {
        user = uData.user;
      }
    }
  }

  // 2. Fallback: tenta obter via cookies da sessão
  if (!user) {
    try {
      const supabase = await createClient();
      const { data: uData } = await supabase.auth.getUser();
      user = uData?.user || null;
      if (!user) {
        const { data: sData } = await supabase.auth.getSession();
        user = sData?.session?.user || null;
      }
    } catch {}
  }

  if (!user) {
    return { error: 'Não autorizado. Faça login primeiro.', status: 401 };
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, role, name, condo_id')
    .eq('id', user.id)
    .maybeSingle();

  const userEmail = (user.email || '').toLowerCase();
  const superAdminEmails = (process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAILS || 'rainhalupita@gmail.com,klebervenancio2002@icloud.com')
    .split(',')
    .map(e => e.trim().toLowerCase());

  const isMaster = (profile?.role === 'ADMIN' && (!profile?.condo_id || superAdminEmails.includes(userEmail))) || superAdminEmails.includes(userEmail);

  if (!isMaster) {
    return { error: 'Acesso negado. Apenas o Dono do Sistema tem acesso a esta rota.', status: 403 };
  }

  return { user, profile };
}

// GET: Retorna o status detalhado de consumo e a trava de segurança
export async function GET(request: Request) {
  try {
    const authCheck = await verifyAdminAuth(request);
    if ('error' in authCheck) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const quota = await checkStorageGuard(false);
    return NextResponse.json({
      success: true,
      quota,
    });
  } catch (error: any) {
    console.error('[STORAGE-STATUS API] Erro ao consultar status:', error);
    return NextResponse.json({ error: error.message || 'Erro ao consultar cota' }, { status: 500 });
  }
}

// POST: Executa expurgo/rotação manual de fotos antigas para liberar espaço
export async function POST(request: Request) {
  try {
    const authCheck = await verifyAdminAuth(request);
    if ('error' in authCheck) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    let days = 30;
    try {
      const body = await request.json();
      if (typeof body.days === 'number' && body.days >= 0) {
        days = body.days;
      }
    } catch {}

    const purgeResult = await purgeOldDeliveredPhotos(days);
    const updatedQuota = await checkStorageGuard(true);

    const messageText = days === 0
      ? `Limpeza concluída com sucesso: ${purgeResult.purgedCount} fotos removidas (armazenamento zerado), liberando ${purgeResult.freedMB} MB.`
      : `Expurgo concluído com sucesso: ${purgeResult.purgedCount} fotos antigas (+${days} dias) removidas, liberando ${purgeResult.freedMB} MB.`;

    return NextResponse.json({
      success: true,
      purgedCount: purgeResult.purgedCount,
      freedBytes: purgeResult.freedBytes,
      freedMB: purgeResult.freedMB,
      errors: purgeResult.errors,
      quota: updatedQuota,
      message: messageText,
    });
  } catch (error: any) {
    console.error('[STORAGE-STATUS API] Erro ao expurgar fotos:', error);
    return NextResponse.json({ error: error.message || 'Erro ao executar expurgo' }, { status: 500 });
  }
}

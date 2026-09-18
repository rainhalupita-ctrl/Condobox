import { NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient } from '../../../../../lib/supabase/server';

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

// Verifica se o usuário autenticado na requisição é o Dono do Sistema (Master Admin)
async function verifyAdminAuth(request?: Request) {
  const supabaseAdmin = getSupabaseAdmin();
  let user: any = null;

  // 1. Tenta obter o usuário via cabeçalho Authorization: Bearer <token>
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

  const isMaster = profile?.role === 'ADMIN' || superAdminEmails.includes(userEmail);

  if (!isMaster) {
    return { error: 'Acesso negado. Apenas o Dono do Sistema tem acesso.', status: 403 };
  }

  return { user, profile };
}

// GET: Retorna todas as unidades e moradores de um condomínio para exportação
export async function GET(request: Request) {
  try {
    const authCheck = await verifyAdminAuth(request);
    if ('error' in authCheck) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const { searchParams } = new URL(request.url);
    const condoId = searchParams.get('condo_id');

    if (!condoId) {
      return NextResponse.json({ error: 'Parâmetro condo_id é obrigatório.' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    const [condoRes, unitsRes, residentsRes] = await Promise.all([
      supabaseAdmin.from('condos').select('id, name, address').eq('id', condoId).maybeSingle(),
      supabaseAdmin.from('units').select('*').eq('condo_id', condoId).order('block').order('unit_number'),
      supabaseAdmin.from('residents').select('*, unit:units!inner(*)').eq('unit.condo_id', condoId).order('name'),
    ]);

    if (condoRes.error) {
      return NextResponse.json({ error: `Erro ao buscar condomínio: ${condoRes.error.message}` }, { status: 500 });
    }

    return NextResponse.json({
      condo: condoRes.data || { id: condoId, name: 'Condomínio' },
      units: unitsRes.data || [],
      residents: residentsRes.data || [],
    });
  } catch (err: any) {
    console.error('Erro na exportação do condomínio:', err);
    return NextResponse.json({ error: err?.message || 'Erro interno no servidor' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient } from '../../../../lib/supabase/server';

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

  const isMaster = (profile?.role === 'ADMIN' && (!profile?.condo_id || superAdminEmails.includes(userEmail))) || superAdminEmails.includes(userEmail);

  if (!isMaster) {
    return { error: 'Acesso negado. Apenas o Dono do Sistema tem acesso ao Painel Master.', status: 403 };
  }

  return { user, profile };
}

// GET: Retorna lista de todos os condomínios com licenças, métricas e síndicos
export async function GET(request: Request) {
  try {
    const authCheck = await verifyAdminAuth(request);
    if ('error' in authCheck) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 1. Busca todos os condomínios
    const { data: condos, error: cErr } = await supabaseAdmin
      .from('condos')
      .select('*')
      .order('created_at', { ascending: false });

    if (cErr) {
      return NextResponse.json({ error: `Erro ao buscar condomínios: ${cErr.message}` }, { status: 500 });
    }

    // 2. Busca todas as licenças
    const { data: licenses } = await supabaseAdmin.from('licenses').select('*');

    // 3. Busca todos os perfis com seus respectivos usuários
    const { data: profiles } = await supabaseAdmin.from('profiles').select('*');

    // 4. Busca todos os usuários do Supabase Auth para obter e-mails
    const { data: authUsersData } = await supabaseAdmin.auth.admin.listUsers();
    const authUsers = authUsersData?.users || [];
    const authUserMap = new Map(authUsers.map(u => [u.id, u.email]));

    // 5. Conta unidades e encomendas por condomínio
    const { data: units } = await supabaseAdmin.from('units').select('id, condo_id');
    const { data: packages } = await supabaseAdmin.from('packages').select('id, condo_id, status');
    const { data: residents } = await supabaseAdmin.from('residents').select('id, unit_id');

    // Mapa de unidades para condomínio
    const unitCondoMap = new Map((units || []).map(u => [u.id, u.condo_id]));

    // Consolidar dados por condomínio
    const accounts = (condos || []).map(condo => {
      const license = (licenses || []).find(l => l.condo_id === condo.id) || null;
      
      // Perfis vinculados a este condomínio
      const condoProfiles = (profiles || []).filter(p => p.condo_id === condo.id);
      
      // Síndico / Administrador do condomínio
      const syndicProfile = condoProfiles.find(p => p.role === 'ADMIN' || p.role === 'SYNDIC') || condoProfiles[0] || null;
      const syndicEmail = syndicProfile ? authUserMap.get(syndicProfile.id) || null : null;

      // Métricas de unidades
      const condoUnitsCount = (units || []).filter(u => u.condo_id === condo.id).length;
      
      // Métricas de encomendas
      const condoPackages = (packages || []).filter(p => p.condo_id === condo.id);
      const pendingPackagesCount = condoPackages.filter(p => p.status === 'RECEIVED' || p.status === 'NOTIFIED').length;
      const totalPackagesCount = condoPackages.length;

      // Métricas de moradores
      const condoResidentsCount = (residents || []).filter(r => {
        const cId = unitCondoMap.get(r.unit_id);
        return cId === condo.id;
      }).length;

      return {
        id: condo.id,
        name: condo.name,
        address: condo.address || '',
        phone: condo.phone || '',
        created_at: condo.created_at,
        license: license ? {
          id: license.id,
          plan: license.plan,
          status: license.status,
          expires_at: license.expires_at,
          max_apartments: license.max_apartments || 250,
          created_at: license.created_at,
        } : null,
        syndic: syndicProfile ? {
          id: syndicProfile.id,
          name: syndicProfile.name,
          phone: syndicProfile.phone,
          email: syndicEmail,
          role: syndicProfile.role,
        } : null,
        stats: {
          units_count: condoUnitsCount,
          max_units: license?.max_apartments || 250,
          residents_count: condoResidentsCount,
          packages_count: totalPackagesCount,
          pending_packages: pendingPackagesCount,
          staff_count: condoProfiles.length,
        }
      };
    });

    // Tabela de Preços dos Planos (em Reais / mês)
    const PLAN_PRICES: Record<string, number> = {
      TRIAL: 0,
      BASIC: 149,
      PRO: 249,
      PRO_MAX: 449,
    };

    const activeAccounts = accounts.filter(a => a.license?.status === 'ACTIVE');
    const trialAccounts = accounts.filter(a => {
      const plan = (a.license?.plan || '').toUpperCase();
      const status = (a.license?.status || '').toUpperCase();
      return plan === 'TRIAL' || status === 'TRIAL';
    });
    const pausedAccounts = accounts.filter(a => {
      const status = (a.license?.status || '').toUpperCase();
      return status === 'BLOCKED' || status === 'EXPIRED' || status === 'PAUSED';
    });

    // Faturamento Mensal Recorrente (MRR): soma dos planos ativos que não são Trial
    const estimatedMRR = activeAccounts.reduce((sum, curr) => {
      const plan = (curr.license?.plan || 'BASIC').toUpperCase();
      return sum + (PLAN_PRICES[plan] ?? 149);
    }, 0);

    // Métricas Globais da Plataforma (Focadas no Dono do SaaS)
    const globalMetrics = {
      total_condos: accounts.length,
      active_condos: activeAccounts.length,
      trial_condos: trialAccounts.length,
      paused_condos: pausedAccounts.length,
      estimated_mrr: estimatedMRR,
      total_units: (units || []).length,
      total_residents: (residents || []).length,
      total_packages: (packages || []).length,
      total_users: authUsers.length,
    };

    return NextResponse.json({ accounts, metrics: globalMetrics });
  } catch (error: any) {
    console.error('[Super Admin API] Erro ao listar contas:', error);
    return NextResponse.json({ error: error.message || 'Erro interno do servidor.' }, { status: 500 });
  }
}

// PUT: Atualiza plano, limites, status ou dados cadastrais do condomínio
export async function PUT(request: Request) {
  try {
    const authCheck = await verifyAdminAuth(request);
    if ('error' in authCheck) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const body = await request.json();
    const { condoId, name, address, phone, plan, status, maxApartments, expiresAt } = body;

    if (!condoId) {
      return NextResponse.json({ error: 'O ID do condomínio é obrigatório.' }, { status: 400 });
    }

    // 1. Atualiza dados do condomínio se fornecidos
    if (name || address !== undefined || phone !== undefined) {
      const updateData: any = {};
      if (name) updateData.name = name.trim();
      if (address !== undefined) updateData.address = address.trim();
      if (phone !== undefined) updateData.phone = phone.trim();
      updateData.updated_at = new Date().toISOString();

      const { error: cErr } = await supabaseAdmin
        .from('condos')
        .update(updateData)
        .eq('id', condoId);

      if (cErr) {
        return NextResponse.json({ error: `Erro ao atualizar condomínio: ${cErr.message}` }, { status: 500 });
      }
    }

    // 2. Atualiza ou cria a licença (plano, limites, status, validade)
    if (plan || status || maxApartments !== undefined || expiresAt !== undefined) {
      const { data: existingLicense } = await supabaseAdmin
        .from('licenses')
        .select('id')
        .eq('condo_id', condoId)
        .maybeSingle();

      const licensePayload: any = {
        condo_id: condoId,
        updated_at: new Date().toISOString(),
      };

      if (plan) licensePayload.plan = plan;
      if (status) licensePayload.status = status;
      if (maxApartments !== undefined) licensePayload.max_apartments = Number(maxApartments);
      if (expiresAt !== undefined) licensePayload.expires_at = expiresAt;

      if (existingLicense) {
        const { error: lErr } = await supabaseAdmin
          .from('licenses')
          .update(licensePayload)
          .eq('id', existingLicense.id);

        if (lErr) {
          return NextResponse.json({ error: `Erro ao atualizar licença: ${lErr.message}` }, { status: 500 });
        }
      } else {
        licensePayload.plan = plan || 'TRIAL';
        licensePayload.status = status || 'ACTIVE';
        licensePayload.max_apartments = maxApartments !== undefined ? Number(maxApartments) : 250;

        const { error: lErr } = await supabaseAdmin
          .from('licenses')
          .insert(licensePayload);

        if (lErr) {
          return NextResponse.json({ error: `Erro ao criar licença: ${lErr.message}` }, { status: 500 });
        }
      }
    }

    return NextResponse.json({ success: true, message: 'Conta e licença atualizadas com sucesso.' });
  } catch (error: any) {
    console.error('[Super Admin API] Erro ao atualizar conta:', error);
    return NextResponse.json({ error: error.message || 'Erro ao processar atualização.' }, { status: 500 });
  }
}

// POST: Cadastra novo condomínio com licença e síndico inicial
export async function POST(request: Request) {
  try {
    const authCheck = await verifyAdminAuth(request);
    if ('error' in authCheck) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const body = await request.json();
    const { name, address, phone, plan = 'TRIAL', maxApartments = 250, syndicName, syndicEmail, syndicPassword } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: 'O nome do condomínio é obrigatório.' }, { status: 400 });
    }

    // 1. Cria o condomínio
    const { data: newCondo, error: cErr } = await supabaseAdmin
      .from('condos')
      .insert({
        name: name.trim(),
        address: address ? address.trim() : null,
        phone: phone ? phone.trim() : null,
      })
      .select()
      .single();

    if (cErr || !newCondo) {
      return NextResponse.json({ error: `Erro ao criar condomínio: ${cErr?.message || 'Falha na inserção'}` }, { status: 500 });
    }

    // 2. Cria a licença
    let expires = new Date();
    if (plan === 'TRIAL') {
      expires.setDate(expires.getDate() + 30);
    } else {
      expires.setFullYear(expires.getFullYear() + 1);
    }

    await supabaseAdmin.from('licenses').insert({
      condo_id: newCondo.id,
      plan: plan,
      status: 'ACTIVE',
      expires_at: expires.toISOString(),
      max_apartments: Number(maxApartments) || (plan === 'PRO_MAX' ? 600 : 250),
    });

    // 3. Se foram passados dados de síndico inicial, cria a conta
    if (syndicEmail && syndicPassword && syndicName) {
      const cleanEmail = syndicEmail.trim().toLowerCase();
      const cleanPhone = (phone || '').replace(/\D/g, '');

      const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
        email: cleanEmail,
        password: syndicPassword,
        email_confirm: true,
        user_metadata: {
          name: syndicName.trim(),
          role: 'SYNDIC',
        },
      });

      if (!authErr && authData?.user) {
        await supabaseAdmin.from('profiles').upsert({
          id: authData.user.id,
          condo_id: newCondo.id,
          name: syndicName.trim(),
          phone: cleanPhone,
          role: 'SYNDIC',
        }, { onConflict: 'id' });
      }
    }

    return NextResponse.json({ success: true, condo: newCondo });
  } catch (error: any) {
    console.error('[Super Admin API] Erro ao criar condomínio:', error);
    return NextResponse.json({ error: error.message || 'Erro ao processar criação.' }, { status: 500 });
  }
}

// DELETE: Exclui uma conta de condomínio
export async function DELETE(request: Request) {
  try {
    const authCheck = await verifyAdminAuth(request);
    if ('error' in authCheck) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const { searchParams } = new URL(request.url);
    const condoId = searchParams.get('condoId');

    if (!condoId) {
      return NextResponse.json({ error: 'condoId é obrigatório na query string.' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { error: dErr } = await supabaseAdmin.from('condos').delete().eq('id', condoId);

    if (dErr) {
      return NextResponse.json({ error: `Erro ao excluir condomínio: ${dErr.message}` }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Condomínio excluído com sucesso.' });
  } catch (error: any) {
    console.error('[Super Admin API] Erro ao excluir:', error);
    return NextResponse.json({ error: error.message || 'Erro interno.' }, { status: 500 });
  }
}

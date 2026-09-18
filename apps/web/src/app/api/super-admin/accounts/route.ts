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

  const isMaster = profile?.role === 'ADMIN' || superAdminEmails.includes(userEmail);

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

    // 1. Busca todos os dados necessários em paralelo no banco (tempo de resposta ultra-rápido)
    const [
      condosRes,
      licensesRes,
      profilesRes,
      unitsRes,
      packagesRes,
      residentsRes,
      authUsersRes,
    ] = await Promise.all([
      supabaseAdmin.from('condos').select('*').order('created_at', { ascending: false }),
      supabaseAdmin.from('licenses').select('*'),
      supabaseAdmin.from('profiles').select('*'),
      supabaseAdmin.from('units').select('id, condo_id'),
      supabaseAdmin.from('packages').select('id, condo_id, status'),
      supabaseAdmin.from('residents').select('id, unit_id'),
      supabaseAdmin.auth.admin.listUsers({ perPage: 1000 }).catch(() => ({ data: { users: [] } })),
    ]);

    if (condosRes.error) {
      return NextResponse.json({ error: `Erro ao buscar condomínios: ${condosRes.error.message}` }, { status: 500 });
    }

    const condos = condosRes.data || [];
    const licenses = licensesRes.data || [];
    const profiles = profilesRes.data || [];
    const units = unitsRes.data || [];
    const packages = packagesRes.data || [];
    const residents = residentsRes.data || [];
    const authUsers = (authUsersRes as any)?.data?.users || [];
    const authUserMap = new Map(authUsers.map((u: any) => [u.id, u.email]));

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
        staff: condoProfiles.map(p => ({
          id: p.id,
          name: p.name,
          phone: p.phone,
          email: authUserMap.get(p.id) || null,
          role: p.role,
        })),
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

// DELETE: Exclui uma conta de condomínio e todos os seus dados dependentes (cascata segura)
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

    // 1. Obter informações básicas do condomínio para log e confirmação
    const { data: condo, error: cFetchErr } = await supabaseAdmin
      .from('condos')
      .select('id, name')
      .eq('id', condoId)
      .maybeSingle();

    if (cFetchErr) {
      return NextResponse.json({ error: `Erro ao buscar condomínio: ${cFetchErr.message}` }, { status: 500 });
    }

    if (!condo) {
      return NextResponse.json({ error: 'Condomínio não encontrado ou já foi excluído.' }, { status: 404 });
    }

    // 2. Buscar todas as unidades pertencentes a este condomínio
    const { data: units } = await supabaseAdmin
      .from('units')
      .select('id')
      .eq('condo_id', condoId);

    const unitIds = (units || []).map((u) => u.id);

    // 3. Buscar todas as encomendas deste condomínio (ou das suas unidades)
    let packagesQuery = supabaseAdmin.from('packages').select('id, label_image_path, signature_image_path');
    if (unitIds.length > 0) {
      packagesQuery = packagesQuery.or(`condo_id.eq.${condoId},unit_id.in.(${unitIds.join(',')})`);
    } else {
      packagesQuery = packagesQuery.eq('condo_id', condoId);
    }
    const { data: packages } = await packagesQuery;

    // 4. Limpar arquivos de fotos e assinaturas no Supabase Storage (bucket 'packages')
    if (packages && packages.length > 0) {
      const storageFiles: string[] = [];
      for (const pkg of packages) {
        if (pkg.label_image_path) storageFiles.push(pkg.label_image_path);
        if (pkg.signature_image_path) storageFiles.push(pkg.signature_image_path);
      }
      if (storageFiles.length > 0) {
        try {
          await supabaseAdmin.storage.from('packages').remove(storageFiles);
        } catch (storageErr) {
          console.warn('[Super Admin API] Aviso ao remover fotos das encomendas no Storage:', storageErr);
        }
      }

      // 5. Excluir todas as encomendas (remove o RESTRICT com units e cascateia notifications_log)
      const pkgIds = packages.map((p) => p.id);
      const { error: pErr } = await supabaseAdmin.from('packages').delete().in('id', pkgIds);
      if (pErr) {
        console.error('[Super Admin API] Erro ao excluir encomendas:', pErr);
        return NextResponse.json(
          { error: `Falha ao remover encomendas do condomínio: ${pErr.message}` },
          { status: 500 }
        );
      }
    }

    // 6. Excluir moradores vinculados às unidades deste condomínio
    if (unitIds.length > 0) {
      const { error: resErr } = await supabaseAdmin
        .from('residents')
        .delete()
        .in('unit_id', unitIds);
      if (resErr) {
        console.warn('[Super Admin API] Aviso ao excluir moradores:', resErr);
      }

      // 7. Excluir as unidades do condomínio
      const { error: uErr } = await supabaseAdmin
        .from('units')
        .delete()
        .eq('condo_id', condoId);
      if (uErr) {
        console.error('[Super Admin API] Erro ao excluir unidades:', uErr);
        return NextResponse.json(
          { error: `Falha ao remover unidades do condomínio: ${uErr.message}` },
          { status: 500 }
        );
      }
    }

    // 8. Excluir pagamentos e comprovantes financeiros
    try {
      await supabaseAdmin.from('subscription_payments').delete().eq('condo_id', condoId);
    } catch {}

    // 9. Excluir assinaturas e licenças
    try {
      await supabaseAdmin.from('condo_subscriptions').delete().eq('condo_id', condoId);
    } catch {}

    try {
      await supabaseAdmin.from('licenses').delete().eq('condo_id', condoId);
    } catch {}

    // 10. Tratar perfis de usuários e contas Auth
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, role')
      .eq('condo_id', condoId);

    if (profiles && profiles.length > 0) {
      for (const prof of profiles) {
        if (prof.role !== 'SUPER_ADMIN') {
          try {
            await supabaseAdmin.from('profiles').delete().eq('id', prof.id);
            await supabaseAdmin.auth.admin.deleteUser(prof.id);
          } catch (authDelErr) {
            console.warn(`[Super Admin API] Não foi possível remover usuário auth ${prof.id}:`, authDelErr);
          }
        } else {
          // Se for SUPER_ADMIN, apenas desvincula do condomínio
          await supabaseAdmin.from('profiles').update({ condo_id: null }).eq('id', prof.id);
        }
      }
    }

    // 11. Excluir o condomínio propriamente dito
    const { error: dErr } = await supabaseAdmin.from('condos').delete().eq('id', condoId);
    if (dErr) {
      return NextResponse.json({ error: `Erro ao excluir condomínio: ${dErr.message}` }, { status: 500 });
    }

    // 12. Registrar no log de auditoria de segurança
    try {
      await supabaseAdmin.from('security_audit_logs').insert({
        user_id: authCheck.user?.id || null,
        action: 'CONDO_DELETED',
        entity_type: 'condos',
        entity_id: condoId,
        details: {
          name: condo.name,
          deleted_by: authCheck.user?.email || 'Super Admin',
          timestamp: new Date().toISOString(),
        },
      });
    } catch (auditErr) {
      console.warn('[Super Admin API] Aviso ao gravar security_audit_logs:', auditErr);
    }

    return NextResponse.json({ success: true, message: `Condomínio "${condo.name}" e seus dados foram excluídos com sucesso.` });
  } catch (error: any) {
    console.error('[Super Admin API] Erro ao excluir:', error);
    return NextResponse.json({ error: error.message || 'Erro interno.' }, { status: 500 });
  }
}

// PATCH: Permite ao Dono do SaaS alterar a senha de acesso de qualquer conta do condomínio (Síndico, Admin ou Porteiro)
export async function PATCH(request: Request) {
  try {
    const authCheck = await verifyAdminAuth(request);
    if ('error' in authCheck) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const body = await request.json();
    const { condoId, userId, newPassword } = body;

    if (!newPassword || typeof newPassword !== 'string' || newPassword.trim().length < 6) {
      return NextResponse.json({ error: 'A nova senha deve ter no mínimo 6 caracteres.' }, { status: 400 });
    }

    let targetUserId = userId;

    // Se o userId não foi enviado, busca o síndico ou administrador principal deste condomínio
    if (!targetUserId) {
      if (!condoId) {
        return NextResponse.json({ error: 'Informe o ID do condomínio ou o ID do usuário.' }, { status: 400 });
      }

      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id, role')
        .eq('condo_id', condoId)
        .in('role', ['ADMIN', 'SYNDIC'])
        .maybeSingle();

      if (!profile) {
        const { data: anyProfile } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('condo_id', condoId)
          .maybeSingle();

        targetUserId = anyProfile?.id;
      } else {
        targetUserId = profile.id;
      }
    }

    if (!targetUserId) {
      return NextResponse.json({ error: 'Nenhum usuário encontrado para alterar senha neste condomínio.' }, { status: 404 });
    }

    // 1. Atualiza a senha no Supabase Auth usando as permissões de Service Role Admin
    const { data: updateRes, error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(
      targetUserId,
      { password: newPassword.trim() }
    );

    if (updateErr) {
      console.error('[Super Admin API] Erro ao atualizar senha no Auth:', updateErr);
      return NextResponse.json({ error: `Erro ao atualizar senha no Supabase Auth: ${updateErr.message}` }, { status: 500 });
    }

    // 2. Busca o nome do usuário alterado para log de auditoria
    const { data: targetProfile } = await supabaseAdmin
      .from('profiles')
      .select('name, role')
      .eq('id', targetUserId)
      .maybeSingle();

    // 3. Registra na trilha de auditoria
    try {
      await supabaseAdmin.from('security_audit_logs').insert({
        user_id: authCheck.user?.id || null,
        action: 'PASSWORD_RESET_BY_SUPERADMIN',
        entity_type: 'users',
        entity_id: targetUserId,
        details: {
          target_email: updateRes?.user?.email || null,
          target_name: targetProfile?.name || null,
          target_role: targetProfile?.role || null,
          condo_id: condoId || null,
          changed_by: authCheck.user?.email || 'Super Admin',
          timestamp: new Date().toISOString(),
        },
      });
    } catch (auditErr) {
      console.warn('[Super Admin API] Aviso ao gravar log de troca de senha:', auditErr);
    }

    return NextResponse.json({
      success: true,
      message: 'Senha alterada com sucesso!',
      user: {
        id: updateRes.user.id,
        email: updateRes.user.email,
        name: targetProfile?.name || null
      }
    });
  } catch (error: any) {
    console.error('[Super Admin API] Erro no PATCH de troca de senha:', error);
    return NextResponse.json({ error: error.message || 'Erro interno ao alterar senha.' }, { status: 500 });
  }
}


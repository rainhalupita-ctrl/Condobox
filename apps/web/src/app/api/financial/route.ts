import { NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

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

// Helper para garantir UUID válido na coluna entity_id
function toUuid(id?: string | null): string | null {
  if (!id) return null;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id) ? id : null;
}

// Verifica se o usuário autenticado é Sócio Proprietário (Master Admin)
async function verifyAdminAuth(request?: Request) {
  const supabaseAdmin = getSupabaseAdmin();
  let user: any = null;

  // 1. Bearer token no cabeçalho
  const authHeader = request?.headers.get('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.replace(/^bearer\s+/i, '').trim();
    if (token) {
      const { data: uData } = await supabaseAdmin.auth.getUser(token);
      if (uData?.user) user = uData.user;
    }
  }

  // 2. Cookies da sessão
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
    return { error: 'Acesso negado. Apenas o Sócio Proprietário tem acesso à Gestão Financeira.', status: 403 };
  }

  return { user, profile };
}

// GET: Retorna métricas financeiras, assinantes e lista de pagamentos/comprovantes
export async function GET(request: Request) {
  try {
    const authCheck = await verifyAdminAuth(request);
    if ('error' in authCheck) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const currentMonth = new Date().toISOString().slice(0, 7); // Ex: '2026-09'

    // 1. Busca todos os condomínios
    const { data: condos } = await supabaseAdmin
      .from('condos')
      .select('*')
      .order('created_at', { ascending: false });

    // 2. Busca todas as licenças
    const { data: licenses } = await supabaseAdmin
      .from('licenses')
      .select('*');

    // 3. Tenta buscar pagamentos na tabela subscription_payments
    let payments: any[] = [];
    const { data: payData, error: payErr } = await supabaseAdmin
      .from('subscription_payments')
      .select('*')
      .order('created_at', { ascending: false });

    if (!payErr && payData) {
      payments = payData;
    } else {
      // Fallback inteligente: busca pagamentos registrados em security_audit_logs
      const { data: auditPayments } = await supabaseAdmin
        .from('security_audit_logs')
        .select('*')
        .eq('entity_type', 'subscription_payment')
        .order('created_at', { ascending: false });

      if (auditPayments) {
        payments = auditPayments.map(p => ({
          id: p.id,
          condo_id: p.entity_id,
          amount: p.details?.amount || 149.00,
          reference_month: p.details?.reference_month || currentMonth,
          status: p.details?.status || 'PENDING',
          due_date: p.details?.due_date,
          paid_at: p.details?.paid_at,
          receipt_url: p.details?.receipt_url,
          receipt_filename: p.details?.receipt_filename,
          sender_notes: p.details?.sender_notes,
          reviewer_notes: p.details?.reviewer_notes,
          reviewed_by: p.details?.reviewed_by,
          reviewed_at: p.details?.reviewed_at,
          days_extended: p.details?.days_extended || 30,
          created_at: p.created_at,
        }));
      }
    }

    // 4. Busca preços customizados salvos em audit_logs (caso a coluna ainda não exista em licenses)
    const { data: customPriceLogs } = await supabaseAdmin
      .from('security_audit_logs')
      .select('*')
      .eq('action', 'condo_monthly_price')
      .order('created_at', { ascending: false });

    const customPriceMap = new Map<string, { price: number; billing_day: number }>();
    (customPriceLogs || []).forEach(log => {
      if (log.entity_id && !customPriceMap.has(log.entity_id)) {
        customPriceMap.set(log.entity_id, {
          price: Number(log.details?.monthly_price) || 149.00,
          billing_day: Number(log.details?.billing_day) || 10,
        });
      }
    });

    // 5. Busca configuração de cobrança padrão (PIX)
    let billingSettings = {
      pix_key: '73998419901',
      pix_key_type: 'PHONE',
      beneficiary_name: 'CondoBox Tecnologia e Soluções',
      bank_name: 'Banco Inter / NuBank',
      instructions: 'Ao efetuar o Pix, anexe o comprovante no sistema para análise e liberação imediata.',
    };

    const { data: bData } = await supabaseAdmin
      .from('saas_billing_settings')
      .select('*')
      .eq('id', 'default')
      .maybeSingle();

    if (bData) {
      billingSettings = { ...billingSettings, ...bData };
    } else {
      // Fallback em audit_logs para settings
      const { data: auditSetting } = await supabaseAdmin
        .from('security_audit_logs')
        .select('*')
        .eq('action', 'saas_billing_settings')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (auditSetting?.details) {
        billingSettings = { ...billingSettings, ...auditSetting.details };
      }
    }

    // 6. Mapeamento consolidado dos condomínios como assinantes Netflix
    const subscribers = (condos || []).map(condo => {
      const lic = (licenses || []).find(l => l.condo_id === condo.id) || null;
      const customPriceData = customPriceMap.get(condo.id);
      
      const monthlyPrice = lic?.monthly_price 
        ? Number(lic.monthly_price) 
        : (customPriceData?.price ?? (lic?.plan === 'PRO_MAX' ? 449 : lic?.plan === 'PRO' ? 249 : 149));

      const billingDay = lic?.billing_day 
        ? Number(lic.billing_day) 
        : (customPriceData?.billing_day ?? 10);

      let isExpired = false;
      if (lic?.expires_at) {
        isExpired = new Date(lic.expires_at).getTime() <= Date.now();
      }

      // Pagamento mais recente deste condomínio
      const condoPayments = payments.filter(p => p.condo_id === condo.id);
      const latestPayment = condoPayments[0] || null;
      const pendingReceipt = condoPayments.find(p => p.status === 'UNDER_REVIEW') || null;

      let subscriptionStatus: 'ACTIVE' | 'EXPIRED' | 'UNDER_REVIEW' | 'TRIAL' | 'BLOCKED' = 'ACTIVE';
      if (pendingReceipt) {
        subscriptionStatus = 'UNDER_REVIEW';
      } else if (lic?.status === 'BLOCKED') {
        subscriptionStatus = 'BLOCKED';
      } else if (lic?.status === 'EXPIRED' || isExpired) {
        subscriptionStatus = 'EXPIRED';
      } else if (lic?.status === 'TRIAL' || lic?.plan === 'TRIAL') {
        subscriptionStatus = 'TRIAL';
      }

      return {
        id: condo.id,
        name: condo.name,
        address: condo.address,
        phone: condo.phone,
        license: lic,
        monthly_price: monthlyPrice,
        billing_day: billingDay,
        subscription_status: subscriptionStatus,
        is_expired: isExpired,
        expires_at: lic?.expires_at || null,
        latest_payment: latestPayment,
        has_pending_receipt: Boolean(pendingReceipt),
        pending_receipt: pendingReceipt,
      };
    });

    // 7. Cálculo das Métricas Financeiras Executivas
    const activeSubscribers = subscribers.filter(s => s.subscription_status === 'ACTIVE' || s.subscription_status === 'TRIAL');
    const realMRR = subscribers
      .filter(s => s.subscription_status === 'ACTIVE')
      .reduce((sum, s) => sum + s.monthly_price, 0);

    const pendingReceipts = payments.filter(p => p.status === 'UNDER_REVIEW');
    const approvedMonthPayments = payments.filter(p => p.status === 'PAID' && (p.reference_month === currentMonth || (p.paid_at && p.paid_at.startsWith(currentMonth))));
    const totalReceivedMonth = approvedMonthPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

    const overdueSubscribers = subscribers.filter(s => s.subscription_status === 'EXPIRED' || s.subscription_status === 'BLOCKED');
    const overdueTotalAmount = overdueSubscribers.reduce((sum, s) => sum + s.monthly_price, 0);

    const financialMetrics = {
      real_mrr: realMRR,
      total_subscribers: subscribers.length,
      active_subscribers_count: activeSubscribers.length,
      overdue_subscribers_count: overdueSubscribers.length,
      overdue_total_amount: overdueTotalAmount,
      total_received_month: totalReceivedMonth,
      pending_receipts_count: pendingReceipts.length,
      current_month: currentMonth,
    };

    return NextResponse.json({
      success: true,
      metrics: financialMetrics,
      subscribers,
      pending_receipts: pendingReceipts,
      payments,
      billing_settings: billingSettings,
    });
  } catch (error: any) {
    console.error('[Financial API] Erro ao carregar dados:', error);
    return NextResponse.json({ error: error.message || 'Erro interno do servidor.' }, { status: 500 });
  }
}

// POST: Ações financeiras do Sócio Proprietário
export async function POST(request: Request) {
  try {
    const authCheck = await verifyAdminAuth(request);
    if ('error' in authCheck) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const { user } = authCheck;
    const body = await request.json();
    const { action } = body;
    const supabaseAdmin = getSupabaseAdmin();

    // ─── AÇÃO 1: DEFINIR VALOR MENSAL E VENCIMENTO DO CONDOMÍNIO ──────────────
    if (action === 'SET_CONDO_PRICE') {
      const { condoId, monthlyPrice, billingDay } = body;
      if (!condoId || monthlyPrice === undefined) {
        return NextResponse.json({ error: 'Condomínio e valor mensal são obrigatórios.' }, { status: 400 });
      }

      const cleanPrice = Number(monthlyPrice);
      const cleanDay = Number(billingDay) || 10;

      // 1. Tenta atualizar na tabela licenses
      try {
        await supabaseAdmin
          .from('licenses')
          .update({
            monthly_price: cleanPrice,
            billing_day: cleanDay,
            updated_at: new Date().toISOString(),
          })
          .eq('condo_id', condoId);
      } catch {}

      // 2. Registra em security_audit_logs como garantia de persistência dupla
      await supabaseAdmin.from('security_audit_logs').insert({
        user_id: user.id,
        action: 'condo_monthly_price',
        entity_type: 'condo',
        entity_id: toUuid(condoId) || '00000000-0000-0000-0000-000000000001',
        details: {
          monthly_price: cleanPrice,
          billing_day: cleanDay,
          updated_by: user.email,
          updated_at: new Date().toISOString(),
        },
      });

      return NextResponse.json({
        success: true,
        message: `Valor mensal atualizado com sucesso para R$ ${cleanPrice.toFixed(2)} (vencimento dia ${cleanDay})!`,
      });
    }

    // ─── AÇÃO 2: ANALISAR E APROVAR / REJEITAR COMPROVANTE ───────────────────
    if (action === 'REVIEW_RECEIPT') {
      const { paymentId, condoId, approved, daysToExtend, reviewerNotes } = body;

      if (!condoId) {
        return NextResponse.json({ error: 'ID do condomínio é obrigatório.' }, { status: 400 });
      }

      const now = new Date();
      const extendedDays = Number(daysToExtend) || 30;

      if (approved) {
        // 1. Busca a licença atual do condomínio para calcular nova data de expiração
        const { data: lic } = await supabaseAdmin
          .from('licenses')
          .select('*')
          .eq('condo_id', condoId)
          .maybeSingle();

        let baseDate = now.getTime();
        // Se a licença ainda estava no futuro, soma os dias a partir da data futura
        if (lic?.expires_at) {
          const currentExp = new Date(lic.expires_at).getTime();
          if (currentExp > now.getTime()) {
            baseDate = currentExp;
          }
        }

        const newExpiresAt = new Date(baseDate + extendedDays * 86400000).toISOString();

        // 2. Atualiza a licença para ACTIVE e estende a validade
        await supabaseAdmin
          .from('licenses')
          .update({
            status: 'ACTIVE',
            expires_at: newExpiresAt,
            updated_at: now.toISOString(),
          })
          .eq('condo_id', condoId);

        // 3. Atualiza o status do pagamento na tabela subscription_payments
        try {
          if (paymentId) {
            await supabaseAdmin
              .from('subscription_payments')
              .update({
                status: 'PAID',
                paid_at: now.toISOString(),
                reviewed_by: user.email,
                reviewed_at: now.toISOString(),
                reviewer_notes: reviewerNotes || 'Comprovante verificado e aprovado pelo Sócio Proprietário.',
                days_extended: extendedDays,
                updated_at: now.toISOString(),
              })
              .eq('id', paymentId);
          }
        } catch {}

        // 4. Registra log de aprovação
        await supabaseAdmin.from('security_audit_logs').insert({
          user_id: user.id,
          action: 'financial_receipt_approved',
          entity_type: 'subscription_payment',
          entity_id: toUuid(condoId) || '00000000-0000-0000-0000-000000000001',
          details: {
            payment_id: paymentId,
            status: 'PAID',
            days_extended: extendedDays,
            new_expires_at: newExpiresAt,
            reviewed_by: user.email,
            reviewer_notes: reviewerNotes,
            approved_at: now.toISOString(),
          },
        });

        return NextResponse.json({
          success: true,
          message: `Comprovante aprovado com sucesso! Condomínio desbloqueado e vigência estendida até ${new Date(newExpiresAt).toLocaleDateString('pt-BR')}.`,
        });
      } else {
        // Rejeitar comprovante
        const rejectionReason = reviewerNotes || 'Comprovante não aprovado. Verifique os dados ou entre em contato com o suporte.';

        try {
          if (paymentId) {
            await supabaseAdmin
              .from('subscription_payments')
              .update({
                status: 'REJECTED',
                reviewed_by: user.email,
                reviewed_at: now.toISOString(),
                reviewer_notes: rejectionReason,
                updated_at: now.toISOString(),
              })
              .eq('id', paymentId);
          }
        } catch {}

        await supabaseAdmin.from('security_audit_logs').insert({
          user_id: user.id,
          action: 'financial_receipt_rejected',
          entity_type: 'subscription_payment',
          entity_id: toUuid(condoId) || '00000000-0000-0000-0000-000000000001',
          details: {
            payment_id: paymentId,
            status: 'REJECTED',
            reviewer_notes: rejectionReason,
            reviewed_by: user.email,
            rejected_at: now.toISOString(),
          },
        });

        return NextResponse.json({
          success: true,
          message: 'Comprovante rejeitado com sucesso. O condomínio foi notificado.',
        });
      }
    }

    // ─── AÇÃO 3: ATUALIZAR CONFIGURAÇÃO DE COBRANÇA (CHAVE PIX) ───────────────
    if (action === 'UPDATE_BILLING_SETTINGS') {
      const { pixKey, pixKeyType, beneficiaryName, bankName, instructions } = body;

      const payload = {
        pix_key: pixKey || '73998419901',
        pix_key_type: pixKeyType || 'PHONE',
        beneficiary_name: beneficiaryName || 'CondoBox Tecnologia e Soluções',
        bank_name: bankName || 'Banco Inter / NuBank',
        instructions: instructions || 'Ao efetuar o Pix, anexe o comprovante no sistema para análise e liberação imediata.',
        updated_at: new Date().toISOString(),
      };

      try {
        await supabaseAdmin
          .from('saas_billing_settings')
          .upsert({ id: 'default', ...payload });
      } catch {}

      await supabaseAdmin.from('security_audit_logs').insert({
        user_id: user.id,
        action: 'saas_billing_settings',
        entity_type: 'system',
        entity_id: '00000000-0000-0000-0000-000000000000',
        details: payload,
      });

      return NextResponse.json({
        success: true,
        message: 'Dados de pagamento e Chave Pix atualizados com sucesso!',
      });
    }

    return NextResponse.json({ error: 'Ação não reconhecida.' }, { status: 400 });
  } catch (error: any) {
    console.error('[Financial API POST] Erro:', error);
    return NextResponse.json({ error: error.message || 'Erro interno do servidor.' }, { status: 500 });
  }
}

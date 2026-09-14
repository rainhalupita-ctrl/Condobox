import { NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

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
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const condoId = url.searchParams.get('condoId');
    const supabaseAdmin = getSupabaseAdmin();

    // 1. Busca configurações de PIX
    let pixSettings = {
      pixKey: '73998419901',
      pixKeyType: 'PHONE',
      pixName: 'CondoBox Tecnologia e Soluções',
      pixBank: 'Banco Inter / NuBank',
      instructions: 'Ao efetuar o Pix, anexe o comprovante no sistema para análise e liberação imediata.',
    };

    try {
      const { data: bData } = await supabaseAdmin
        .from('saas_billing_settings')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (bData) {
        pixSettings = {
          pixKey: bData.pix_key || pixSettings.pixKey,
          pixKeyType: bData.pix_key_type || pixSettings.pixKeyType,
          pixName: bData.beneficiary_name || pixSettings.pixName,
          pixBank: bData.bank_name || pixSettings.pixBank,
          instructions: bData.instructions || pixSettings.instructions,
        };
      }
    } catch {}

    if (!condoId) {
      return NextResponse.json({ latestReceipt: null, pixSettings });
    }

    // 2. Busca último comprovante / pagamento deste condomínio
    let latestReceipt: any = null;
    const { data: payData } = await supabaseAdmin
      .from('subscription_payments')
      .select('*')
      .eq('condo_id', condoId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (payData) {
      latestReceipt = payData;
    } else {
      const { data: auditData } = await supabaseAdmin
        .from('security_audit_logs')
        .select('*')
        .eq('entity_type', 'subscription_payment')
        .eq('entity_id', condoId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (auditData) {
        latestReceipt = {
          id: auditData.id,
          condo_id: auditData.entity_id,
          status: auditData.details?.status || 'PENDING',
          amount: auditData.details?.amount || 149,
          reference_month: auditData.details?.reference_month,
          receipt_url: auditData.details?.receipt_url,
          created_at: auditData.created_at,
        };
      }
    }

    return NextResponse.json({ latestReceipt, pixSettings });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Erro ao consultar comprovante' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const contentType = request.headers.get('content-type') || '';
    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7);

    let condoId = '';
    let amount = 149.0;
    let referenceMonth = currentMonth;
    let senderNotes = '';
    let fileBuffer: Buffer | null = null;
    let fileExt = 'png';
    let mimeType = 'image/png';
    let originalName = 'comprovante.png';

    if (contentType.includes('application/json')) {
      const body = await request.json();
      condoId = body.condoId;
      amount = Number(body.amount) || 149.0;
      referenceMonth = body.referenceMonth || currentMonth;
      senderNotes = body.senderNotes || '';
      originalName = body.filename || 'comprovante.png';

      if (body.receiptBase64) {
        const base64Match = body.receiptBase64.match(/^data:([^;]+);base64,(.+)$/);
        if (base64Match) {
          mimeType = base64Match[1];
          fileBuffer = Buffer.from(base64Match[2], 'base64');
          if (mimeType.includes('pdf')) fileExt = 'pdf';
          else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) fileExt = 'jpg';
          else if (mimeType.includes('webp')) fileExt = 'webp';
          else fileExt = 'png';
        } else {
          fileBuffer = Buffer.from(body.receiptBase64, 'base64');
        }
      }
    } else if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      condoId = (formData.get('condoId') as string) || '';
      amount = Number(formData.get('amount')) || 149.0;
      referenceMonth = (formData.get('referenceMonth') as string) || currentMonth;
      senderNotes = (formData.get('senderNotes') as string) || '';

      const file = formData.get('file') as File | null;
      if (file) {
        originalName = file.name;
        mimeType = file.type || 'image/png';
        fileExt = file.name.split('.').pop() || 'png';
        const bytes = await file.arrayBuffer();
        fileBuffer = Buffer.from(bytes);
      }
    }

    if (!condoId) {
      return NextResponse.json({ error: 'ID do condomínio é obrigatório.' }, { status: 400 });
    }

    if (!fileBuffer) {
      return NextResponse.json({ error: 'Arquivo do comprovante é obrigatório.' }, { status: 400 });
    }

    // 1. Gera nome único e faz upload para o bucket 'receipts'
    const safeCondoId = condoId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const filename = `${safeCondoId}_${referenceMonth}_${timestamp}_${randomSuffix}.${fileExt}`;
    let receiptUrl = '';

    try {
      const { data: uploadData, error: uploadErr } = await supabaseAdmin.storage
        .from('receipts')
        .upload(filename, fileBuffer, {
          contentType: mimeType,
          upsert: true,
        });

      if (!uploadErr && uploadData) {
        const { data: pubData } = supabaseAdmin.storage.from('receipts').getPublicUrl(filename);
        if (pubData?.publicUrl) {
          receiptUrl = pubData.publicUrl;
        }
      }
    } catch (err: any) {
      console.warn('[Receipt Upload] Falha no storage:', err.message);
    }

    // Se o upload público não gerou URL ou falhou, usa fallback de Data URL segura para imagem pequena
    if (!receiptUrl) {
      if (fileBuffer.length <= 500 * 1024) {
        receiptUrl = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
      } else {
        receiptUrl = `https://storage.condobox.app/receipts/${filename}`;
      }
    }

    // 2. Busca dados de preço do condomínio para conferência
    try {
      const { data: lic } = await supabaseAdmin
        .from('licenses')
        .select('monthly_price')
        .eq('condo_id', condoId)
        .maybeSingle();

      if (lic?.monthly_price) {
        amount = Number(lic.monthly_price);
      }
    } catch {}

    const paymentRecordId = crypto.randomUUID();

    // 3. Tenta salvar na tabela subscription_payments
    let savedInTable = false;
    try {
      const { error: insErr } = await supabaseAdmin
        .from('subscription_payments')
        .insert({
          id: paymentRecordId,
          condo_id: condoId,
          amount: amount,
          reference_month: referenceMonth,
          status: 'UNDER_REVIEW',
          paid_at: now.toISOString(),
          receipt_url: receiptUrl,
          receipt_filename: originalName,
          sender_notes: senderNotes,
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
        });

      if (!insErr) savedInTable = true;
    } catch {}

    // 4. Salva em security_audit_logs como garantia de persistência dupla
    await supabaseAdmin.from('security_audit_logs').insert({
      action: 'financial_payment_record',
      entity_type: 'subscription_payment',
      entity_id: toUuid(condoId) || '00000000-0000-0000-0000-000000000001',
      details: {
        id: paymentRecordId,
        condo_id: condoId,
        amount: amount,
        reference_month: referenceMonth,
        status: 'UNDER_REVIEW',
        paid_at: now.toISOString(),
        receipt_url: receiptUrl,
        receipt_filename: originalName,
        sender_notes: senderNotes,
        created_at: now.toISOString(),
      },
    });

    return NextResponse.json({
      success: true,
      paymentId: paymentRecordId,
      receiptUrl: receiptUrl,
      status: 'UNDER_REVIEW',
      message: 'Comprovante enviado com sucesso! Está em análise pelo Sócio Proprietário para desbloqueio da sua conta.',
    });
  } catch (error: any) {
    console.error('[Receipt Upload Route] Erro:', error);
    return NextResponse.json({ error: error.message || 'Erro ao processar comprovante.' }, { status: 500 });
  }
}

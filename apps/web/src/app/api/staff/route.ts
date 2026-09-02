import { NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient } from '../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.user) {
      return NextResponse.json({ error: 'Não autorizado. Você precisa estar logado.' }, { status: 401 });
    }

    const { data: adminProfile } = await supabase
      .from('profiles')
      .select('condo_id, role')
      .eq('id', session.user.id)
      .single();

    if (!adminProfile || (adminProfile.role !== 'ADMIN' && adminProfile.role !== 'SYNDIC')) {
      return NextResponse.json({ error: 'Acesso negado. Apenas síndicos ou admins podem criar equipe.' }, { status: 403 });
    }

    const condoId = adminProfile.condo_id;
    if (!condoId) {
      return NextResponse.json({ error: 'Seu usuário não possui um ID de condomínio vinculado.' }, { status: 400 });
    }

    const { name, email, phone, password, role } = await request.json();

    if (!name || !email || !password || !role) {
      return NextResponse.json(
        { error: 'Todos os campos obrigatórios devem ser preenchidos.' },
        { status: 400 }
      );
    }

    const cleanPhone = (phone || '').replace(/\D/g, '');
    const cleanEmail = email.trim().toLowerCase();
    const supabaseAdmin = getSupabaseAdmin();

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: cleanEmail,
      password: password,
      email_confirm: true,
      user_metadata: {
        name,
        phone: cleanPhone,
        role: role,
        condo_id: condoId
      },
    });

    let userId = authData?.user?.id;

    if (authError) {
      if (authError.message.includes('already registered') || authError.message.includes('already exists') || authError.message.includes('email_address_invalid')) {
        return NextResponse.json(
          { error: 'Este e-mail já está cadastrado ou é inválido.' },
          { status: 409 }
        );
      }
      console.error('[Staff API] Erro no auth admin:', authError);
      return NextResponse.json(
        { error: authError.message || 'Erro ao criar credenciais de acesso.' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json({ error: 'Não foi possível gerar a identificação do usuário.' }, { status: 500 });
    }

    // Force updates profiles with condo_id via admin client
    await supabaseAdmin
      .from('profiles')
      .upsert({
        id: userId,
        name,
        phone: cleanPhone,
        role: role,
        condo_id: condoId
      }, { onConflict: 'id' });

    return NextResponse.json({
      success: true,
      userId,
      message: `Conta de ${role === 'GUARD' ? 'Porteiro' : 'Síndico'} criada com sucesso para ${name}!`,
    });
  } catch (error: any) {
    console.error('[Staff API] Erro interno:', error);
    return NextResponse.json(
      { error: error.message || 'Erro interno no servidor ao processar o cadastro.' },
      { status: 500 }
    );
  }
}

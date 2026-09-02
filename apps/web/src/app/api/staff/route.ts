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
      const msg = (authError.message || '').toLowerCase();
      if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('email_address_invalid') || msg.includes('unique')) {
        return NextResponse.json(
          { error: 'Este e-mail já está em uso por outra conta no sistema.' },
          { status: 409 }
        );
      }
      console.error('[Staff API] Erro no auth admin:', authError);
      return NextResponse.json(
        { error: 'Erro no servidor: ' + (authError.message || 'Falha ao criar credenciais.') },
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

export async function DELETE(request: Request) {
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
      return NextResponse.json({ error: 'Acesso negado. Apenas síndicos ou admins podem gerenciar equipe.' }, { status: 403 });
    }

    const url = new URL(request.url);
    const userIdToDelete = url.searchParams.get('userId');

    if (!userIdToDelete) {
      return NextResponse.json({ error: 'ID do usuário não fornecido.' }, { status: 400 });
    }

    // Não permitir deletar a própria conta
    if (userIdToDelete === session.user.id) {
      return NextResponse.json({ error: 'Você não pode excluir sua própria conta.' }, { status: 400 });
    }

    // Verificar se o usuário a ser deletado pertence ao mesmo condomínio
    const supabaseAdmin = getSupabaseAdmin();
    const { data: userToDelete } = await supabaseAdmin
      .from('profiles')
      .select('condo_id, role')
      .eq('id', userIdToDelete)
      .single();

    if (!userToDelete || userToDelete.condo_id !== adminProfile.condo_id) {
      return NextResponse.json({ error: 'Usuário não encontrado ou não pertence ao seu condomínio.' }, { status: 404 });
    }

    // Deletar o usuário do Auth (isso deve disparar exclusão em cascata nas profiles se houver fk configurada com ON DELETE CASCADE, caso contrário deletamos manualmente)
    // Deletar do profiles primeiro para garantir
    await supabaseAdmin.from('profiles').delete().eq('id', userIdToDelete);

    // Deletar do auth.users
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userIdToDelete);

    if (deleteError) {
      console.error('[Staff API] Erro ao deletar usuário no auth admin:', deleteError);
      return NextResponse.json({ error: 'Erro ao excluir credenciais do usuário.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Conta excluída com sucesso.' });
  } catch (error: any) {
    console.error('[Staff API] Erro interno no DELETE:', error);
    return NextResponse.json(
      { error: error.message || 'Erro interno no servidor ao excluir a conta.' },
      { status: 500 }
    );
  }
}

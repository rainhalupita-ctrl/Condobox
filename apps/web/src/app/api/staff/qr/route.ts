import { NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient } from '../../../../lib/supabase/server';

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

export async function GET(request: Request) {
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
      return NextResponse.json({ error: 'Acesso negado. Apenas síndicos ou admins podem gerar códigos de acesso.' }, { status: 403 });
    }

    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'ID do usuário não fornecido.' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    
    // Verificar se o usuário pertence ao condomínio do admin
    const { data: targetProfile } = await supabaseAdmin
      .from('profiles')
      .select('condo_id, role')
      .eq('id', userId)
      .single();
      
    if (!targetProfile || targetProfile.condo_id !== adminProfile.condo_id) {
      return NextResponse.json({ error: 'Usuário não encontrado ou não pertence ao seu condomínio.' }, { status: 404 });
    }

    // Buscar o e-mail do usuário no auth.users
    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);
    
    if (userError || !userData?.user?.email) {
      return NextResponse.json({ error: 'Não foi possível encontrar o e-mail deste usuário.' }, { status: 404 });
    }
    
    const userEmail = userData.user.email;

    // Gerar magic link
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: userEmail,
      options: {
        redirectTo: process.env.NEXT_PUBLIC_LOCAL_API_URL 
          ? 'http://localhost:3000/login/callback' // Em dev ou localhost portaria
          : undefined // Deixa o padrão do Supabase se estiver no Vercel
      }
    });

    if (linkError || !linkData?.properties?.action_link) {
      console.error('[Staff QR API] Erro ao gerar link:', linkError);
      return NextResponse.json({ error: 'Falha ao gerar o link de acesso.' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      actionLink: linkData.properties.action_link
    });

  } catch (error: any) {
    console.error('[Staff QR API] Erro interno:', error);
    return NextResponse.json(
      { error: error.message || 'Erro interno no servidor ao gerar link.' },
      { status: 500 }
    );
  }
}

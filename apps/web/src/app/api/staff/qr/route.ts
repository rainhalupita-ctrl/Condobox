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

    const userEmail = (session.user.email || '').toLowerCase();
    const superAdminEmails = (process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAILS || 'rainhalupita@gmail.com,klebervenancio2002@icloud.com')
      .split(',')
      .map(e => e.trim().toLowerCase());
    const isSuperAdmin = adminProfile?.role === 'ADMIN' || (!!userEmail && superAdminEmails.includes(userEmail));

    if (!isSuperAdmin && (!adminProfile || adminProfile.role !== 'SYNDIC')) {
      return NextResponse.json({ error: 'Acesso negado. Apenas síndicos ou administradores podem gerar códigos de acesso.' }, { status: 403 });
    }

    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'ID do usuário não fornecido.' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    
    // Buscar o perfil do usuário alvo
    const { data: targetProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, condo_id, role, name')
      .eq('id', userId)
      .single();
      
    if (!targetProfile) {
      return NextResponse.json({ error: 'Usuário não encontrado no sistema.' }, { status: 404 });
    }

    // Se não for Super Admin, o usuário precisa obrigatoriamente pertencer ao condomínio do síndico
    if (!isSuperAdmin && targetProfile.condo_id !== adminProfile?.condo_id) {
      return NextResponse.json({ error: 'Usuário não pertence ao seu condomínio.' }, { status: 403 });
    }

    // Buscar o e-mail do usuário no auth.users
    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);
    
    if (userError || !userData?.user?.email) {
      return NextResponse.json({ error: 'Não foi possível encontrar o e-mail deste usuário.' }, { status: 404 });
    }
    
    const targetEmail = userData.user.email;

    // Gerar magic link e OTP
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: targetEmail
    });

    if (linkError || !linkData?.properties) {
      console.error('[Staff QR API] Erro ao gerar link:', linkError);
      return NextResponse.json({ error: 'Falha ao gerar o link de acesso.' }, { status: 500 });
    }

    // Determinar a URL base da requisição de forma resiliente
    const reqOrigin = request.headers.get('origin') 
      || (request.headers.get('referer') ? new URL(request.headers.get('referer')!).origin : null)
      || process.env.NEXT_PUBLIC_APP_URL 
      || 'https://web-eight-rust-97.vercel.app';

    // Determinar destino pós-login de acordo com o papel do membro
    const targetDest = targetProfile.role === 'SYNDIC' ? '/admin' : '/portaria';
    
    // Se temos o OTP (código numérico do magiclink), montamos o link direto para o /auth/callback
    // garantindo que nunca seja redirecionado indevidamente para localhost:3000 pelo Supabase
    const otp = linkData.properties.email_otp;
    const directActionLink = otp
      ? `${reqOrigin}/auth/callback?token=${otp}&email=${encodeURIComponent(targetEmail)}&next=${encodeURIComponent(targetDest)}`
      : (linkData.properties.action_link || `${reqOrigin}/portaria/login`);

    return NextResponse.json({
      success: true,
      actionLink: directActionLink,
      otp: otp || null
    });

  } catch (error: any) {
    console.error('[Staff QR API] Erro interno:', error);
    return NextResponse.json(
      { error: error.message || 'Erro interno no servidor ao gerar link.' },
      { status: 500 }
    );
  }
}

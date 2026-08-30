import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://isurnvsehvjdslpnxirn.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy',
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
    const supabaseAdmin = getSupabaseAdmin();
    const { name, email, phone, password, unitId } = await request.json();

    if (!name || !email || !password || !unitId) {
      return NextResponse.json(
        { error: 'Todos os campos obrigatórios devem ser preenchidos.' },
        { status: 400 }
      );
    }

    const cleanPhone = (phone || '').replace(/\D/g, '');
    const cleanEmail = email.trim().toLowerCase();

    // 1. Criar usuário direto no Supabase Auth via Admin (sem travas de SMTP e com e-mail auto-confirmado)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: cleanEmail,
      password: password,
      email_confirm: true, // Já cria confirmado instantaneamente
      user_metadata: {
        name,
        phone: cleanPhone,
        role: 'RESIDENT',
      },
    });

    let userId = authData?.user?.id;

    if (authError) {
      // Se o usuário já existe no Auth
      if (authError.message.includes('already registered') || authError.message.includes('already exists')) {
        return NextResponse.json(
          { error: 'Este e-mail já está cadastrado no sistema. Faça login para continuar.' },
          { status: 409 }
        );
      }

      console.error('[Register API] Erro no auth admin:', authError);
      return NextResponse.json(
        { error: authError.message || 'Erro ao criar credenciais de acesso.' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'Não foi possível gerar a identificação do usuário.' },
        { status: 500 }
      );
    }

    // 2. Garantir perfil no public.profiles
    await supabaseAdmin
      .from('profiles')
      .upsert({
        id: userId,
        name,
        phone: cleanPhone,
        role: 'RESIDENT',
      }, { onConflict: 'id' });

    // 3. Vincular ou atualizar registro na tabela residents
    const { data: existingRes } = await supabaseAdmin
      .from('residents')
      .select('id')
      .or(`user_id.eq.${userId},phone.eq.${cleanPhone}`)
      .maybeSingle();

    if (existingRes) {
      await supabaseAdmin
        .from('residents')
        .update({
          unit_id: unitId,
          user_id: userId,
          name,
          phone: cleanPhone,
          email: cleanEmail,
          active: true,
          is_primary: true,
          is_authorized_receiver: true,
        })
        .eq('id', existingRes.id);
    } else {
      await supabaseAdmin.from('residents').insert({
        unit_id: unitId,
        user_id: userId,
        name,
        phone: cleanPhone,
        email: cleanEmail,
        is_primary: true,
        is_authorized_receiver: true,
        active: true,
      });
    }

    return NextResponse.json({
      success: true,
      userId,
      message: 'Cadastro de morador realizado com sucesso!',
    });
  } catch (error: any) {
    console.error('[Register API] Erro interno:', error);
    return NextResponse.json(
      { error: error.message || 'Erro interno no servidor ao processar o cadastro.' },
      { status: 500 }
    );
  }
}

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const token = searchParams.get('token');
  const email = searchParams.get('email');
  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const code = searchParams.get('code');
  const next = searchParams.get('next') || '/portaria';

  // Garantir que o destino é uma rota relativa válida
  const targetPath = next.startsWith('/') ? next : '/portaria';
  const redirectResponse = NextResponse.redirect(new URL(targetPath, origin));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            redirectResponse.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  try {
    // 1. Verificação por OTP direto (email + token OTP gerado pelo QR Code da equipe)
    if (email && token) {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token,
        type: 'email',
      });
      if (error) {
        console.error('[Auth Callback] Erro verifyOtp email+token:', error);
        return NextResponse.redirect(new URL(`/portaria/login?error=${encodeURIComponent(error.message)}`, origin));
      }
      return redirectResponse;
    }

    // 2. Verificação por token_hash (magiclink padrão do Supabase)
    if (token_hash) {
      const { error } = await supabase.auth.verifyOtp({
        token_hash,
        type: (type as any) || 'magiclink',
      });
      if (error) {
        console.error('[Auth Callback] Erro verifyOtp token_hash:', error);
        return NextResponse.redirect(new URL(`/portaria/login?error=${encodeURIComponent(error.message)}`, origin));
      }
      return redirectResponse;
    }

    // 3. Verificação por code (PKCE)
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        console.error('[Auth Callback] Erro exchangeCodeForSession:', error);
        return NextResponse.redirect(new URL(`/portaria/login?error=${encodeURIComponent(error.message)}`, origin));
      }
      return redirectResponse;
    }
  } catch (err: any) {
    console.error('[Auth Callback] Exceção:', err);
    return NextResponse.redirect(new URL(`/portaria/login?error=${encodeURIComponent(err.message || 'Falha na autenticação')}`, origin));
  }

  return redirectResponse;
}

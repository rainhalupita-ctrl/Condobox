import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Mapeamento de permissões por papel
const ROLE_ALLOWED_PATHS: Record<string, string[]> = {
  ADMIN:    ['/portaria', '/admin', '/morador'],
  SYNDIC:   ['/portaria', '/admin', '/morador'],
  GUARD:    ['/portaria', '/admin', '/morador'],
  RESIDENT: ['/morador'],
};

// Rotas públicas (sem autenticação necessária)
const PUBLIC_PATHS = ['/login', '/cadastro', '/p', '/encomenda'];

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // 1. NUNCA interceptar arquivos estáticos, chunks, CSS, JS, imagens ou rotas da API interna
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('.') ||
    pathname === '/favicon.ico' ||
    pathname === '/manifest.json'
  ) {
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  // Permitir rotas públicas sempre
  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p));
  if (isPublic) {
    // Se já está logado e tenta acessar /login ou /cadastro, redireciona para a home
    if (user && (pathname === '/login' || pathname === '/cadastro')) {
      const profile = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
      const role = profile.data?.role || 'RESIDENT';
      const dest = role === 'RESIDENT' ? '/morador' : '/portaria';
      return NextResponse.redirect(new URL(dest, request.url));
    }
    return supabaseResponse;
  }

  // Rota raiz `/` — redirecionar baseado no papel
  if (pathname === '/') {
    if (!user) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    const profile = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    const role = profile.data?.role || 'RESIDENT';
    const dest = role === 'RESIDENT' ? '/morador' : '/portaria';
    return NextResponse.redirect(new URL(dest, request.url));
  }

  // Usuário não autenticado tentando acessar rota protegida
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirect', pathname);
    return NextResponse.redirect(url);
  }

  // Buscar perfil do usuário para checar permissão
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  const role = (profile?.role as string) || 'RESIDENT';
  const allowedPaths = ROLE_ALLOWED_PATHS[role] || ['/morador'];

  const hasAccess = allowedPaths.some(allowed => pathname.startsWith(allowed));

  if (!hasAccess) {
    // Morador tentando acessar /portaria ou /admin → redireciona para /morador
    const fallback = role === 'RESIDENT' ? '/morador' : '/portaria';
    return NextResponse.redirect(new URL(fallback, request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files with extensions (.svg, .png, .jpg, .css, .js, etc)
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js|ico|woff|woff2|ttf|map)).*)',
  ],
};

'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Building2, ShieldCheck, Lock, Mail, Eye, EyeOff, Loader2, ArrowRight, Home } from 'lucide-react';
import Link from 'next/link';

function SyndicLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect') || '/admin';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const supabase = createClient();

  useEffect(() => {
    document.title = 'CondoBox Síndico — Administração do Condomínio';
  }, []);

  const handleSyndicLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const cleanEmail = email.trim().toLowerCase();

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (authError || !data.user) {
        const msg = authError?.message?.toLowerCase() || '';
        if (msg.includes('rate limit') || msg.includes('too many requests')) {
          setError('Muitas tentativas recentes. Aguarde alguns minutos antes de tentar novamente.');
        } else {
          setError('E-mail ou senha incorretos. Verifique suas credenciais de síndico.');
        }
        setLoading(false);
        return;
      }

      // 1. Busca perfil do usuário
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, condo_id')
        .eq('id', data.user.id)
        .single();

      const userEmail = (data.user.email || '').toLowerCase();
      const superAdminEmails = (process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAILS || 'rainhalupita@gmail.com,klebervenancio2002@icloud.com')
        .split(',')
        .map(e => e.trim().toLowerCase());
      const isMasterOwner = (profile?.role === 'ADMIN' && (!profile?.condo_id || superAdminEmails.includes(userEmail))) || superAdminEmails.includes(userEmail);

      // Se for o dono do sistema, manda para o super-admin
      if (isMasterOwner) {
        router.push('/super-admin');
        return;
      }

      // 2. Validação estrita: Este portal é apenas para Síndicos / Administradores
      const isSyndicRole = profile?.role === 'SYNDIC' || (profile?.role === 'ADMIN' && profile?.condo_id);

      if (!isSyndicRole) {
        await supabase.auth.signOut();
        if (profile?.role === 'RESIDENT') {
          setError('Esta conta pertence a um Morador. Por favor, utilize o Portal do Morador.');
        } else if (profile?.role === 'GUARD') {
          setError('Esta conta pertence a um Porteiro. Por favor, utilize o Portal de Portaria.');
        } else {
          setError('Acesso não autorizado. Este portal é exclusivo para a administração do condomínio.');
        }
        setLoading(false);
        return;
      }

      // 3. Redireciona para o painel de administração do condomínio
      router.push(redirectTo);
    } catch (err: any) {
      setError(err?.message || 'Erro inesperado ao conectar ao sistema.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-950 relative overflow-hidden select-none">
      {/* Luz ambiente corporativa */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[550px] bg-blue-600/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-80 h-80 bg-indigo-600/10 rounded-full blur-[100px] pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        {/* Card Executivo Síndico */}
        <div className="rounded-3xl border border-slate-800 bg-slate-900/80 backdrop-blur-xl p-8 sm:p-10 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-sky-400" />

          {/* Cabeçalho */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/25 mb-4 border border-blue-400/20">
              <Building2 size={32} />
            </div>

            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold mb-2">
              <ShieldCheck size={14} />
              Portal da Administração
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              CondoBox <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-300">Síndico</span>
            </h1>
            <p className="text-slate-400 text-xs sm:text-sm mt-1.5 leading-relaxed">
              Gestão Condominial • Unidades, Moradores e Portaria
            </p>
          </div>

          {/* Alerta de erro */}
          {error && (
            <div className="mb-6 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-medium flex items-start gap-2.5 animate-shake">
              <span className="shrink-0 mt-0.5">⚠️</span>
              <div className="flex-1">
                <span>{error}</span>
                {error.includes('Portal do Morador') && (
                  <div className="mt-2">
                    <Link
                      href="/login"
                      className="inline-flex items-center gap-1.5 text-blue-400 hover:text-blue-300 font-bold underline"
                    >
                      Ir para Portal do Morador <ArrowRight size={13} />
                    </Link>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Formulário de Login */}
          <form onSubmit={handleSyndicLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 tracking-wide uppercase">
                E-mail do Síndico / Gestor
              </label>
              <div className="relative">
                <Mail size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="sindico@condominio.com"
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-950/70 border border-slate-800 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300 tracking-wide uppercase">
                  Senha de Gestão
                </label>
              </div>
              <div className="relative">
                <Lock size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full pl-10 pr-11 py-3 rounded-xl bg-slate-950/70 border border-slate-800 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3.5 rounded-xl font-bold text-white text-sm bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:scale-[0.99] transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-600/25 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin text-white" />
                  <span>Validando Acesso de Gestor...</span>
                </>
              ) : (
                <>
                  <span>Acessar Gestão do Condomínio</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          {/* Rodapé Interno */}
          <div className="mt-8 pt-6 border-t border-slate-800/80 text-center space-y-2.5">
            <p className="text-xs text-slate-400">
              É morador e quer acompanhar suas encomendas?
            </p>
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 font-bold transition-colors"
            >
              <Home size={14} />
              Acessar Portal do Morador
            </Link>
          </div>
        </div>

        {/* Informações complementares */}
        <p className="text-center text-[11px] text-slate-600 mt-6">
          CondoBox Gestão Condominial • Protegido com criptografia de ponta a ponta
        </p>
      </div>
    </div>
  );
}

export default function SyndicLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">Carregando...</div>}>
      <SyndicLoginForm />
    </Suspense>
  );
}

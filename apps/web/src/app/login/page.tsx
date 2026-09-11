'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Package, User, Lock, Mail, Eye, EyeOff, Loader2, ArrowRight, Building2, Shield } from 'lucide-react';
import Link from 'next/link';

export default function ResidentLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect') || '/morador';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const supabase = createClient();

  useEffect(() => {
    document.title = 'CondoBox Morador — Minhas Encomendas';
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const cleanEmail = email.trim().toLowerCase();
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

    if (authError || !data.user) {
      const msg = authError?.message?.toLowerCase() || '';
      if (msg.includes('rate limit') || msg.includes('too many requests')) {
        setError('Muitas tentativas recentes. Por segurança, aguarde alguns minutos antes de tentar novamente.');
      } else {
        setError('E-mail ou senha incorretos. Verifique seus dados e tente novamente.');
      }
      setLoading(false);
      return;
    }

    // Buscar perfil para saber o papel
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, condo_id')
      .eq('id', data.user.id)
      .single();

    const role = profile?.role || 'RESIDENT';
    const userEmail = (data.user.email || '').toLowerCase();
    const superAdminEmails = (process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAILS || 'rainhalupita@gmail.com,klebervenancio2002@icloud.com')
      .split(',')
      .map(e => e.trim().toLowerCase());
    const isMaster = (role === 'ADMIN' && (!profile?.condo_id || superAdminEmails.includes(userEmail))) || superAdminEmails.includes(userEmail);

    // Se for o Dono do Sistema (Master)
    if (isMaster) {
      router.push('/super-admin');
      return;
    }

    // Se for Síndico entrando pelo portal do morador, encaminha para a gestão
    if (role === 'SYNDIC' || (role === 'ADMIN' && profile?.condo_id)) {
      router.push('/admin');
      return;
    }

    // Se for Porteiro
    if (role === 'GUARD') {
      router.push('/portaria');
      return;
    }

    // Morador
    router.push(redirectTo);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-950 relative overflow-hidden select-none">
      {/* Glow de fundo */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[550px] bg-emerald-600/10 rounded-full blur-[140px] pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        <div className="rounded-3xl border border-slate-800 bg-slate-900/80 backdrop-blur-xl p-8 sm:p-10 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-teal-400 to-green-500" />

          {/* Cabeçalho */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-500/25 mb-4 border border-emerald-400/20">
              <Package size={32} />
            </div>

            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold mb-2">
              <User size={13} />
              Portal do Morador
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              CondoBox <span className="text-emerald-400">Morador</span>
            </h1>
            <p className="text-slate-400 text-xs sm:text-sm mt-1.5 leading-relaxed">
              Acompanhe a chegada e retirada de suas encomendas
            </p>
          </div>

          {error && (
            <div className="mb-6 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-medium flex items-start gap-2.5 animate-shake">
              <span className="shrink-0 mt-0.5">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {/* Formulário */}
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 tracking-wide uppercase">
                Seu E-mail
              </label>
              <div className="relative">
                <Mail size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="morador@email.com"
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-950/70 border border-slate-800 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 tracking-wide uppercase">
                Sua Senha
              </label>
              <div className="relative">
                <Lock size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type={showPass ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full pl-10 pr-11 py-3 rounded-xl bg-slate-950/70 border border-slate-800 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showPass ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3.5 rounded-xl font-bold text-white text-sm bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-[0.99] transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin text-white" />
                  <span>Acessando...</span>
                </>
              ) : (
                <>
                  <span>Entrar nas Minhas Encomendas</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          {/* Cadastro de Morador */}
          <p className="text-center text-slate-400 text-xs sm:text-sm mt-6">
            Primeiro acesso?{' '}
            <Link href="/cadastro" className="text-emerald-400 hover:text-emerald-300 font-bold underline">
              Cadastrar-se como Morador
            </Link>
          </p>

          {/* Links para outros perfis */}
          <div className="mt-8 pt-6 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-center gap-4 text-xs">
            <Link
              href="/admin/login"
              className="inline-flex items-center gap-1.5 text-slate-400 hover:text-blue-400 font-medium transition-colors"
            >
              <Building2 size={14} className="text-blue-500" />
              Portal do Síndico
            </Link>
            <span className="hidden sm:inline text-slate-700">•</span>
            <Link
              href="/portaria/login"
              className="inline-flex items-center gap-1.5 text-slate-400 hover:text-teal-400 font-medium transition-colors"
            >
              <Shield size={14} className="text-teal-500" />
              Terminal da Portaria
            </Link>
          </div>
        </div>

        <p className="text-center text-[11px] text-slate-600 mt-6">
          CondoBox • Gestão de Encomendas para Condomínios
        </p>
      </div>
    </div>
  );
}

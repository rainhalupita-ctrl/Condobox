'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Building2, User, ShieldCheck, Eye, EyeOff, Lock, Mail, Loader2 } from 'lucide-react';
import Link from 'next/link';

type Tab = 'portaria' | 'morador';

export default function LoginPage() {
  const [tab, setTab] = useState<Tab>('morador');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect');
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const cleanEmail = email.trim().toLowerCase();
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });

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
      .select('role')
      .eq('id', data.user.id)
      .single();

    const role = profile?.role || 'RESIDENT';

    // Validar se o perfil bate com a aba selecionada
    const isPortariaRole = ['ADMIN', 'SYNDIC', 'GUARD'].includes(role);
    const isMoradorRole = role === 'RESIDENT';

    if (tab === 'portaria' && !isPortariaRole) {
      await supabase.auth.signOut();
      setError('Sua conta não tem permissão de portaria. Use a aba "Morador".');
      setLoading(false);
      return;
    }

    if (tab === 'morador' && !isMoradorRole) {
      // Porteiros/admins tentando na aba morador — redirecionar para portaria
      router.push('/portaria');
      return;
    }

    // Redirecionar conforme papel
    if (redirectTo) {
      router.push(redirectTo);
    } else if (isPortariaRole) {
      router.push('/portaria');
    } else {
      router.push('/morador');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{
      background: 'radial-gradient(ellipse at top left, #0f2027, #203a43, #2c5364)',
    }}>
      {/* Card de Login */}
      <div className="w-full max-w-md">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-4"
            style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
            <Building2 size={40} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">CondoBox</h1>
          <p className="text-slate-400 mt-1 text-sm">Gestão inteligente de encomendas</p>
        </div>

        {/* Tabs */}
        <div className="flex mb-6 rounded-xl overflow-hidden border border-slate-700 bg-slate-900/60 backdrop-blur">
          <button
            onClick={() => { setTab('morador'); setError(''); }}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-all ${
              tab === 'morador'
                ? 'bg-green-600 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <User size={16} />
            Sou Morador
          </button>
          <button
            onClick={() => { setTab('portaria'); setError(''); }}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-all ${
              tab === 'portaria'
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <ShieldCheck size={16} />
            Portaria / Síndico
          </button>
        </div>

        {/* Descrição da aba */}
        <p className="text-center text-slate-400 text-xs mb-6">
          {tab === 'morador'
            ? '🏠 Acesse para ver e retirar suas encomendas'
            : '🛡️ Acesso restrito a porteiros, síndicos e administradores'}
        </p>

        {/* Formulário */}
        <form onSubmit={handleLogin}
          className="rounded-2xl border border-slate-700 bg-slate-900/70 backdrop-blur-md p-6 space-y-4 shadow-2xl">

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-xl">
              {error}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">E-mail</label>
            <div className="relative">
              <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com"
                className="w-full pl-9 pr-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Senha</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type={showPass ? 'text' : 'password'}
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-9 pr-10 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition"
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
              >
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className={`w-full py-3 rounded-xl font-semibold text-white text-sm flex items-center justify-center gap-2 transition-all ${
              loading ? 'opacity-60 cursor-not-allowed' : 'hover:brightness-110 active:scale-[0.98]'
            } ${tab === 'portaria' ? 'bg-blue-600' : 'bg-green-600'}`}
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : null}
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        {/* Rodapé */}
        {tab === 'morador' ? (
          <p className="text-center text-slate-500 text-sm mt-6">
            Ainda não tem conta?{' '}
            <Link href="/cadastro" className="text-green-400 hover:text-green-300 font-medium">
              Cadastrar-se como Morador
            </Link>
          </p>
        ) : (
          <div className="mt-6 text-center bg-slate-900/60 border border-slate-800 rounded-xl px-4 py-3">
            <p className="text-slate-400 text-xs leading-relaxed">
              🔒 Contas de portaria são criadas <strong className="text-slate-300">somente pelo síndico</strong>.<br />
              Entre em contato com a administração do condomínio.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

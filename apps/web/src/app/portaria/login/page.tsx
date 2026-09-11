'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Shield, Lock, Mail, Eye, EyeOff, Loader2, ArrowRight, QrCode, LogIn } from 'lucide-react';
import { QRLoginScanner } from '@/components/qr-login-scanner';
import Link from 'next/link';

function PortariaLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect') || '/portaria';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'form' | 'qr'>('form');

  const supabase = createClient();

  useEffect(() => {
    document.title = 'CondoBox Portaria — Acesso dos Porteiros';
  }, []);

  const handlePortariaLogin = async (e: React.FormEvent) => {
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
        setError('Credenciais incorretas de portaria. Verifique seu e-mail e senha.');
        setLoading(false);
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('role, condo_id')
        .eq('id', data.user.id)
        .single();

      const role = profile?.role || 'RESIDENT';

      // Permite portaria (GUARD, SYNDIC ou ADMIN de condomínio)
      const isPortariaAllowed = ['GUARD', 'SYNDIC', 'ADMIN'].includes(role);

      if (!isPortariaAllowed) {
        await supabase.auth.signOut();
        setError('Esta conta pertence a um morador e não tem permissão para operar a portaria.');
        setLoading(false);
        return;
      }

      router.push(redirectTo);
    } catch (err: any) {
      setError(err?.message || 'Erro ao conectar à portaria.');
      setLoading(false);
    }
  };

  const handleQRScanSuccess = (url: string) => {
    setLoading(true);
    window.location.href = url;
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-950 relative overflow-hidden select-none">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[550px] bg-emerald-600/10 rounded-full blur-[140px] pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        <div className="rounded-3xl border border-slate-800 bg-slate-900/80 backdrop-blur-xl p-8 sm:p-10 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-400" />

          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-500/25 mb-4 border border-emerald-400/20">
              <Shield size={32} />
            </div>

            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold mb-2">
              Controle de Encomendas
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              CondoBox <span className="text-emerald-400">Portaria</span>
            </h1>
            <p className="text-slate-400 text-xs sm:text-sm mt-1.5 leading-relaxed">
              Terminal Operacional de Recepção e Entrega
            </p>
          </div>

          {/* Alternância Formulário / QR Code */}
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setMode('form')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all ${
                mode === 'form' ? 'bg-slate-800 text-white border border-slate-700' : 'bg-slate-950/60 text-slate-400 hover:bg-slate-800'
              }`}
            >
              <LogIn size={15} /> E-mail e Senha
            </button>
            <button
              onClick={() => setMode('qr')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all ${
                mode === 'qr' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30' : 'bg-slate-950/60 text-slate-400 hover:bg-slate-800'
              }`}
            >
              <QrCode size={15} /> Crachá QR Code
            </button>
          </div>

          {error && (
            <div className="mb-6 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-medium flex items-start gap-2.5">
              <span className="shrink-0">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {mode === 'qr' ? (
            <div className="animate-fade-in">
              <QRLoginScanner
                onScanSuccess={handleQRScanSuccess}
                onClose={() => setMode('form')}
              />
            </div>
          ) : (
            <form onSubmit={handlePortariaLogin} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 tracking-wide uppercase">
                  E-mail do Porteiro
                </label>
                <div className="relative">
                  <Mail size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="portaria@condominio.com"
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-950/70 border border-slate-800 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 tracking-wide uppercase">
                  Senha
                </label>
                <div className="relative">
                  <Lock size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full pl-10 pr-11 py-3 rounded-xl bg-slate-950/70 border border-slate-800 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all font-mono"
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
                className="w-full mt-2 py-3.5 rounded-xl font-bold text-white text-sm bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-[0.99] transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <Loader2 size={18} className="animate-spin text-white" />
                    <span>Iniciando Portaria...</span>
                  </>
                ) : (
                  <>
                    <span>Entrar na Portaria</span>
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </form>
          )}

          <div className="mt-8 pt-6 border-t border-slate-800/80 text-center">
            <Link
              href="/admin/login"
              className="text-xs text-blue-400 hover:text-blue-300 font-semibold"
            >
              Acesso para Síndicos e Administradores →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PortariaLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">Carregando...</div>}>
      <PortariaLoginForm />
    </Suspense>
  );
}

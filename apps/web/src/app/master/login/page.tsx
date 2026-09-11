'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ShieldAlert, Lock, Mail, Eye, EyeOff, Loader2, KeyRound, ArrowRight } from 'lucide-react';

export default function MasterLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect') || '/super-admin';

  useEffect(() => {
    document.title = 'CondoBox Master - Acesso Exclusivo do Proprietário';
  }, []);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const supabase = createClient();

  const handleMasterLogin = async (e: React.FormEvent) => {
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
          setError('Credenciais incorretas ou não autorizadas para o Painel Master.');
        }
        setLoading(false);
        return;
      }

      // 1. Busca perfil do usuário no banco
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, condo_id')
        .eq('id', data.user.id)
        .single();

      const userEmail = (data.user.email || '').toLowerCase();
      const superAdminEmails = (process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAILS || 'rainhalupita@gmail.com,klebervenancio2002@icloud.com')
        .split(',')
        .map(e => e.trim().toLowerCase());

      const isMaster = (profile?.role === 'ADMIN' && (!profile?.condo_id || superAdminEmails.includes(userEmail))) || superAdminEmails.includes(userEmail);

      // 2. Se NÃO for o Dono do Sistema, desloga imediatamente
      if (!isMaster) {
        await supabase.auth.signOut();
        setError('Acesso Negado: Esta conta não possui privilégios de Dono do SaaS.');
        setLoading(false);
        return;
      }

      // 3. Sucesso: Redireciona diretamente para a central do proprietário
      router.push(redirectTo);
    } catch (err: any) {
      console.error('[Master Login] Erro inesperado:', err);
      setError('Falha ao autenticar. Verifique sua conexão.');
      setLoading(false);
    }
  };

  return (
    <div 
      className="min-h-screen flex items-center justify-center p-4 select-none"
      style={{
        background: 'radial-gradient(ellipse at top, #1e1b4b 0%, #090d16 60%, #020617 100%)',
      }}
    >
      <div className="w-full max-w-md">
        {/* Card Executivo Blindado */}
        <div className="bg-slate-900/85 backdrop-blur-2xl border border-purple-500/30 rounded-3xl p-8 sm:p-10 shadow-[0_20px_70px_-15px_rgba(168,85,247,0.3)] relative overflow-hidden">
          
          {/* Luz ambiente no topo do card */}
          <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-48 h-48 bg-purple-600/20 blur-3xl rounded-full pointer-events-none" />

          {/* Cabeçalho */}
          <div className="flex flex-col items-center text-center mb-8 relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-amber-500 flex items-center justify-center shadow-lg shadow-purple-500/30 mb-4 border border-white/20">
              <ShieldAlert className="w-9 h-9 text-white" />
            </div>

            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-300 text-[11px] font-bold uppercase tracking-wider mb-2">
              <KeyRound size={12} />
              Acesso Restrito ao Proprietário
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              CondoBox <span className="bg-gradient-to-r from-purple-400 via-indigo-300 to-amber-400 bg-clip-text text-transparent">Master</span>
            </h1>
            <p className="text-slate-400 text-xs mt-1.5 font-medium">
              Central de Gestão Global & Licenciamento SaaS
            </p>
          </div>

          {/* Alerta de Erro */}
          {error && (
            <div className="mb-6 p-4 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-semibold animate-shake flex items-start gap-2.5">
              <span className="text-rose-400 font-bold shrink-0 mt-0.5">⚠️</span>
              <span className="leading-relaxed">{error}</span>
            </div>
          )}

          {/* Formulário */}
          <form onSubmit={handleMasterLogin} className="space-y-4">
            <div>
              <label className="block text-slate-300 text-xs font-semibold mb-1.5 uppercase tracking-wider">
                E-mail do Proprietário
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@condobox.com"
                  required
                  autoFocus
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl pl-10 pr-4 py-3 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-300 text-xs font-semibold mb-1.5 uppercase tracking-wider">
                Chave de Acesso / Senha
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl pl-10 pr-11 py-3 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3.5 px-4 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 hover:from-purple-500 hover:to-indigo-600 active:scale-[0.98] transition-all duration-200 shadow-lg shadow-purple-600/30 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Verificando Credenciais...</span>
                </>
              ) : (
                <>
                  <span>Entrar no Painel Master</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          {/* Rodapé Seguro */}
          <div className="mt-8 pt-6 border-t border-slate-800/80 text-center">
            <p className="text-[11px] text-slate-500 flex items-center justify-center gap-1.5">
              <span>🔒</span> Conexão segura protegida por criptografia de ponta a ponta
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

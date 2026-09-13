'use client';

import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { Eye, LogOut, ShieldAlert, ArrowLeft } from 'lucide-react';

export function ImpersonationBanner() {
  const { isImpersonating, impersonatedCondo, stopImpersonating, license } = useAuth();
  const router = useRouter();

  if (!isImpersonating || !impersonatedCondo) {
    return null;
  }

  const isExpired = Boolean(
    license && (license.status === 'EXPIRED' || license.status === 'BLOCKED' || (license.expires_at && new Date(license.expires_at).getTime() <= Date.now()))
  );

  const handleExit = () => {
    stopImpersonating();
    router.push('/super-admin');
  };

  return (
    <div className={`text-white shadow-xl sticky top-0 z-50 px-4 py-2 text-xs border-b select-none animate-fade-in ${
      isExpired 
        ? 'bg-gradient-to-r from-rose-700 via-red-600 to-rose-800 border-rose-400/50' 
        : 'bg-gradient-to-r from-amber-600 via-orange-600 to-amber-700 border-amber-400/40'
    }`}>
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium flex-wrap">
          <div className="p-1 bg-black/20 rounded-md shrink-0 animate-pulse">
            <Eye size={16} className={isExpired ? 'text-rose-200' : 'text-amber-200'} />
          </div>
          <span>
            <strong className="tracking-wide uppercase font-black mr-1.5 text-white">
              Modo Impersonação Ativo:
            </strong>
            Você está operando como Síndico do condomínio{' '}
            <strong className="underline underline-offset-2 text-white font-bold">
              {impersonatedCondo.name}
            </strong>
          </span>

          {isExpired && (
            <span className="ml-2 px-2 py-0.5 rounded-full bg-black/30 border border-white/20 text-rose-100 text-[10px] font-bold uppercase tracking-wider">
              ⚠️ Tempo Expirado • Suporte: (73) 99841-9901 / (21) 97196-6473
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => router.push('/super-admin')}
            className="px-2.5 py-1 bg-black/30 hover:bg-black/40 text-amber-100 rounded-lg text-[11px] font-semibold transition flex items-center gap-1 border border-amber-300/30"
            title="Ir para o painel de Super Admin"
          >
            <ShieldAlert size={13} />
            Painel Master
          </button>

          <button
            type="button"
            onClick={handleExit}
            className="px-3 py-1 bg-white text-amber-900 hover:bg-amber-100 rounded-lg text-[11px] font-bold shadow-md transition flex items-center gap-1 active:scale-95"
            title="Encerrar impersonação e retornar ao perfil original"
          >
            <LogOut size={13} />
            Encerrar Impersonação
          </button>
        </div>
      </div>
    </div>
  );
}

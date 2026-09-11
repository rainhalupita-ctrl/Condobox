'use client';

import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { Eye, LogOut, ShieldAlert, ArrowLeft } from 'lucide-react';

export function ImpersonationBanner() {
  const { isImpersonating, impersonatedCondo, stopImpersonating } = useAuth();
  const router = useRouter();

  if (!isImpersonating || !impersonatedCondo) {
    return null;
  }

  const handleExit = () => {
    stopImpersonating();
    router.push('/super-admin');
  };

  return (
    <div className="bg-gradient-to-r from-amber-600 via-orange-600 to-amber-700 text-white shadow-xl sticky top-0 z-50 px-4 py-2 text-xs border-b border-amber-400/40 select-none animate-fade-in">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium">
          <div className="p-1 bg-black/20 rounded-md shrink-0 animate-pulse">
            <Eye size={16} className="text-amber-200" />
          </div>
          <span>
            <strong className="tracking-wide uppercase font-black text-amber-100 mr-1.5">
              Modo Impersonação Ativo:
            </strong>
            Você está operando como Síndico do condomínio{' '}
            <strong className="underline underline-offset-2 decoration-amber-200 text-white font-bold">
              {impersonatedCondo.name}
            </strong>
          </span>
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

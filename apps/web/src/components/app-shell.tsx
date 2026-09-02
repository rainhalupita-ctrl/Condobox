'use client';

import { usePathname } from 'next/navigation';
import { Navbar } from './navbar';
import { CookieConsent } from './cookie-consent';
import { BarcodeListener } from './BarcodeListener';
import { useAuth } from '@/contexts/auth-context';

const NO_NAVBAR_PATHS = ['/login', '/cadastro'];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const showNavbar = !NO_NAVBAR_PATHS.some(p => pathname.startsWith(p));
  const { license, isPortaria, isMorador } = useAuth();

  const isBlocked = license && (license.status === 'EXPIRED' || license.status === 'BLOCKED');
  // Se for admin global (vamos assumir que acessa painel /super-admin), não bloqueia.
  // Vamos bloquear apenas as telas /portaria, /morador, /admin local.
  const shouldBlock = isBlocked && (pathname.startsWith('/portaria') || pathname.startsWith('/morador') || pathname.startsWith('/admin'));

  return (
    <div className="flex flex-col min-h-screen">
      {showNavbar && <Navbar />}
      <main className={`flex-1 w-full pb-20 sm:pb-6 ${showNavbar ? 'max-w-7xl mx-auto p-3 sm:p-6 md:p-8' : ''}`}>
        {shouldBlock ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <h1 className="text-3xl font-bold text-red-500 mb-4">Acesso Bloqueado</h1>
            <p className="text-slate-400 max-w-md mb-6">
              A licença deste condomínio encontra-se {license.status === 'EXPIRED' ? 'expirada' : 'bloqueada'}. 
              Entre em contato com o suporte ou realize o pagamento para continuar usando o CondoBox.
            </p>
          </div>
        ) : (
          children
        )}
      </main>
      {showNavbar && (
        <footer className="border-t border-slate-900 bg-slate-950 py-4 text-center text-xs text-slate-600">
          CondoBox • Sistema de Portaria Inteligente
        </footer>
      )}
      <CookieConsent />
      <BarcodeListener />
    </div>
  );
}

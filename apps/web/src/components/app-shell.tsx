'use client';

import { usePathname } from 'next/navigation';
import { Navbar } from './navbar';
import { ImpersonationBanner } from './impersonation-banner';
import { CookieConsent } from './cookie-consent';
import { BarcodeListener } from './BarcodeListener';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { useAuth } from '@/contexts/auth-context';

const NO_NAVBAR_PATHS = ['/login', '/cadastro', '/p/', '/master', '/admin/login', '/portaria/login'];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const showNavbar = !NO_NAVBAR_PATHS.some(p => pathname.startsWith(p));
  const { license, isPortaria, isMorador, isSuperAdmin } = useAuth();
  const isMaster = isSuperAdmin || pathname.startsWith('/super-admin') || pathname.startsWith('/master');

  const isBlocked = license && (license.status === 'EXPIRED' || license.status === 'BLOCKED');
  // Se for super admin ou acessando o super-admin, não bloqueia
  const shouldBlock = !isSuperAdmin && isBlocked && (pathname.startsWith('/portaria') || pathname.startsWith('/morador') || pathname.startsWith('/admin'));

  return (
    <div className="flex flex-col min-h-screen">
      <ImpersonationBanner />
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
          {isMaster 
            ? 'CondoBox SaaS Master • Central de Gestão Global e Licenciamento'
            : 'CondoBox • Sistema de Portaria Inteligente'}
        </footer>
      )}
      <CookieConsent />
      <BarcodeListener />
      <KeyboardShortcuts />
    </div>
  );
}

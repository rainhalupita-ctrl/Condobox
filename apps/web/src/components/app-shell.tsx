'use client';

import { usePathname } from 'next/navigation';
import { Navbar } from './navbar';
import { ImpersonationBanner } from './impersonation-banner';
import { CookieConsent } from './cookie-consent';
import { BarcodeListener } from './BarcodeListener';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { ExpiredAccountGate } from './ExpiredAccountGate';
import { useAuth } from '@/contexts/auth-context';

const NO_NAVBAR_PATHS = ['/login', '/cadastro', '/p/', '/master', '/admin/login', '/portaria/login'];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const showNavbar = !NO_NAVBAR_PATHS.some(p => pathname.startsWith(p));
  const { user, license, isPortaria, isMorador, isSuperAdmin, impersonatedCondo, effectiveCondoId } = useAuth();
  const isMaster = isSuperAdmin || pathname.startsWith('/super-admin') || pathname.startsWith('/master');

  const superAdminEmails = (process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAILS || 'rainhalupita@gmail.com,klebervenancio2002@icloud.com')
    .split(',')
    .map(e => e.trim().toLowerCase());
  const userEmail = (user?.email || '').toLowerCase();
  const isDeveloperMaster = !!userEmail && superAdminEmails.includes(userEmail);

  // Verifica se o tempo acabou (expirado por status ou por data expires_at)
  const isExpiredByDate = Boolean(
    license?.expires_at && new Date(license.expires_at).getTime() <= Date.now()
  );
  const isBlocked = Boolean(
    license && (license.status === 'EXPIRED' || license.status === 'BLOCKED' || license.status === 'SUSPENDED' || isExpiredByDate)
  );

  // O Sócio Proprietário / Super Admin NUNCA é bloqueado por bloqueio de condomínio
  const isMasterUser = isSuperAdmin || isDeveloperMaster;

  // Bloqueia telas operacionais caso o tempo tenha acabado para condomínios
  const shouldBlock = !isMasterUser && isBlocked && (
    pathname.startsWith('/portaria') || 
    pathname.startsWith('/morador') || 
    pathname.startsWith('/admin')
  );

  return (
    <div className="flex flex-col min-h-screen">
      <ImpersonationBanner />
      {showNavbar && <Navbar />}
      <main className={`flex-1 w-full pb-32 sm:pb-6 ${showNavbar ? 'max-w-7xl mx-auto p-3 sm:p-6 md:p-8' : ''}`}>
        {shouldBlock ? (
          <ExpiredAccountGate
            condoName={impersonatedCondo?.name}
            condoId={effectiveCondoId || undefined}
          />
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

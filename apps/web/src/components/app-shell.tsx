'use client';

import { usePathname } from 'next/navigation';
import { Navbar } from './navbar';
import { CookieConsent } from './cookie-consent';
import { BarcodeListener } from './BarcodeListener';

const NO_NAVBAR_PATHS = ['/login', '/cadastro'];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const showNavbar = !NO_NAVBAR_PATHS.some(p => pathname.startsWith(p));

  return (
    <div className="flex flex-col min-h-screen">
      {showNavbar && <Navbar />}
      <main className={`flex-1 w-full ${showNavbar ? 'max-w-7xl mx-auto p-4 sm:p-6 md:p-8' : ''}`}>
        {children}
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

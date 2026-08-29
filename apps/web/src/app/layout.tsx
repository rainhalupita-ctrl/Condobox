import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from '@/contexts/auth-context';
import { AppShell } from '@/components/app-shell';

export const metadata: Metadata = {
  title: 'CondoBox — Gestão de Encomendas para Condomínios',
  description: 'Controle de encomendas com OCR Gemini, WhatsApp e Assinatura Digital',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#16a34a',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark">
      <body className="bg-slate-950 text-slate-100 min-h-screen antialiased selection:bg-emerald-500 selection:text-white">
        <AuthProvider>
          <AppShell>
            {children}
          </AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}

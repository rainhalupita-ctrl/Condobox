'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { Building2, Package, LayoutDashboard, User, LogOut, Shield, ChevronDown } from 'lucide-react';
import { useState } from 'react';

export function Navbar() {
  const { profile, isPortaria, isAdmin, signOut, loading } = useAuth();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  if (loading) {
    return (
      <nav className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50 h-14" />
    );
  }

  const navLinks = isPortaria
    ? [
        { href: '/portaria', label: 'Portaria', icon: Shield },
        { href: '/admin', label: 'Painel de Gestão', icon: LayoutDashboard },
      ]
    : [
        { href: '/morador', label: 'Minhas Encomendas', icon: Package },
      ];

  return (
    <>
      {/* Top Navbar */}
      <nav 
        className="border-b border-slate-800 bg-slate-950/90 backdrop-blur-md sticky top-0 z-40 select-none w-full"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="max-w-7xl mx-auto px-3 sm:px-6 sm:pr-36 h-14 flex items-center justify-between gap-2 sm:gap-4">
          {/* Logo Oficial CondoBox */}
          <Link 
            href={isPortaria ? '/portaria' : '/morador'}
            className="flex items-center gap-2 sm:gap-2.5 shrink-0 group"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <img
              src="/logo.png?v=5"
              alt="CondoBox"
              className="h-7 sm:h-8 w-auto object-contain drop-shadow-md group-hover:scale-105 transition transform"
            />
            <span className="text-white font-bold text-lg sm:text-xl tracking-tight">CondoBox</span>
          </Link>

          {/* Links de navegação no Desktop */}
          <div className="hidden sm:flex items-center gap-1">
            {navLinks.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  pathname.startsWith(href)
                    ? 'bg-emerald-600/20 text-emerald-400 font-bold border border-emerald-500/30'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                <Icon size={15} />
                {label}
              </Link>
            ))}
          </div>

          {/* Perfil do usuário */}
          {profile && (
            <div className="relative shrink-0">
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl text-sm text-slate-300 hover:bg-slate-800/80 border border-slate-800 transition-all"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-emerald-400">
                  <User size={13} />
                </div>
                <span className="hidden md:block max-w-[120px] truncate text-xs font-semibold">{profile.name}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-bold uppercase ${
                  isAdmin ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' :
                  isPortaria ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' :
                  'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                }`}>
                  {isAdmin ? 'Admin' : isPortaria ? 'Portaria' : 'Morador'}
                </span>
                <ChevronDown size={13} className="text-slate-500" />
              </button>

              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 mt-2 w-52 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl z-20 overflow-hidden animate-fade-in">
                    <div className="px-4 py-3 border-b border-slate-800">
                      <p className="text-white text-sm font-bold truncate">{profile.name}</p>
                      <p className="text-slate-400 text-xs truncate mt-0.5">{profile.phone || 'Sem telefone'}</p>
                    </div>
                    <button
                      onClick={() => { setMenuOpen(false); signOut(); }}
                      className="w-full flex items-center gap-2 px-4 py-3 text-sm text-rose-400 hover:bg-rose-500/10 font-semibold transition-colors"
                      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                    >
                      <LogOut size={15} />
                      Sair da Conta
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </nav>

      {/* Barra de Navegação Inferior Fixa para Mobile (Estilo PWA Nativo) */}
      {navLinks.length > 0 && (
        <div 
          className="fixed bottom-0 left-0 right-0 z-50 bg-slate-950/95 backdrop-blur-lg border-t border-slate-800 sm:hidden flex items-center justify-around px-2 py-1.5 shadow-2xl"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 6px)' }}
        >
          {navLinks.map(({ href, label, icon: Icon }) => {
            const isActive = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex-1 flex flex-col items-center justify-center gap-1 py-1.5 px-2 rounded-xl text-[11px] font-bold transition-all ${
                  isActive
                    ? 'text-emerald-400 bg-emerald-500/15 border border-emerald-500/25'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon size={18} className={isActive ? 'text-emerald-400' : 'text-slate-400'} />
                <span>{label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

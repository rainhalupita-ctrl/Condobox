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
        ...(isAdmin ? [{ href: '/admin', label: 'Administração', icon: LayoutDashboard }] : []),
      ]
    : [
        { href: '/morador', label: 'Minhas Encomendas', icon: Package },
      ];

  return (
    <nav className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
        {/* Logo */}
        <Link href={isPortaria ? '/portaria' : '/morador'}
          className="flex items-center gap-2 text-white font-bold text-lg shrink-0">
          <div className="w-8 h-8 rounded-lg bg-green-600 flex items-center justify-center">
            <Building2 size={18} className="text-white" />
          </div>
          CondoBox
        </Link>

        {/* Links de navegação */}
        <div className="hidden sm:flex items-center gap-1">
          {navLinks.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                pathname.startsWith(href)
                  ? 'bg-green-600/20 text-green-400'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Icon size={15} />
              {label}
            </Link>
          ))}
        </div>

        {/* Perfil do usuário */}
        {profile && (
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-slate-800 transition-all"
            >
              <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center">
                <User size={14} className="text-slate-300" />
              </div>
              <span className="hidden sm:block max-w-[120px] truncate">{profile.name}</span>
              <span className={`hidden sm:block text-xs px-1.5 py-0.5 rounded font-medium ${
                isAdmin ? 'bg-purple-500/20 text-purple-400' :
                isPortaria ? 'bg-blue-500/20 text-blue-400' :
                'bg-green-500/20 text-green-400'
              }`}>
                {isAdmin ? 'Admin' : isPortaria ? 'Portaria' : 'Morador'}
              </span>
              <ChevronDown size={14} className="text-slate-500" />
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 mt-1 w-52 bg-slate-900 border border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-800">
                    <p className="text-white text-sm font-medium truncate">{profile.name}</p>
                    <p className="text-slate-500 text-xs truncate">{profile.phone}</p>
                  </div>
                  <button
                    onClick={() => { setMenuOpen(false); signOut(); }}
                    className="w-full flex items-center gap-2 px-4 py-3 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <LogOut size={15} />
                    Sair
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Nav mobile */}
      {navLinks.length > 0 && (
        <div className="flex sm:hidden border-t border-slate-800">
          {navLinks.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex-1 flex flex-col items-center gap-1 py-2 text-xs font-medium transition-all ${
                pathname.startsWith(href)
                  ? 'text-green-400 bg-green-600/10'
                  : 'text-slate-500 hover:text-white'
              }`}
            >
              <Icon size={18} />
              {label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}

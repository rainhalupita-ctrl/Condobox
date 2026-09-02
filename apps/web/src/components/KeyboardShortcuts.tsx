'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { 
  Keyboard, 
  X, 
  Search, 
  Camera, 
  QrCode, 
  RefreshCw, 
  MessageSquare, 
  CornerDownLeft, 
  Sparkles,
  Layers
} from 'lucide-react';

interface ShortcutItem {
  keys: string[];
  description: string;
  category: 'Navegação' | 'Portaria' | 'Geral';
}

const SHORTCUTS: ShortcutItem[] = [
  { keys: ['ESC'], description: 'Fechar janelas/modais ou voltar para a Portaria', category: 'Navegação' },
  { keys: ['F1', 'N'], description: 'Ir para Nova Encomenda (Foto + OCR)', category: 'Portaria' },
  { keys: ['F2', 'R'], description: 'Ir para Retirar Encomenda (QR Code / Código)', category: 'Portaria' },
  { keys: ['Ctrl', 'K'], description: 'Focar na barra de pesquisa', category: 'Portaria' },
  { keys: ['/'], description: 'Focar na busca rápida', category: 'Portaria' },
  { keys: ['1'], description: 'Filtrar Encomendas: Pendentes', category: 'Portaria' },
  { keys: ['2'], description: 'Filtrar Encomendas: Entregues', category: 'Portaria' },
  { keys: ['3'], description: 'Filtrar Encomendas: Todas', category: 'Portaria' },
  { keys: ['F5'], description: 'Atualizar lista de encomendas', category: 'Portaria' },
  { keys: ['F9'], description: 'Disparar WhatsApp para todas pendentes', category: 'Portaria' },
  { keys: ['?'], description: 'Abrir este painel de atalhos de teclado', category: 'Geral' },
];

export function KeyboardShortcuts() {
  const router = useRouter();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      // ESC: Fecha modais ou volta para a portaria
      if (e.key === 'Escape') {
        window.dispatchEvent(new CustomEvent('condobox:close-modals'));
        if (isOpen) {
          setIsOpen(false);
          return;
        }
        if (isInput) {
          target.blur();
          return;
        }
        if (pathname === '/portaria/nova' || pathname === '/portaria/retirada') {
          router.push('/portaria');
          return;
        }
      }

      // Atalho de Ajuda: '?' (Shift + /)
      if (e.key === '?' && !isInput) {
        e.preventDefault();
        setIsOpen((prev) => !prev);
        return;
      }

      // Atalhos que funcionam mesmo com foco (Ctrl + K para busca)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const searchInput = document.querySelector('input[placeholder*="Buscar"]') as HTMLInputElement;
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
        return;
      }

      // Atalhos de função e teclas rápidas fora de inputs
      if (!isInput) {
        // F1 ou N: Nova Encomenda
        if (e.key === 'F1' || (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.altKey)) {
          e.preventDefault();
          router.push('/portaria/nova');
          return;
        }

        // F2 ou R: Retirar Encomenda
        if (e.key === 'F2' || (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.altKey)) {
          e.preventDefault();
          router.push('/portaria/retirada');
          return;
        }

        // Barra '/' para focar busca
        if (e.key === '/') {
          e.preventDefault();
          const searchInput = document.querySelector('input[placeholder*="Buscar"]') as HTMLInputElement;
          if (searchInput) {
            searchInput.focus();
            searchInput.select();
          }
          return;
        }

        // 1, 2, 3: Filtros da Portaria
        if (pathname === '/portaria') {
          if (e.key === '1') {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent('condobox:set-filter', { detail: 'PENDING' }));
            return;
          }
          if (e.key === '2') {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent('condobox:set-filter', { detail: 'DELIVERED' }));
            return;
          }
          if (e.key === '3') {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent('condobox:set-filter', { detail: 'ALL' }));
            return;
          }
        }

        // F5: Atualizar lista de encomendas
        if (e.key === 'F5' && pathname === '/portaria') {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('condobox:refresh-packages'));
          return;
        }

        // F9: Disparar WhatsApp
        if (e.key === 'F9' && pathname === '/portaria') {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('condobox:notify-pending'));
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pathname, router, isOpen]);

  return (
    <>
      {/* Botão flutuante discreto no canto inferior para abrir o guia de atalhos */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        title="Atalhos do Teclado (Pressione ?)"
        className="fixed bottom-3 right-3 sm:bottom-4 sm:right-4 z-40 p-2.5 bg-slate-900/90 hover:bg-slate-800 text-slate-400 hover:text-emerald-400 border border-slate-800 rounded-xl shadow-lg backdrop-blur-md transition-all flex items-center gap-1.5 text-xs font-semibold group"
      >
        <Keyboard className="w-4 h-4 text-slate-400 group-hover:text-emerald-400 transition" />
        <span className="hidden md:inline">Atalhos</span>
        <kbd className="hidden md:inline px-1.5 py-0.5 bg-slate-800 text-[10px] text-slate-300 rounded border border-slate-700">?</kbd>
      </button>

      {/* Modal de Guia de Atalhos */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in"
          onClick={() => setIsOpen(false)}
        >
          <div 
            className="relative max-w-lg w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                  <Keyboard className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    Atalhos de Teclado
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">
                      Rápido & Prático
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">Opere a portaria em alta velocidade sem tocar no mouse</p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Lista de atalhos */}
            <div className="mt-4 space-y-2.5 max-h-[60vh] overflow-y-auto pr-1">
              {SHORTCUTS.map((item, index) => (
                <div 
                  key={index}
                  className="flex items-center justify-between p-3 rounded-2xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 transition"
                >
                  <span className="text-xs text-slate-300 font-medium pr-3">
                    {item.description}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {item.keys.map((k, kIndex) => (
                      <React.Fragment key={kIndex}>
                        <kbd className="px-2.5 py-1 bg-slate-800 border border-slate-700 text-emerald-400 text-xs font-bold rounded-lg shadow-inner font-mono">
                          {k}
                        </kbd>
                        {kIndex < item.keys.length - 1 && (
                          <span className="text-slate-600 text-xs">+</span>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Rodapé com instrução de fechar */}
            <div className="mt-5 pt-4 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
              <span>Pressione <kbd className="px-1.5 py-0.5 bg-slate-800 rounded border border-slate-700 text-slate-300 font-mono">ESC</kbd> para fechar</span>
              <button
                onClick={() => setIsOpen(false)}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

'use client';

import React, { useState, useEffect } from 'react';
import { Cookie, ShieldCheck, Camera, Check, X, Smartphone, Info } from 'lucide-react';

export function CookieConsent() {
  const [showBanner, setShowBanner] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);

  useEffect(() => {
    // Verifica se já aceitou os cookies/permissões permanentes
    if (typeof window !== 'undefined') {
      const consent = localStorage.getItem('condobox_cookie_consent');
      const hasCookie = document.cookie.includes('condobox_cookie_consent=accepted');
      if (!consent && !hasCookie) {
        // Exibe o banner de consentimento
        const timer = setTimeout(() => setShowBanner(true), 600);
        return () => clearTimeout(timer);
      }
    }
  }, []);

  const handleAcceptAll = async () => {
    if (typeof window !== 'undefined') {
      // 1. Grava Cookies Permanentes (10 anos de validade)
      const tenYears = 315360000;
      document.cookie = `condobox_cookie_consent=accepted; path=/; max-age=${tenYears}; SameSite=Lax`;
      document.cookie = `condobox_camera_permanent=granted; path=/; max-age=${tenYears}; SameSite=Lax`;
      document.cookie = `condobox_cache_enabled=true; path=/; max-age=${tenYears}; SameSite=Lax`;

      // 2. Grava no LocalStorage
      localStorage.setItem('condobox_cookie_consent', 'accepted');
      localStorage.setItem('condobox_camera_permanent', 'granted');
      localStorage.setItem('condobox_camera_facing', 'environment');
      localStorage.setItem('condobox_cache_enabled', 'true');

      setShowBanner(false);

      // Detecta se é iPhone/iOS Safari para oferecer a dica de fixar permanente na tela inicial
      const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
      const isStandalone = (window.navigator as any).standalone || window.matchMedia('(display-mode: standalone)').matches;
      if (isIos && !isStandalone) {
        setShowIosGuide(true);
      }
    }
  };

  const handleDecline = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('condobox_cookie_consent', 'declined');
      setShowBanner(false);
    }
  };

  return (
    <>
      {/* Banner Principal de Cookies e Permissão Permanente */}
      {showBanner && (
        <div className="fixed bottom-0 inset-x-0 z-50 p-4 sm:p-6 bg-slate-950/95 backdrop-blur-xl border-t border-slate-800 shadow-2xl animate-fade-in">
          <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="p-3 bg-emerald-500/15 border border-emerald-500/30 rounded-2xl text-emerald-400 shrink-0">
                <Cookie className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-slate-100">
                    Cookies e Acesso Permanente à Câmera
                  </h4>
                  <span className="text-[10px] uppercase font-mono px-2 py-0.5 bg-emerald-950/80 border border-emerald-800 text-emerald-300 rounded-md">
                    LGPD & Alta Velocidade
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed max-w-2xl">
                  Para ler encomendas instantaneamente sem pedir permissão de câmera a todo momento, armazenamos cookies e preferências de cache localmente no seu dispositivo.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 w-full md:w-auto shrink-0 pt-2 md:pt-0">
              <button
                type="button"
                onClick={handleDecline}
                className="px-4 py-2.5 rounded-xl border border-slate-800 hover:bg-slate-900 text-xs font-semibold text-slate-400 hover:text-slate-200 transition"
              >
                Recusar
              </button>
              <button
                type="button"
                onClick={handleAcceptAll}
                className="flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-950 transition active:scale-95"
              >
                <Check className="w-4 h-4" /> Aceitar e Liberar Acesso Permanente
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal / Dica para Fixar Permanente no iPhone (iOS) */}
      {showIosGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-700/80 rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl text-center">
            <div className="w-12 h-12 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-2xl flex items-center justify-center mx-auto">
              <Smartphone className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-white">Fixar Câmera Permanente no iPhone</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Para o iPhone nunca mais pedir permissão:
              </p>
            </div>
            <div className="p-3 bg-slate-950 rounded-2xl border border-slate-800 text-left space-y-2 text-xs text-slate-300">
              <div className="flex items-start gap-2">
                <span className="font-bold text-emerald-400">1.</span>
                <span>Toque no botão <strong>Compartilhar</strong> (quadrado com seta para cima) no Safari.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="font-bold text-emerald-400">2.</span>
                <span>Selecione <strong>Adicionar à Tela de Início</strong>.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="font-bold text-emerald-400">3.</span>
                <span>Pronto! O app abre direto com a câmera autorizada para sempre.</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowIosGuide(false)}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-emerald-950"
            >
              Entendi
            </button>
          </div>
        </div>
      )}
    </>
  );
}

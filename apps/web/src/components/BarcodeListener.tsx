'use client';

import React, { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { VoiceService } from '../lib/voice';

/**
 * Listener global para pistolas/leitores de código de barras e QR Code USB.
 * Detecta sequência de caracteres digitados em alta velocidade (< 40ms por tecla)
 * finalizados por Enter, típico de scanners de hardware.
 */
export function BarcodeListener() {
  const router = useRouter();
  const buffer = useRef<string>('');
  const lastKeyTime = useRef<number>(0);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignora se o usuário estiver digitando manualmente dentro de um input ou textarea
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }

      const currentTime = Date.now();
      const timeDiff = currentTime - lastKeyTime.current;
      lastKeyTime.current = currentTime;

      // Se o intervalo entre teclas for maior que 80ms, reseta o buffer (pois é digitação humana lenta)
      if (timeDiff > 80) {
        buffer.current = '';
      }

      if (e.key === 'Enter') {
        const scannedCode = buffer.current.trim();
        buffer.current = '';

        if (scannedCode.length >= 3) {
          console.log('[BarcodeListener] Código detectado via leitor USB:', scannedCode);
          VoiceService.playSuccessBeep();

          // Se for código numérico de 4 dígitos ou código de retirada, redireciona para a tela de retirada
          if (/^\d{4}$/.test(scannedCode) || scannedCode.startsWith('PKG-') || scannedCode.length > 8) {
            router.push(`/portaria/retirada?code=${encodeURIComponent(scannedCode)}`);
          }
        }
      } else if (e.key.length === 1) {
        buffer.current += e.key;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [router]);

  return null;
}

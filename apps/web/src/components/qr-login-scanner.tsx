'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { QrCode, X, Loader2 } from 'lucide-react';

interface QRLoginScannerProps {
  onScanSuccess: (decodedText: string) => void;
  onClose: () => void;
}

export function QRLoginScanner({ onScanSuccess, onClose }: QRLoginScannerProps) {
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [scanningLink, setScanningLink] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const elementId = 'condo-login-qr-reader';

  useEffect(() => {
    let isMounted = true;

    const startScanner = async () => {
      try {
        const html5QrCode = new Html5Qrcode(elementId);
        scannerRef.current = html5QrCode;

        let cameraConfig: any = { facingMode: 'environment' };
        
        await html5QrCode.start(
          cameraConfig,
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0,
          },
          (decodedText) => {
            if (isMounted && !scanningLink) {
              setScanningLink(true);
              if (navigator.vibrate) navigator.vibrate(100);
              
              html5QrCode.stop().then(() => {
                onScanSuccess(decodedText);
              }).catch(() => {
                onScanSuccess(decodedText);
              });
            }
          },
          () => {} // ignore empty frames
        );
      } catch (err: any) {
        if (isMounted) {
          setScannerError('Câmera não disponível ou permissão negada.');
        }
      }
    };

    startScanner();

    return () => {
      isMounted = false;
      if (scannerRef.current) {
        try {
          if (scannerRef.current.isScanning) {
            scannerRef.current.stop().then(() => {
              try { scannerRef.current?.clear(); } catch {}
            }).catch(() => {});
          } else {
            try { scannerRef.current.clear(); } catch {}
          }
        } catch {}
      }
      const container = document.getElementById(elementId);
      if (container) {
        const videos = container.getElementsByTagName('video');
        for (let i = 0; i < videos.length; i++) {
          const v = videos[i];
          if (v.srcObject) {
            try {
              (v.srcObject as MediaStream).getTracks().forEach(t => t.stop());
            } catch {}
            v.srcObject = null;
          }
        }
      }
    };
  }, [scanningLink, onScanSuccess]);

  return (
    <div className="flex flex-col w-full max-w-md mx-auto bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl p-5">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
        <div className="flex items-center gap-2">
          <QrCode className="w-5 h-5 text-blue-400" />
          <h3 className="text-sm font-semibold text-slate-100">Login via QR Code</h3>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="relative w-full aspect-square bg-black rounded-xl overflow-hidden flex items-center justify-center border border-slate-800 mb-4">
        <div id={elementId} className="w-full h-full" />
        {scannerError && (
          <div className="p-4 text-center text-slate-400 text-sm">{scannerError}</div>
        )}
        {scanningLink && (
          <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center">
            <Loader2 size={32} className="text-blue-400 animate-spin mb-2" />
            <p className="text-white text-sm">Autenticando...</p>
          </div>
        )}
      </div>
      
      <p className="text-center text-slate-400 text-xs">
        Aponte a câmera para o QR Code gerado pelo painel do Síndico para entrar instantaneamente.
      </p>
    </div>
  );
}

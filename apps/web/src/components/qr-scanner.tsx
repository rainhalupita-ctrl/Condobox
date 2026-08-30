'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { QrCode, X, Search } from 'lucide-react';

interface QRScannerProps {
  onScanSuccess: (decodedText: string) => void;
  onClose?: () => void;
}

export function QRScanner({ onScanSuccess, onClose }: QRScannerProps) {
  const [manualCode, setManualCode] = useState('');
  const [scannerError, setScannerError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const elementId = 'condo-qr-reader';

  useEffect(() => {
    let isMounted = true;

    const startScanner = async () => {
      try {
        const html5QrCode = new Html5Qrcode(elementId);
        scannerRef.current = html5QrCode;

        let cameraConfig: any = { facingMode: 'environment' };
        if (typeof window !== 'undefined') {
          const preferredDeviceId = localStorage.getItem('condobox_camera_device_id');
          if (preferredDeviceId) {
            cameraConfig = { deviceId: { exact: preferredDeviceId } };
          }
        }

        await html5QrCode.start(
          cameraConfig,
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0,
          },
          (decodedText) => {
            if (isMounted) {
              if (navigator.vibrate) navigator.vibrate(100);
              if (typeof window !== 'undefined') {
                localStorage.setItem('condobox_camera_permission', 'granted');
                document.cookie = 'condobox_camera_permission=granted; path=/; max-age=31536000; SameSite=Lax';
              }
              html5QrCode.stop().then(() => {
                onScanSuccess(decodedText);
              }).catch(() => {
                onScanSuccess(decodedText);
              });
            }
          },
          () => {
            // Ignora frames sem QR
          }
        );
      } catch (err: any) {
        if (isMounted) {
          setScannerError('Câmera não disponível para leitura de QR Code. Digite o código de 4 dígitos abaixo.');
        }
      }
    };

    startScanner();

    return () => {
      isMounted = false;
      if (scannerRef.current && scannerRef.current.isScanning) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  }, []);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualCode.trim()) {
      if (scannerRef.current && scannerRef.current.isScanning) {
        scannerRef.current.stop().catch(() => {});
      }
      onScanSuccess(manualCode.trim());
    }
  };

  return (
    <div className="flex flex-col w-full max-w-md mx-auto bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl p-5">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
        <div className="flex items-center gap-2">
          <QrCode className="w-5 h-5 text-sky-400" />
          <h3 className="text-sm font-semibold text-slate-100">Escanear QR Code de Retirada</h3>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Video Viewport */}
      <div className="relative w-full aspect-square bg-black rounded-xl overflow-hidden flex items-center justify-center border border-slate-800 mb-4">
        <div id={elementId} className="w-full h-full" />
        {scannerError && (
          <div className="p-4 text-center text-slate-400 text-xs">{scannerError}</div>
        )}
      </div>

      {/* Digitação manual alternativa */}
      <form onSubmit={handleManualSubmit} className="flex gap-2">
        <input
          type="text"
          placeholder="Ou digite o código de retirada (ex: 7492)"
          value={manualCode}
          onChange={(e) => setManualCode(e.target.value)}
          className="flex-1 px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-sm focus:outline-none focus:border-sky-500 font-mono"
        />
        <button
          type="submit"
          className="flex items-center gap-1.5 px-4 py-2.5 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-sm font-medium transition"
        >
          <Search className="w-4 h-4" /> Buscar
        </button>
      </form>
    </div>
  );
}

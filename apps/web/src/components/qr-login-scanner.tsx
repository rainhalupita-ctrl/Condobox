'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import jsQR from 'jsqr';
import { QrCode, X, Loader2, CheckCircle2 } from 'lucide-react';

interface QRLoginScannerProps {
  onScanSuccess: (decodedText: string) => void;
  onClose: () => void;
}

export function QRLoginScanner({ onScanSuccess, onClose }: QRLoginScannerProps) {
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [scanningLink, setScanningLink] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);
  const isProcessingRef = useRef(false);

  const stopCamera = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
          track.enabled = false;
        } catch {}
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const handleScanDetected = useCallback((decodedText: string) => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    setScanningLink(true);

    try {
      if (navigator.vibrate) navigator.vibrate(100);
    } catch {}

    setTimeout(() => {
      stopCamera();
      onScanSuccess(decodedText);
    }, 250);
  }, [stopCamera, onScanSuccess]);

  const startCamera = useCallback(async () => {
    setScannerError(null);
    stopCamera();
    isProcessingRef.current = false;
    setScanningLink(false);

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      };

      let mediaStream: MediaStream;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch {
        mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }

      if (!isMountedRef.current) {
        mediaStream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = mediaStream;

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.setAttribute('webkit-playsinline', 'true');
        await videoRef.current.play().catch(() => {});
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setScannerError('Câmera não disponível ou permissão negada.');
      }
    }
  }, [stopCamera]);

  useEffect(() => {
    isMountedRef.current = true;
    startCamera();

    return () => {
      isMountedRef.current = false;
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  useEffect(() => {
    let active = true;
    let nativeDetector: any = null;
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        nativeDetector = new (window as any).BarcodeDetector({
          formats: ['qr_code'],
        });
      } catch {}
    }

    let lastScanTime = 0;

    const scanFrame = async (timestamp: number) => {
      if (!active || !isMountedRef.current || isProcessingRef.current) return;

      const video = videoRef.current;
      if (video && video.readyState >= 2 && timestamp - lastScanTime >= 32) {
        lastScanTime = timestamp;

        if (nativeDetector) {
          try {
            const detectedCodes = await nativeDetector.detect(video);
            if (detectedCodes && detectedCodes.length > 0) {
              const raw = detectedCodes[0]?.rawValue?.trim();
              if (raw) {
                handleScanDetected(raw);
                return;
              }
            }
          } catch {}
        }

        try {
          if (!canvasRef.current) {
            canvasRef.current = document.createElement('canvas');
          }
          const canvas = canvasRef.current;
          const vw = video.videoWidth || 640;
          const vh = video.videoHeight || 480;
          const targetW = Math.min(vw, 640);
          const targetH = Math.round((vh / vw) * targetW);

          if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
          }

          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(video, 0, 0, targetW, targetH);
            const imgData = ctx.getImageData(0, 0, targetW, targetH);
            const qrCode = jsQR(imgData.data, imgData.width, imgData.height, {
              inversionAttempts: 'dontInvert',
            });

            if (qrCode && qrCode.data) {
              handleScanDetected(qrCode.data.trim());
              return;
            }
          }
        } catch {}
      }

      if (active && !isProcessingRef.current) {
        animationFrameRef.current = requestAnimationFrame(scanFrame);
      }
    };

    animationFrameRef.current = requestAnimationFrame(scanFrame);

    return () => {
      active = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [handleScanDetected]);

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
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          controls={false}
          disablePictureInPicture
          // @ts-ignore
          webkit-playsinline="true"
          className="w-full h-full object-cover pointer-events-none select-none"
        />

        {/* Linha de Varredura Laser */}
        {!scanningLink && !scannerError && (
          <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
            <div className="relative w-[70%] h-[70%] rounded-2xl border-2 border-blue-400/40 shadow-[0_0_20px_rgba(59,130,246,0.2)] overflow-hidden">
              <div className="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-blue-400 to-transparent shadow-[0_0_10px_rgba(59,130,246,0.9)] animate-pulse top-1/2 -translate-y-1/2" />
            </div>
          </div>
        )}

        {scannerError && (
          <div className="absolute inset-0 bg-slate-950/95 flex flex-col items-center justify-center p-4 text-center text-slate-400 text-sm">
            {scannerError}
          </div>
        )}

        {scanningLink && (
          <div className="absolute inset-0 bg-blue-950/80 backdrop-blur-sm flex flex-col items-center justify-center z-20">
            <CheckCircle2 size={36} className="text-blue-400 mb-2 animate-bounce" />
            <p className="text-white text-sm font-bold">QR Code Identificado!</p>
            <p className="text-blue-200 text-xs mt-0.5">Autenticando...</p>
          </div>
        )}
      </div>

      <p className="text-center text-slate-400 text-xs">
        Aponte a câmera para o QR Code gerado pelo painel do Síndico para entrar instantaneamente.
      </p>
    </div>
  );
}

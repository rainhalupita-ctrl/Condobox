'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import jsQR from 'jsqr';
import { QrCode, X, Search, Zap, ZapOff, ZoomIn, RefreshCw, CheckCircle2 } from 'lucide-react';

interface QRScannerProps {
  onScanSuccess: (decodedText: string) => void;
  onClose?: () => void;
}

export function QRScanner({ onScanSuccess, onClose }: QRScannerProps) {
  const [manualCode, setManualCode] = useState('');
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [hasTorch, setHasTorch] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [hasZoom, setHasZoom] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(1);
  const [maxZoom, setMaxZoom] = useState(2);
  const [isScanned, setIsScanned] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);
  const isProcessingRef = useRef(false);

  // Reproduz sinal sonoro instantâneo e agradável via Web Audio API sem arquivos externos
  const playScanBeep = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime); // 880Hz (A5)
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch {}
  }, []);

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
    setIsScanned(true);

    // Feedback tátil e auditivo
    try {
      if (navigator.vibrate) navigator.vibrate(100);
    } catch {}
    playScanBeep();

    if (typeof window !== 'undefined') {
      localStorage.setItem('condobox_camera_permission', 'granted');
      document.cookie = 'condobox_camera_permission=granted; path=/; max-age=31536000; SameSite=Lax';
    }

    // Breve animação visual de sucesso antes de acionar a busca da encomenda
    setTimeout(() => {
      stopCamera();
      onScanSuccess(decodedText);
    }, 280);
  }, [playScanBeep, stopCamera, onScanSuccess]);

  // Inicializa a câmera com os MESMOS parâmetros da câmera de Nova Encomenda
  const startCamera = useCallback(async () => {
    setScannerError(null);
    stopCamera();
    isProcessingRef.current = false;
    setIsScanned(false);

    try {
      let preferredDeviceId: string | null = null;
      if (typeof window !== 'undefined') {
        preferredDeviceId = localStorage.getItem('condobox_camera_device_id');
      }

      // Constraints idênticos aos de CameraCapture (Nova Encomenda)
      const constraints: MediaStreamConstraints = {
        video: preferredDeviceId
          ? { deviceId: { exact: preferredDeviceId }, frameRate: { ideal: 30 } }
          : {
              facingMode: { ideal: facingMode },
              width: { ideal: 1920, min: 1280 },
              height: { ideal: 1080, min: 720 },
              frameRate: { ideal: 30 },
            },
        audio: false,
      };

      let mediaStream: MediaStream;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (e) {
        // Fallback genérico se a resolução alta for rejeitada
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facingMode } },
          audio: false,
        });
      }

      if (!isMountedRef.current) {
        mediaStream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = mediaStream;

      const track = mediaStream.getVideoTracks()[0];
      if (track) {
        try {
          const capabilities = (track.getCapabilities?.() as any) || {};
          const adv: any = {};

          // Auto-foco contínuo e exposição contínua
          if (capabilities.focusMode?.includes?.('continuous')) {
            adv.focusMode = 'continuous';
          }
          if (capabilities.exposureMode?.includes?.('continuous')) {
            adv.exposureMode = 'continuous';
          }

          // Lanterna / Torch
          if ('torch' in capabilities) {
            setHasTorch(true);
          }

          // Suporte a Zoom óptico/digital da câmera (mantém 1x idêntico à Nova Encomenda)
          if (capabilities.zoom) {
            setHasZoom(true);
            const zMax = Math.min(Number(capabilities.zoom.max) || 2, 3);
            setMaxZoom(zMax);
            adv.zoom = 1; // Inicializa em 1x (sem zoom recortado)
            setCurrentZoom(1);
          }

          if (Object.keys(adv).length > 0) {
            await track.applyConstraints({ advanced: [adv] });
          }
        } catch {}
      }

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.setAttribute('webkit-playsinline', 'true');
        await videoRef.current.play().catch(() => {});
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        console.error('[QRScanner] Erro ao abrir câmera:', err);
        setScannerError('Câmera não disponível. Digite o código de 4 dígitos ou o código de retirada abaixo.');
      }
    }
  }, [facingMode, stopCamera]);

  // Alternar Lanterna
  const toggleTorch = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (track && hasTorch) {
      try {
        const nextState = !isTorchOn;
        await track.applyConstraints({ advanced: [{ torch: nextState } as any] });
        setIsTorchOn(nextState);
      } catch (err) {
        console.warn('Falha ao alternar lanterna:', err);
      }
    }
  };

  // Alternar Zoom entre 1x e 2x
  const toggleZoom = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (track && hasZoom) {
      try {
        const nextZoom = currentZoom === 1 ? Math.min(2, maxZoom) : 1;
        await track.applyConstraints({ advanced: [{ zoom: nextZoom } as any] });
        setCurrentZoom(nextZoom);
      } catch (err) {
        console.warn('Falha ao alternar zoom:', err);
      }
    }
  };

  // Alternar Câmera (Traseira / Frontal)
  const toggleCameraFacing = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  // Ciclo de leitura ultra rápida com Dual-Engine (Native BarcodeDetector + jsQR)
  useEffect(() => {
    isMountedRef.current = true;
    startCamera();

    return () => {
      isMountedRef.current = false;
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  // Loop de Análise Ultrarrápida de Quadros (30 FPS)
  useEffect(() => {
    let active = true;

    // Inicializa detector nativo por hardware do navegador (quando disponível)
    let nativeDetector: any = null;
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        nativeDetector = new (window as any).BarcodeDetector({
          formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'upc_a'],
        });
      } catch {}
    }

    let lastScanTime = 0;
    let attemptCount = 0;

    const scanFrame = async (timestamp: number) => {
      if (!active || !isMountedRef.current || isProcessingRef.current) return;

      const video = videoRef.current;
      // Garante frequência máxima de ~30 frames por segundo (a cada ~33ms)
      if (video && video.readyState >= 2 && timestamp - lastScanTime >= 32) {
        lastScanTime = timestamp;
        attemptCount++;

        // 1. Tenta Leitor Nativo por Hardware (0ms overhead)
        if (nativeDetector) {
          try {
            const detectedCodes = await nativeDetector.detect(video);
            if (detectedCodes && detectedCodes.length > 0) {
              const raw = detectedCodes[0]?.rawValue?.trim();
              if (raw && raw.length > 0) {
                handleScanDetected(raw);
                return;
              }
            }
          } catch {}
        }

        // 2. Leitor jsQR em Canvas Offscreen Ultra Rápido (100% Free e Client-Side)
        try {
          if (!canvasRef.current) {
            canvasRef.current = document.createElement('canvas');
          }
          const canvas = canvasRef.current;
          const vw = video.videoWidth || 640;
          const vh = video.videoHeight || 480;

          // Redimensiona inteligentemente para 640px para detecção instantânea (< 3ms)
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

            // Alterna inversão de cor a cada 3 quadros para ler QR codes em modo escuro
            const inversionMode = attemptCount % 3 === 0 ? 'attemptBoth' : 'dontInvert';
            const qrCode = jsQR(imgData.data, imgData.width, imgData.height, {
              inversionAttempts: inversionMode,
            });

            if (qrCode && qrCode.data && qrCode.data.trim().length > 0) {
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

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualCode.trim()) {
      stopCamera();
      onScanSuccess(manualCode.trim());
    }
  };

  return (
    <div className="flex flex-col w-full max-w-xl mx-auto bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl p-4 sm:p-5">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-3">
        <div className="flex items-center gap-2">
          <QrCode className="w-5 h-5 text-sky-400" />
          <div>
            <h3 className="text-sm font-bold text-slate-100">Leitor de QR Code / Código</h3>
            <span className="text-[11px] text-sky-400/80 font-medium">Reconhecimento ultrarrápido em tempo real</span>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="p-1 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Viewport da Câmera - Mesmas dimensões e proporção da Nova Encomenda */}
      <div className="relative w-full h-[52vh] sm:h-[56vh] min-h-[400px] max-h-[620px] bg-black rounded-2xl overflow-hidden flex items-center justify-center border border-slate-800 shadow-inner mb-4">
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

        {/* Linha de Varredura Laser de Leitura Ativa */}
        {!isScanned && !scannerError && (
          <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
            {/* Retângulo Guia Translúcido */}
            <div className="relative w-[70vw] max-w-[280px] h-[70vw] max-h-[280px] rounded-3xl border-2 border-sky-400/40 shadow-[0_0_30px_rgba(56,189,248,0.15)] overflow-hidden">
              {/* Feixe de Luz de Varredura */}
              <div className="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-sky-400 to-transparent shadow-[0_0_12px_rgba(56,189,248,0.9)] animate-pulse top-1/2 -translate-y-1/2" />
            </div>
            <span className="mt-4 px-3 py-1 bg-slate-950/80 text-sky-300 text-[11px] font-semibold rounded-full border border-sky-500/30 backdrop-blur-md">
              Aponte para o QR Code da Encomenda
            </span>
          </div>
        )}

        {/* Efeito de Sucesso Instantâneo */}
        {isScanned && (
          <div className="absolute inset-0 bg-emerald-950/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3 animate-fade-in z-20">
            <div className="w-16 h-16 bg-emerald-500 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/50 scale-110 transition-transform">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <span className="text-emerald-200 text-sm font-bold">Código Identificado!</span>
          </div>
        )}

        {/* Controles Flutuantes da Câmera (Lanterna, Zoom e Alternar Câmera) */}
        <div className="absolute top-3 right-3 flex items-center gap-2 z-10">
          {hasTorch && (
            <button
              type="button"
              onClick={toggleTorch}
              className={`p-2.5 rounded-xl border backdrop-blur-md transition ${
                isTorchOn
                  ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-lg shadow-amber-500/40'
                  : 'bg-slate-900/80 text-slate-300 border-slate-700 hover:bg-slate-800'
              }`}
              title="Alternar Lanterna"
            >
              {isTorchOn ? <Zap className="w-4 h-4 fill-current" /> : <ZapOff className="w-4 h-4" />}
            </button>
          )}

          {hasZoom && (
            <button
              type="button"
              onClick={toggleZoom}
              className={`px-3 py-2 rounded-xl text-xs font-bold border backdrop-blur-md transition ${
                currentZoom > 1
                  ? 'bg-sky-500 text-white border-sky-400 shadow-md shadow-sky-500/30'
                  : 'bg-slate-900/80 text-slate-300 border-slate-700 hover:bg-slate-800'
              }`}
              title="Alternar Zoom da Câmera"
            >
              {currentZoom > 1 ? '2x' : '1x'}
            </button>
          )}

          <button
            type="button"
            onClick={toggleCameraFacing}
            className="p-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-700 backdrop-blur-md transition"
            title="Alternar Câmera Traseira / Frontal"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Mensagem de Erro da Câmera */}
        {scannerError && (
          <div className="absolute inset-0 bg-slate-950/95 flex flex-col items-center justify-center p-6 text-center gap-3 z-10">
            <p className="text-sm text-slate-300">{scannerError}</p>
            <button
              type="button"
              onClick={() => startCamera()}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-2"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Tentar Câmera Novamente
            </button>
          </div>
        )}
      </div>

      {/* Digitação Manual Alternativa */}
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
          className="flex items-center gap-1.5 px-4 py-2.5 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-sm font-semibold transition cursor-pointer shrink-0"
        >
          <Search className="w-4 h-4" /> Buscar
        </button>
      </form>
    </div>
  );
}

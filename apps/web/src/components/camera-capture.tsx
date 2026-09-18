'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Camera, RefreshCw, X, Upload, Zap, ZapOff, ShieldCheck } from 'lucide-react';
import { OCRResponse } from '../lib/local-api';

interface CameraCaptureProps {
  onCapture: (blob: Blob, previewUrl: string, precalculatedOcr?: OCRResponse) => void;
  onCancel?: () => void;
  keepStreamAlive?: boolean;
  isCaptureActive?: boolean;
}

// ─── Cálculo de Nitidez / Anti-Tremor por Variância de Laplaciano (< 1ms) ───
function calculateFrameSharpness(video: HTMLVideoElement): { sharpness: number; brightness: number } {
  if (!video || video.readyState < 2) return { sharpness: 0, brightness: 0 };
  const sw = 160;
  const sh = 120;
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;

  // Recorta 65% central onde a etiqueta é posicionada
  const cropW = vw * 0.65;
  const cropH = vh * 0.65;
  const cropX = (vw - cropW) / 2;
  const cropY = (vh - cropH) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { sharpness: 50, brightness: 128 };

  ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, sw, sh);
  let imgData: ImageData;
  try {
    imgData = ctx.getImageData(0, 0, sw, sh);
  } catch {
    return { sharpness: 50, brightness: 128 };
  }

  const d = imgData.data;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  let brightSum = 0;

  // Amostragem com salto para velocidade ultrarrápida
  for (let y = 2; y < sh - 2; y += 2) {
    for (let x = 2; x < sw - 2; x += 2) {
      const idx = (y * sw + x) * 4;
      const c = d[idx] * 0.299 + d[idx + 1] * 0.587 + d[idx + 2] * 0.114;
      brightSum += c;

      const up = d[((y - 2) * sw + x) * 4] * 0.299 + d[((y - 2) * sw + x) * 4 + 1] * 0.587 + d[((y - 2) * sw + x) * 4 + 2] * 0.114;
      const down = d[((y + 2) * sw + x) * 4] * 0.299 + d[((y + 2) * sw + x) * 4 + 1] * 0.587 + d[((y + 2) * sw + x) * 4 + 2] * 0.114;
      const left = d[(y * sw + (x - 2)) * 4] * 0.299 + d[(y * sw + (x - 2)) * 4 + 1] * 0.587 + d[(y * sw + (x - 2)) * 4 + 2] * 0.114;
      const right = d[(y * sw + (x + 2)) * 4] * 0.299 + d[(y * sw + (x + 2)) * 4 + 1] * 0.587 + d[(y * sw + (x + 2)) * 4 + 2] * 0.114;

      const lap = up + down + left + right - 4 * c;
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }

  const mean = count > 0 ? sum / count : 0;
  const variance = count > 0 ? (sumSq / count) - (mean * mean) : 0;
  const avgBrightness = count > 0 ? brightSum / count : 0;

  return { sharpness: Math.max(0, variance), brightness: avgBrightness };
}

export function CameraCapture({
  onCapture,
  onCancel,
  keepStreamAlive = false,
  isCaptureActive = true,
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isMountedRef = useRef(true);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);

  // Callback ref para garantir que o elemento <video> receba o stream imediatamente ao ser anexado
  const handleVideoRef = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (node && streamRef.current) {
      if (node.srcObject !== streamRef.current) {
        node.srcObject = streamRef.current;
      }
      node.setAttribute('playsinline', 'true');
      node.setAttribute('webkit-playsinline', 'true');
      node.play().catch(() => {});
    }
  }, []);
  
  // Modo padrão da câmera: inicia na traseira (ideal para leitura de etiquetas)
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  const [cameraError, setCameraError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Estados de Zoom (inicia obrigatoriamente em 2x) e Lanterna
  const [currentZoom, setCurrentZoom] = useState<number>(2);
  const [hasHardwareZoom, setHasHardwareZoom] = useState(false);
  const [maxHardwareZoom, setMaxHardwareZoom] = useState(2);
  const [hasTorch, setHasTorch] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);

  // Estados de Análise Contínua em Tempo Real e Foco/Anti-Tremor
  const [isLiveAnalyzing, setIsLiveAnalyzing] = useState(false);
  const [isDetected, setIsDetected] = useState(false);
  const [isSteady, setIsSteady] = useState(false);
  const [isLocalOcrActive, setIsLocalOcrActive] = useState(false);

  // Travas atômicas contra capturas ou envios duplicados
  const autoCaptureFiredRef = useRef(false);
  const isProcessingRef = useRef(false);

  // Economia inteligente de tokens (Detector de Câmera Parada / Anti-Idle)
  const lastSharpnessRef = useRef<number>(0);
  const consecutiveStaticRef = useRef<number>(0);

  // Sincroniza ativamente o stream com o elemento de vídeo sempre que o estado mudar
  useEffect(() => {
    if (videoRef.current && stream) {
      if (videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
      }
      videoRef.current.setAttribute('playsinline', 'true');
      videoRef.current.setAttribute('webkit-playsinline', 'true');
      videoRef.current.play().catch(() => {});
    }
  }, [stream]);

  // Função centralizada para desligar completamente a câmera e liberar o hardware
  const stopCamera = useCallback(() => {
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
      if (videoRef.current.srcObject) {
        try {
          const s = videoRef.current.srcObject as MediaStream;
          s.getTracks?.().forEach((t) => {
            try {
              t.stop();
              t.enabled = false;
            } catch {}
          });
        } catch {}
        videoRef.current.srcObject = null;
      }
    }

    setStream(null);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    setIsDetected(false);
    setIsSteady(false);
    autoCaptureFiredRef.current = false;
    isProcessingRef.current = false;

    // Desliga qualquer stream anterior antes de iniciar novo
    stopCamera();

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1920, min: 1280 },
          height: { ideal: 1080, min: 720 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

      // Se o componente foi desmontado enquanto o usuário dava permissão, encerra imediatamente!
      if (!isMountedRef.current) {
        mediaStream.getTracks().forEach((t) => {
          try {
            t.stop();
            t.enabled = false;
          } catch {}
        });
        return;
      }

      // Tenta acionar foco contínuo, exposição de alta nitidez, lanterna e zoom 2x nativo no hardware da câmera
      try {
        const track = mediaStream.getVideoTracks()[0];
        if (track) {
          const capabilities = (track.getCapabilities?.() as any) || {};
          const adv: any = {};
          if (capabilities.focusMode && Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes('continuous')) {
            adv.focusMode = 'continuous';
          }
          if (capabilities.exposureMode && Array.isArray(capabilities.exposureMode) && capabilities.exposureMode.includes('continuous')) {
            adv.exposureMode = 'continuous';
          }
          if ('torch' in capabilities) {
            setHasTorch(true);
          }
          if (capabilities.zoom) {
            setHasHardwareZoom(true);
            const zMax = Math.min(Number(capabilities.zoom.max) || 2, 5);
            setMaxHardwareZoom(zMax);
            const targetZ = Math.min(Math.max(2, capabilities.zoom.min || 1), zMax);
            adv.zoom = targetZ; // Abre já com 2x no hardware!
            setCurrentZoom(targetZ);
          } else {
            setHasHardwareZoom(false);
            setCurrentZoom(2); // Inicia com 2x digital
          }
          if (Object.keys(adv).length > 0) {
            await track.applyConstraints({ advanced: [adv] });
          }
        }
      } catch {}

      streamRef.current = mediaStream;
      setStream(mediaStream);

      if (typeof window !== 'undefined') {
        localStorage.setItem('condobox_camera_facing', facingMode);
      }

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.setAttribute('webkit-playsinline', 'true');
        videoRef.current.play().catch(() => {});
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        console.warn('Primeira tentativa da câmera falhou, tentando fallback genérico...', err);
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          if (!isMountedRef.current) {
            fallbackStream.getTracks().forEach((t) => {
              try { t.stop(); t.enabled = false; } catch {}
            });
            return;
          }
          
          streamRef.current = fallbackStream;
          setStream(fallbackStream);
          
          if (videoRef.current) {
            videoRef.current.srcObject = fallbackStream;
            videoRef.current.setAttribute('playsinline', 'true');
            videoRef.current.setAttribute('webkit-playsinline', 'true');
            videoRef.current.play().catch(() => {});
          }
        } catch (fallbackErr) {
          console.warn('Fallback da câmera também falhou:', fallbackErr);
          setCameraError('Não foi possível acessar a câmera do dispositivo. Use o botão de upload de foto.');
        }
      }
    }
  }, [facingMode, stopCamera]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      const savedFacing = localStorage.getItem('condobox_camera_facing');
      if (savedFacing === 'user' || savedFacing === 'environment') {
        setFacingMode(savedFacing);
      } else {
        setFacingMode(isMobile ? 'environment' : 'user');
      }
    }
  }, []);

  // Ciclo de vida da Câmera: Inicia e garante desligamento em navegações, troca de aba e unmount
  useEffect(() => {
    isMountedRef.current = true;
    autoCaptureFiredRef.current = false;
    isProcessingRef.current = false;

    startCamera();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        stopCamera();
      } else if (document.visibilityState === 'visible' && !capturedBlob && isMountedRef.current) {
        startCamera();
      }
    };

    window.addEventListener('beforeunload', stopCamera);
    window.addEventListener('pagehide', stopCamera);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMountedRef.current = false;
      stopCamera();
      window.removeEventListener('beforeunload', stopCamera);
      window.removeEventListener('pagehide', stopCamera);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [facingMode, startCamera, stopCamera]);
 
  // Gerenciamento de fluxo contínuo quando keepStreamAlive está ativado
  useEffect(() => {
    if (!keepStreamAlive) return;

    if (isCaptureActive) {
      // Reativando a captura (ex: após salvar encomenda anterior)
      autoCaptureFiredRef.current = false;
      isProcessingRef.current = false;
      setCapturedBlob(null);
      setCapturedPreview(null);
      setIsDetected(false);
      setIsSteady(false);

      const restorePlayback = () => {
        const video = videoRef.current;
        const currentStream = streamRef.current;
        const hasLiveTracks = currentStream?.getVideoTracks().some((t) => t.readyState === 'live');

        if (!hasLiveTracks || !currentStream) {
          startCamera();
        } else if (video) {
          video.muted = true;
          video.setAttribute('playsinline', 'true');
          video.setAttribute('webkit-playsinline', 'true');
          if (video.srcObject !== currentStream) {
            video.srcObject = currentStream;
          }
          video.play().catch(() => {
            startCamera();
          });
        }
      };

      restorePlayback();
      const t1 = setTimeout(restorePlayback, 80);
      const t2 = setTimeout(restorePlayback, 250);
      const t3 = setTimeout(restorePlayback, 600);

      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    } else {
      // Pausado durante a confirmação de dados para economizar CPU
      autoCaptureFiredRef.current = true;
      isProcessingRef.current = true;
    }
  }, [isCaptureActive, keepStreamAlive, startCamera]);

  // Watchdog de saúde da câmera: detecta e reanima vídeo pausado, tela preta ou stream interrompido
  useEffect(() => {
    if (!isCaptureActive || capturedBlob) return;

    const watchdog = setInterval(() => {
      const v = videoRef.current;
      const s = streamRef.current;
      if (!isMountedRef.current || !v) return;

      const hasLiveTracks = s?.getVideoTracks().some((t) => t.readyState === 'live');
      if (!hasLiveTracks || !s) {
        startCamera();
        return;
      }

      if (v.srcObject !== s) {
        v.srcObject = s;
      }

      if (v.paused || v.readyState < 2) {
        v.play().catch(() => {
          startCamera();
        });
      }
    }, 800);

    return () => clearInterval(watchdog);
  }, [isCaptureActive, capturedBlob, startCamera]);

  const switchCamera = () => {
    stopCamera();
    const nextFacing = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextFacing);
    if (typeof window !== 'undefined') {
      localStorage.setItem('condobox_camera_facing', nextFacing);
    }
  };

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

  const toggleZoom = async () => {
    const nextZoom = currentZoom === 2 ? 1 : 2;
    setCurrentZoom(nextZoom);
    if (hasHardwareZoom && streamRef.current) {
      const track = streamRef.current.getVideoTracks()[0];
      if (track) {
        try {
          await track.applyConstraints({ advanced: [{ zoom: nextZoom } as any] });
        } catch (err) {
          console.warn('Falha ao alternar zoom no hardware:', err);
        }
      }
    }
  };

  // ─── Captura Rápida de Alta Fidelidade (Instantânea, ~15ms) ──────────────────
  const captureHighResShot = useCallback(async (
    targetDim = 1280,
    quality = 0.82
  ): Promise<{ blob: Blob; previewUrl: string } | null> => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return null;
    const vw = video.videoWidth || targetDim;
    const vh = video.videoHeight || Math.round(targetDim * 0.75);
    let w = vw;
    let h = vh;
    if (w > targetDim || h > targetDim) {
      if (w > h) {
        h = Math.round((h * targetDim) / w);
        w = targetDim;
      } else {
        w = Math.round((w * targetDim) / h);
        h = targetDim;
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const isDigitalZoom2x = currentZoom === 2 && !hasHardwareZoom;
    const sx = isDigitalZoom2x ? vw * 0.25 : 0;
    const sy = isDigitalZoom2x ? vh * 0.25 : 0;
    const sw = isDigitalZoom2x ? vw * 0.5 : vw;
    const sh = isDigitalZoom2x ? vh * 0.5 : vh;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);

    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob) return null;
    return { blob, previewUrl: URL.createObjectURL(blob) };
  }, [currentZoom, hasHardwareZoom]);

  // ─── Captura em Rajada (Burst Best-Shot) Anti-Tremor para fotos manuais ─────
  const captureBestShot = useCallback(async (
    targetDim = 1440,
    quality = 0.88
  ): Promise<{ blob: Blob; previewUrl: string; sharpness: number } | null> => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return null;

    const candidates: Array<{ blob: Blob; sharpness: number }> = [];

    for (let i = 0; i < 3; i++) {
      if (!video || video.readyState < 2) break;
      const metric = calculateFrameSharpness(video);

      let width = video.videoWidth || targetDim;
      let height = video.videoHeight || Math.round(targetDim * 0.75);
      if (width > targetDim || height > targetDim) {
        if (width > height) {
          height = Math.round((height * targetDim) / width);
          width = targetDim;
        } else {
          width = Math.round((width * targetDim) / height);
          height = targetDim;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        const isDigitalZoom2x = currentZoom === 2 && !hasHardwareZoom;
        const sx = isDigitalZoom2x ? (video.videoWidth || width) * 0.25 : 0;
        const sy = isDigitalZoom2x ? (video.videoHeight || height) * 0.25 : 0;
        const sw = isDigitalZoom2x ? (video.videoWidth || width) * 0.5 : (video.videoWidth || width);
        const sh = isDigitalZoom2x ? (video.videoHeight || height) * 0.5 : (video.videoHeight || height);
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);

        const blob = await new Promise<Blob | null>((res) =>
          canvas.toBlob((b) => res(b), 'image/jpeg', quality)
        );

        if (blob) {
          candidates.push({ blob, sharpness: metric.sharpness });
        }
      }

      if (i < 2) {
        await new Promise((r) => setTimeout(r, 40));
      }
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => b.sharpness - a.sharpness);
    const best = candidates[0];
    const previewUrl = URL.createObjectURL(best.blob);

    return { blob: best.blob, previewUrl, sharpness: best.sharpness };
  }, [currentZoom, hasHardwareZoom]);

  // Captura Manual com Anti-Tremor Instantânea
  const takeSnapshot = useCallback(async () => {
    if (!videoRef.current || autoCaptureFiredRef.current || isProcessingRef.current) return;
    isProcessingRef.current = true;
    autoCaptureFiredRef.current = true;
    setIsDetected(true);

    try {
      navigator.vibrate?.([40, 40, 80]);
    } catch {}

    const shot = (await captureHighResShot(1280, 0.84)) || (await captureBestShot(1280, 0.84));
    if (!shot) {
      isProcessingRef.current = false;
      autoCaptureFiredRef.current = false;
      setIsDetected(false);
      return;
    }

    setCapturedBlob(shot.blob);
    setCapturedPreview(shot.previewUrl);
    if (!keepStreamAlive) {
      stopCamera();
    }
    onCapture(shot.blob, shot.previewUrl);
  }, [captureHighResShot, captureBestShot, onCapture, stopCamera, keepStreamAlive]);

  // ─── Análise em Tempo Real Ultra-Rápida e Sem Tremor ───────────────────────
  useEffect(() => {
    if (!stream || capturedBlob || autoCaptureFiredRef.current) return;

    let isScanning = false;
    let scanTimeout: NodeJS.Timeout | null = null;
    let isActive = true;

    // Barcode Detector nativo se disponível no navegador (Chromium/Android/Edge)
    let barcodeDetector: any = null;
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        barcodeDetector = new (window as any).BarcodeDetector({
          formats: ['code_128', 'code_39', 'ean_13', 'itf', 'qr_code', 'data_matrix', 'upc_a']
        });
      } catch {}
    }

    const runLiveScan = async () => {
      if (!isMountedRef.current || !isActive || isScanning || capturedBlob || autoCaptureFiredRef.current || isProcessingRef.current) {
        return;
      }

      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        if (isActive && isMountedRef.current && !autoCaptureFiredRef.current) {
          scanTimeout = setTimeout(runLiveScan, 300);
        }
        return;
      }

      // 1. Checagem instantânea de nitidez / tremor (< 1ms)
      const sharpnessMetrics = calculateFrameSharpness(video);
      const isSharp = sharpnessMetrics.sharpness >= 15;
      const isBrightEnough = sharpnessMetrics.brightness >= 14;
      
      setIsSteady(isSharp && isBrightEnough);

      // Se a imagem estiver em movimento/borrada, aguarda estabilização rápida
      if (!isSharp || !isBrightEnough) {
        if (isActive && isMountedRef.current && !autoCaptureFiredRef.current) {
          scanTimeout = setTimeout(runLiveScan, 180);
        }
        return;
      }

      // Economia inteligente de tokens (Detector de Câmera Parada / Anti-Idle):
      // Se a nitidez não variou (câmera parada apontada pro mesmo local sem etiqueta),
      // desacelera as chamadas para poupar tokens.
      const sharpnessDelta = Math.abs(sharpnessMetrics.sharpness - lastSharpnessRef.current);
      lastSharpnessRef.current = sharpnessMetrics.sharpness;
      if (sharpnessDelta < 2.5) {
        consecutiveStaticRef.current++;
      } else {
        consecutiveStaticRef.current = 0;
      }

      // 2. Detecção de código de barras local instantânea (0ms e 0 tokens)
      let instantBarcode: string | null = null;
      if (barcodeDetector) {
        try {
          const codes = await barcodeDetector.detect(video);
          if (codes && codes.length > 0) {
            const raw = codes[0]?.rawValue?.trim();
            if (raw && raw.length >= 6) {
              instantBarcode = raw;
            }
          }
        } catch {}
      }

      isScanning = true;
      setIsLiveAnalyzing(true);

      try {
        // Captura frame otimizado e leve (720px JPEG @ 0.70 - ~45KB) para envio ultrarrápido ao OCR
        const frameBlob = await new Promise<Blob | null>((resolve) => {
          const targetDim = 720;
          let w = video.videoWidth || targetDim;
          let h = video.videoHeight || Math.round(targetDim * 0.75);
          if (w > targetDim || h > targetDim) {
            if (w > h) {
              h = Math.round((h * targetDim) / w);
              w = targetDim;
            } else {
              w = Math.round((w * targetDim) / h);
              h = targetDim;
            }
          }
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const ctx = c.getContext('2d');
          if (!ctx) return resolve(null);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'medium';

          const isDigitalZoom2x = currentZoom === 2 && !hasHardwareZoom;
          const sx = isDigitalZoom2x ? (video.videoWidth || w) * 0.25 : 0;
          const sy = isDigitalZoom2x ? (video.videoHeight || h) * 0.25 : 0;
          const sw = isDigitalZoom2x ? (video.videoWidth || w) * 0.5 : (video.videoWidth || w);
          const sh = isDigitalZoom2x ? (video.videoHeight || h) * 0.5 : (video.videoHeight || h);
          ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);

          c.toBlob((b) => resolve(b), 'image/jpeg', 0.70);
        });

        if (!frameBlob || !isMountedRef.current || !isActive || autoCaptureFiredRef.current) {
          return;
        }

        const fd = new FormData();
        fd.append('file', frameBlob, 'live.jpg');

        const liveRes = await fetch('/api/ocr-live', {
          method: 'POST',
          body: fd,
          signal: AbortSignal.timeout(4500),
        });

        if (!liveRes.ok || autoCaptureFiredRef.current || !isMountedRef.current || !isActive) {
          return;
        }

        const liveOcr = await liveRes.json();
        
        // Rastreia se estamos em modo fallback de OCR local
        if (liveOcr?.provider === 'tesseract_local' || liveOcr?.provider === 'easyocr_local') {
          setIsLocalOcrActive(true);
        } else if (liveOcr?.provider === 'gemini') {
          setIsLocalOcrActive(false);
        }

        // Se pegamos barcode nativo localmente e a IA não pegou rastreio, mescla
        if (instantBarcode && !liveOcr.trackingCode) {
          liveOcr.trackingCode = instantBarcode;
        }

        const unitClean = liveOcr?.unitNumber
          ? String(liveOcr.unitNumber).replace(/\D/g, '')
          : '';
        const hasRecipient = typeof liveOcr?.recipientName === 'string' && liveOcr.recipientName.trim().length >= 3;
        const hasTracking = typeof liveOcr?.trackingCode === 'string' && liveOcr.trackingCode.trim().length >= 5;
        const hasUnit = unitClean.length >= 1 && unitClean.length <= 5;

        // Validação rigorosa e ágil para evitar leituras erradas
        const detected =
          (hasUnit || (hasRecipient && hasTracking)) &&
          (typeof liveOcr.confidence === 'number' ? liveOcr.confidence >= 0.45 : true);

        if (!detected || autoCaptureFiredRef.current || isProcessingRef.current || !isMountedRef.current || !isActive) {
          return;
        }

        // Lock atômico contra leituras duplicadas simultâneas
        autoCaptureFiredRef.current = true;
        isProcessingRef.current = true;
        setIsDetected(true);

        try {
          navigator.vibrate?.([50, 50, 100]);
        } catch {}

        // Captura instantânea em alta resolução sem atraso de rajada (~15ms)
        const bestShot = (await captureHighResShot(1280, 0.84)) || { blob: frameBlob, previewUrl: URL.createObjectURL(frameBlob) };
        const finalBlob = bestShot.blob;
        const finalPreviewUrl = bestShot.previewUrl;

        setCapturedBlob(finalBlob);
        setCapturedPreview(finalPreviewUrl);
        if (!keepStreamAlive) {
          stopCamera();
        }

        const partialOcr = {
          ocr: {
            recipientName: liveOcr.recipientName || null,
            block: liveOcr.block || null,
            unitNumber: liveOcr.unitNumber || null,
            carrier: liveOcr.carrier || 'Mercado Livre',
            trackingCode: liveOcr.trackingCode || instantBarcode || null,
            invoiceNumber: null,
            confidence: liveOcr.confidence || 0.95,
          },
          suggestedMatch: { unit: null, resident: null },
          image: { path: '', url: finalPreviewUrl },
          success: true,
        };

        // Transição e preenchimento instantâneo sem atraso
        onCapture(finalBlob, finalPreviewUrl, partialOcr as any);

        // Enriquecimento completo em background
        const fd2 = new FormData();
        fd2.append('file', finalBlob, 'label.jpg');
        fetch('/api/upload', { method: 'POST', body: fd2 })
          .then((r) => r.ok && r.json())
          .then((fullOcr) => {
            if (fullOcr) {
              window.dispatchEvent(new CustomEvent('ocr-enriched', { detail: fullOcr }));
            }
          })
          .catch(() => {});

        return;
      } catch {
        // Silencioso para não travar o loop de leitura contínua
      } finally {
        isScanning = false;
        if (isMountedRef.current && isActive) {
          setIsLiveAnalyzing(false);
          if (!autoCaptureFiredRef.current) {
            // Cadência adaptativa ultrarrápida: 450ms normal, ou 1200ms se câmera parada sem etiqueta
            const nextDelay = consecutiveStaticRef.current >= 3 ? 1200 : 450;
            scanTimeout = setTimeout(runLiveScan, nextDelay);
          }
        }
      }
    };

    scanTimeout = setTimeout(runLiveScan, 300);

    return () => {
      isActive = false;
      if (scanTimeout) clearTimeout(scanTimeout);
    };
  }, [stream, capturedBlob, captureBestShot, onCapture, stopCamera, currentZoom, hasHardwareZoom]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const previewUrl = URL.createObjectURL(file);
      setCapturedBlob(file);
      setCapturedPreview(previewUrl);
      stopCamera();
      onCapture(file, previewUrl);
    }
  };

  const retakePhoto = () => {
    if (capturedPreview) {
      URL.revokeObjectURL(capturedPreview);
    }
    setCapturedBlob(null);
    setCapturedPreview(null);
    setIsDetected(false);
    setIsSteady(false);
    setIsLocalOcrActive(false);
    autoCaptureFiredRef.current = false;
    isProcessingRef.current = false;
    startCamera();
  };

  return (
    <div className="flex flex-col items-center w-full max-w-xl mx-auto bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl p-4 sm:p-5">
      {/* Top Header */}
      <div className="w-full flex items-center justify-between pb-3 mb-2 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <Camera className="w-5 h-5 text-emerald-400" />
          <h3 className="text-sm font-bold text-slate-100">
            {capturedPreview ? 'Foto da Encomenda' : 'Posicione a Etiqueta da Encomenda'}
          </h3>
        </div>

        {onCancel && (
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onCancel();
            }}
            className="p-1 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Dica para liberar câmera permanentemente no iPhone */}
      <div className="w-full flex items-center justify-between text-[11px] text-slate-400 bg-slate-950/80 px-3 py-1.5 rounded-xl mb-2.5 border border-slate-800/60">
        <span className="flex items-center gap-1.5 flex-wrap">
          <span className="text-amber-400 font-bold">💡 No iPhone:</span>
          <span>Toque em <b>aA</b> (na barra do Safari) &gt; <b>Ajustes do Site</b> &gt; <b>Câmera: Permitir</b> para nunca mais pedir.</span>
        </span>
      </div>

      {/* Viewport da Câmera ou Preview com Guia Visual Anti-Tremor */}
      <div 
        onClick={() => {
          if (videoRef.current) {
            if (videoRef.current.paused) {
              videoRef.current.play().catch(() => startCamera());
            } else if (videoRef.current.readyState < 2) {
              startCamera();
            }
          }
        }}
        className="relative w-full h-[58vh] sm:h-[62vh] min-h-[440px] max-h-[680px] bg-black rounded-2xl overflow-hidden flex items-center justify-center border border-slate-800 shadow-inner cursor-pointer"
      >
        {/* Vídeo SEMPRE montado no DOM para nunca perder o stream ou renderizar tela preta */}
        <video
          ref={handleVideoRef}
          autoPlay
          playsInline
          muted
          controls={false}
          disablePictureInPicture
          // @ts-ignore
          webkit-playsinline="true"
          onPause={() => {
            if (isCaptureActive && !capturedBlob && streamRef.current) {
              videoRef.current?.play().catch(() => {});
            }
          }}
          onLoadedMetadata={() => {
            videoRef.current?.play().catch(() => {});
          }}
          onCanPlay={() => {
            videoRef.current?.play().catch(() => {});
          }}
          style={{
            transform: currentZoom === 2 && !hasHardwareZoom ? 'scale(2)' : 'scale(1)',
            transformOrigin: 'center center',
            transition: 'transform 0.2s ease-out',
          }}
          className={`w-full h-full object-cover pointer-events-none select-none ${
            capturedPreview || cameraError ? 'hidden' : 'block'
          }`}
        />

        {capturedPreview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={capturedPreview}
            alt="Etiqueta capturada"
            className="w-full h-full object-contain bg-black"
          />
        )}

        {cameraError && !capturedPreview && (
          <div className="p-6 text-center text-slate-400 flex flex-col items-center gap-3">
            <p className="text-sm">{cameraError}</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-medium transition"
            >
              <Upload className="w-4 h-4" /> Selecionar Foto da Galeria
            </button>
          </div>
        )}

        {!capturedPreview && !cameraError && (
          <>
            {/* Controles Flutuantes da Câmera (Lanterna, Zoom 2x/1x e Alternar Câmera) */}
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

              <button
                type="button"
                onClick={toggleZoom}
                className={`px-3 py-2 rounded-xl text-xs font-black border backdrop-blur-md transition shadow-md ${
                  currentZoom === 2
                    ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-emerald-500/30'
                    : 'bg-slate-900/80 text-slate-300 border-slate-700 hover:bg-slate-800'
                }`}
                title="Alternar Zoom da Câmera (Inicia em 2x)"
              >
                {currentZoom}x
              </button>

              <button
                type="button"
                onClick={switchCamera}
                className="p-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-700 backdrop-blur-md transition"
                title="Alternar Câmera Traseira / Frontal"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>

            {/* Overlay com Badges Informativos */}
            <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-4">
              {/* Badge de Análise e Estabilidade no topo */}
              <div className="self-center flex items-center gap-2 bg-black/85 backdrop-blur-md px-4 py-2 rounded-full border border-slate-700/60 shadow-xl transition-all">
                {isDetected ? (
                  <>
                    <Zap className="w-4 h-4 text-emerald-400 animate-bounce" />
                    <span className="text-xs font-bold text-emerald-300">
                      ⚡ Etiqueta Identificada com Sucesso!
                    </span>
                  </>
                ) : isLocalOcrActive ? (
                  <>
                    <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
                    <span className="text-xs font-semibold text-cyan-300">
                      🛡️ Modo Local Ativo (Sem gastar tokens)
                    </span>
                  </>
                ) : isSteady ? (
                  <>
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-xs font-semibold text-emerald-300">
                      {isLiveAnalyzing ? '🔍 Lendo etiqueta ao vivo...' : 'Firme • Aponte para a etiqueta'}
                    </span>
                  </>
                ) : (
                  <>
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
                    <span className="text-xs font-medium text-amber-300">
                      Mantenha a câmera firme para focar...
                    </span>
                  </>
                )}
              </div>

              {/* Rodapé informativo discreto */}
              <div className="self-center flex items-center gap-2 bg-black/75 px-3 py-1 rounded-full border border-slate-800">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-[11px] text-slate-300 font-mono">
                  Anti-tremor ativo • Apto • Morador • Rastreio
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Controles Principais */}
      <div className="w-full mt-4 flex items-center justify-between gap-3">
        <input
          type="file"
          ref={fileInputRef}
          accept="image/*"
          capture="environment"
          onChange={handleFileUpload}
          className="hidden"
        />

        {capturedPreview ? (
          <button
            type="button"
            onClick={retakePhoto}
            className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-sm transition"
          >
            <RefreshCw className="w-4 h-4" /> Tirar Outra Foto
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
            >
              <Upload className="w-4 h-4" /> Galeria / Arquivo
            </button>

            {/* Alternar Câmera (Traseira / Frontal) */}
            <button
              type="button"
              onClick={switchCamera}
              className="p-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
              title="Alternar entre Câmera Traseira e Frontal"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={takeSnapshot}
              className="flex-1 flex items-center justify-center gap-2 py-3 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-950 transition active:scale-95"
            >
              <Camera className="w-4 h-4" /> Fotografar Agora
            </button>
          </>
        )}
      </div>
    </div>
  );
}

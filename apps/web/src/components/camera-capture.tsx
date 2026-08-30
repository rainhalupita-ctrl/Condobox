'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Camera, RefreshCw, Check, X, Upload, Sparkles, Scan, Zap } from 'lucide-react';
import { LocalApiClient, OCRResponse } from '../lib/local-api';

interface CameraCaptureProps {
  onCapture: (blob: Blob, previewUrl: string, precalculatedOcr?: OCRResponse) => void;
  onCancel?: () => void;
}

export function CameraCapture({ onCapture, onCancel }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>(() => {
    if (typeof window !== 'undefined') {
      const savedFacing = localStorage.getItem('condobox_camera_facing');
      if (savedFacing === 'user' || savedFacing === 'environment') return savedFacing;
    }
    return 'environment';
  });
  const [cameraError, setCameraError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Estados de Análise Contínua em Tempo Real
  const [isLiveAnalyzing, setIsLiveAnalyzing] = useState(false);
  const [isDetected, setIsDetected] = useState(false);
  const autoCaptureFiredRef = useRef(false);

  useEffect(() => {
    autoCaptureFiredRef.current = false;
    startCamera();
    return () => {
      stopCamera();
    };
  }, [facingMode]);

  const startCamera = async () => {
    setCameraError(null);
    setIsDetected(false);
    autoCaptureFiredRef.current = false;

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: facingMode }
        },
        audio: false
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(mediaStream);

      if (typeof window !== 'undefined') {
        localStorage.setItem('condobox_camera_permission', 'granted');
        localStorage.setItem('condobox_camera_facing', facingMode);
        document.cookie = 'condobox_camera_permission=granted; path=/; max-age=31536000; SameSite=Lax';
      }

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.setAttribute('webkit-playsinline', 'true');
        videoRef.current.play().catch(() => {});
      }
    } catch (err: any) {
      console.warn('Câmera nativa não disponível:', err);
      setCameraError('Não foi possível acessar a câmera do dispositivo. Use o botão de upload de foto.');
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => {
        track.stop();
        track.enabled = false;
      });
      setStream(null);
    }
  };

  const switchCamera = () => {
    stopCamera();
    const nextFacing = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextFacing);
    if (typeof window !== 'undefined') {
      localStorage.setItem('condobox_camera_facing', nextFacing);
      localStorage.removeItem('condobox_camera_device_id');
    }
  };

  // Captura Manual
  const takeSnapshot = useCallback(() => {
    if (!videoRef.current || autoCaptureFiredRef.current) return;
    autoCaptureFiredRef.current = true;
    setIsDetected(true);

    try {
      navigator.vibrate?.([40, 40, 80]);
    } catch {}

    const video = videoRef.current;
    const maxDim = 800;
    let width = video.videoWidth || 800;
    let height = video.videoHeight || 600;

    if (width > maxDim || height > maxDim) {
      if (width > height) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, width, height);

    canvas.toBlob(blob => {
      if (blob) {
        const previewUrl = URL.createObjectURL(blob);
        setCapturedBlob(blob);
        setCapturedPreview(previewUrl);
        stopCamera();
        onCapture(blob, previewUrl);
      }
    }, 'image/jpeg', 0.78);
  }, [onCapture]);

  // Análise em Tempo Real em Segundo Plano enquanto a câmera estiver aberta
  useEffect(() => {
    if (!stream || capturedBlob || autoCaptureFiredRef.current) return;

    let isScanning = false;
    const interval = setInterval(async () => {
      if (
        autoCaptureFiredRef.current ||
        !videoRef.current ||
        videoRef.current.readyState < 2 ||
        isScanning
      ) {
        return;
      }

      isScanning = true;
      setIsLiveAnalyzing(true);

      try {
        const video = videoRef.current;
        const maxDim = 720;
        let width = video.videoWidth || 720;
        let height = video.videoHeight || 480;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          isScanning = false;
          setIsLiveAnalyzing(false);
          return;
        }

        ctx.drawImage(video, 0, 0, width, height);

        // Checagem visual rápida: Descarta quadros pretos, escuros ou sem contraste
        try {
          const imgData = ctx.getImageData(0, 0, width, height);
          const pixels = imgData.data;
          let brightnessSum = 0;
          let count = 0;
          for (let i = 0; i < pixels.length; i += 40) {
            brightnessSum += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
            count++;
          }
          const avgBrightness = brightnessSum / count;
          // Se a imagem for quase preta (< 30) ou branca estourada (> 245), descarta imediatamente
          if (avgBrightness < 30 || avgBrightness > 245) {
            isScanning = false;
            setIsLiveAnalyzing(false);
            return;
          }
        } catch {}

        canvas.toBlob(async (blob) => {
          if (!blob || autoCaptureFiredRef.current) {
            isScanning = false;
            setIsLiveAnalyzing(false);
            return;
          }

          try {
            const ocrResult = await LocalApiClient.uploadLabelAndOCR(blob);

            const ocr = ocrResult?.ocr;
            const unitNumberClean = ocr?.unitNumber ? ocr.unitNumber.replace(/\D/g, '') : '';
            
            // A leitura automática ao vivo SÓ deve avançar se identificar com 100% de clareza o Apartamento e/ou Unidade cadastrada
            const hasEssentialFields =
              Boolean(ocr) &&
              (typeof ocr?.confidence !== 'number' || ocr.confidence >= 0.7) &&
              unitNumberClean.length >= 1 &&
              (Boolean(ocrResult?.suggestedMatch?.unit) || Boolean(ocr?.block));

            if (hasEssentialFields && !autoCaptureFiredRef.current) {
              autoCaptureFiredRef.current = true;
              setIsDetected(true);
              clearInterval(interval);

              try {
                navigator.vibrate?.([50, 50, 100]);
              } catch {}

              const previewUrl = URL.createObjectURL(blob);
              setCapturedBlob(blob);
              setCapturedPreview(previewUrl);
              stopCamera();
              onCapture(blob, previewUrl, ocrResult);
              return;
            }
          } catch (err) {
            // Silencioso em background enquanto busca foco na etiqueta
          } finally {
            isScanning = false;
            setIsLiveAnalyzing(false);
          }
        }, 'image/jpeg', 0.75);
      } catch {
        isScanning = false;
        setIsLiveAnalyzing(false);
      }
    }, 1500);

    return () => {
      clearInterval(interval);
    };
  }, [stream, capturedBlob, onCapture]);

  const compressImage = (fileOrBlob: Blob | File): Promise<Blob> => {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(fileOrBlob);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const maxDim = 800;
        let width = img.width;
        let height = img.height;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob((b) => {
            resolve(b || fileOrBlob);
          }, 'image/jpeg', 0.78);
        } else {
          resolve(fileOrBlob);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(fileOrBlob);
      };
      img.src = url;
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const compressed = await compressImage(file);
      const previewUrl = URL.createObjectURL(compressed);
      setCapturedBlob(compressed);
      setCapturedPreview(previewUrl);
      stopCamera();
      onCapture(compressed, previewUrl);
    }
  };

  const retakePhoto = () => {
    if (capturedPreview) {
      URL.revokeObjectURL(capturedPreview);
    }
    setCapturedPreview(null);
    setCapturedBlob(null);
    autoCaptureFiredRef.current = false;
    setIsDetected(false);
    setIsLiveAnalyzing(false);
    startCamera();
  };

  return (
    <div className="flex flex-col items-center w-full max-w-2xl mx-auto bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl p-4">
      <div className="w-full flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
        <div className="flex items-center gap-2">
          <Camera className="w-5 h-5 text-emerald-400" />
          <h3 className="text-sm font-semibold text-slate-200">
            {capturedPreview ? 'Confirmar Foto da Etiqueta' : 'Posicione a Etiqueta da Encomenda'}
          </h3>
        </div>
        {onCancel && (
          <button
            onClick={onCancel}
            className="p-1 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Visualizador da Câmera ou Preview - Otimizado na Vertical */}
      <div className={`relative w-full h-[62vh] min-h-[460px] max-h-[620px] bg-black rounded-2xl overflow-hidden flex items-center justify-center border transition-all duration-300 ${isDetected ? 'border-emerald-400 ring-4 ring-emerald-500/30' : 'border-slate-800 shadow-inner'}`}>
        {capturedPreview ? (
          <img
            src={capturedPreview}
            alt="Etiqueta capturada"
            className="w-full h-full object-contain bg-black"
          />
        ) : cameraError ? (
          <div className="p-6 text-center text-slate-400 flex flex-col items-center gap-3">
            <p className="text-sm">{cameraError}</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-medium transition"
            >
              <Upload className="w-4 h-4" /> Selecionar Foto da Galeria
            </button>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              controls={false}
              disablePictureInPicture
              // @ts-ignore
              webkit-playsinline="true"
              x5-playsinline="true"
              onLoadedMetadata={() => {
                if (videoRef.current) {
                  videoRef.current.play().catch(() => {});
                }
              }}
              className="w-full h-full object-cover pointer-events-none select-none"
            />

            {/* Linha Laser Animada de Scanner Contínuo */}
            <div className="absolute inset-x-6 top-1/3 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_15px_#10b981] animate-pulse pointer-events-none" />

            {/* Grid overlay de enquadramento vertical */}
            <div className="absolute inset-4 sm:inset-6 border-2 border-dashed border-emerald-400/50 rounded-2xl pointer-events-none flex flex-col justify-between p-3">
              {/* Badge de Análise em Tempo Real no topo */}
              <div className="self-center flex items-center gap-2 bg-black/85 backdrop-blur-md px-4 py-2 rounded-full border border-emerald-500/40 shadow-xl">
                {isDetected ? (
                  <>
                    <Zap className="w-4 h-4 text-emerald-400 animate-bounce" />
                    <span className="text-xs font-bold text-emerald-300">
                      ⚡ Etiqueta Identificada com Sucesso!
                    </span>
                  </>
                ) : (
                  <>
                    <div className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    <span className="text-xs font-semibold text-emerald-300">
                      {isLiveAnalyzing ? '🔍 Analisando etiqueta ao vivo...' : 'Aponte para a etiqueta...'}
                    </span>
                  </>
                )}
              </div>

              {/* Rodapé informativo */}
              <span className="text-[11px] text-slate-300 font-mono bg-black/75 px-3 py-1 rounded-full self-center border border-slate-800">
                Apto • Morador • NF • Rastreio
              </span>
            </div>
          </>
        )}
      </div>

      {/* Controles */}
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
          <>
            <button
              type="button"
              onClick={retakePhoto}
              className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-sm transition"
            >
              <RefreshCw className="w-4 h-4" /> Tirar Outra Foto
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
            >
              <Upload className="w-4 h-4" /> Galeria / Arquivo
            </button>

            <button
              type="button"
              onClick={switchCamera}
              className="p-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
              title="Alternar Câmera"
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

'use client';

import React, { useRef, useState, useEffect } from 'react';
import { Camera, RefreshCw, Check, X, Upload } from 'lucide-react';

interface CameraCaptureProps {
  onCapture: (blob: Blob, previewUrl: string) => void;
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

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  }, [facingMode]);

  const startCamera = async () => {
    setCameraError(null);
    try {
      // 1. Tentar reusar o deviceId e configurações salvas em cache/cookies
      let preferredDeviceId: string | null = null;
      if (typeof window !== 'undefined') {
        preferredDeviceId = localStorage.getItem('condobox_camera_device_id');
      }

      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: facingMode }
        },
        audio: false
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(mediaStream);

      // Salvar em cookies e localStorage para persistência de estado
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
      localStorage.removeItem('condobox_camera_device_id'); // Limpa deviceId anterior para achar nova câmera
    }
  };

  const takeSnapshot = () => {
    if (!videoRef.current) return;

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
        stopCamera(); // Desliga o sensor da câmera no celular imediatamente
        onCapture(blob, previewUrl);
      }
    }, 'image/jpeg', 0.78);
  };

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
    }
  };

  const confirmCapture = () => {
    if (capturedBlob && capturedPreview) {
      onCapture(capturedBlob, capturedPreview);
    }
  };

  const retakePhoto = () => {
    if (capturedPreview) {
      URL.revokeObjectURL(capturedPreview);
    }
    setCapturedPreview(null);
    setCapturedBlob(null);
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
      <div className="relative w-full h-[62vh] min-h-[460px] max-h-[620px] bg-black rounded-2xl overflow-hidden flex items-center justify-center border border-slate-800 shadow-inner">
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
            {/* Grid overlay de enquadramento vertical */}
            <div className="absolute inset-4 sm:inset-6 border-2 border-dashed border-emerald-400/50 rounded-2xl pointer-events-none flex flex-col justify-between p-3">
              <span className="text-xs text-emerald-300 font-mono bg-black/80 backdrop-blur-sm px-3 py-1 rounded-full self-center border border-emerald-500/30 shadow-lg">
                Posicione a etiqueta aqui
              </span>
              <span className="text-[11px] text-slate-300 font-mono bg-black/75 px-2.5 py-0.5 rounded-full self-center">
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
              <RefreshCw className="w-4 h-4" /> Tirar Outra
            </button>
            <button
              type="button"
              onClick={confirmCapture}
              className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm shadow-lg shadow-emerald-900/30 transition"
            >
              <Check className="w-4 h-4" /> Usar Foto (OCR)
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-sm transition"
            >
              <Upload className="w-4 h-4" /> Galeria / Arquivo
            </button>

            {!cameraError && (
              <button
                type="button"
                onClick={switchCamera}
                className="p-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                title="Trocar Câmera"
              >
                <RefreshCw className="w-5 h-5" />
              </button>
            )}

            {!cameraError && (
              <button
                type="button"
                onClick={takeSnapshot}
                className="flex items-center gap-2 py-3 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm shadow-lg shadow-emerald-900/30 transition"
              >
                <Camera className="w-5 h-5" /> Fotografar
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

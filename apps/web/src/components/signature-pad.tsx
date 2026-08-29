'use client';

import React, { useRef, useState } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { Eraser, Check, X, PenTool } from 'lucide-react';

interface SignaturePadProps {
  onSave: (signatureBase64: string) => void;
  onCancel?: () => void;
  title?: string;
  recipientName?: string;
}

export function SignaturePad({ onSave, onCancel, title = 'Assinatura Digital de Retirada', recipientName }: SignaturePadProps) {
  const sigPad = useRef<SignatureCanvas | null>(null);
  const [isEmpty, setIsEmpty] = useState(true);

  const handleClear = () => {
    sigPad.current?.clear();
    setIsEmpty(true);
  };

  const handleSave = () => {
    if (sigPad.current && !sigPad.current.isEmpty()) {
      const dataUrl = sigPad.current.getTrimmedCanvas().toDataURL('image/png');
      onSave(dataUrl);
    }
  };

  const handleBegin = () => {
    setIsEmpty(false);
  };

  return (
    <div className="flex flex-col w-full max-w-xl mx-auto bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl p-5">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
        <div className="flex items-center gap-2">
          <PenTool className="w-5 h-5 text-emerald-400" />
          <div>
            <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
            {recipientName && (
              <p className="text-xs text-slate-400">Morador/Recebedor: <span className="text-emerald-400 font-medium">{recipientName}</span></p>
            )}
          </div>
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

      <div className="relative w-full h-56 bg-slate-950 rounded-xl border border-slate-800 overflow-hidden flex flex-col justify-end">
        <SignatureCanvas
          ref={sigPad}
          penColor="#38bdf8"
          backgroundColor="rgba(15, 23, 42, 0.95)"
          canvasProps={{
            className: 'w-full h-full cursor-crosshair touch-none',
          }}
          onBegin={handleBegin}
        />

        {/* Linha guia de assinatura */}
        <div className="absolute bottom-6 left-6 right-6 border-b border-dashed border-slate-700/60 pointer-events-none flex justify-between">
          <span className="text-[10px] text-slate-500 font-mono">Assine na linha acima</span>
          <span className="text-[10px] text-slate-500 font-mono">Validado eletronicamente</span>
        </div>

        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-slate-600 text-sm font-medium">Toque ou use a caneta/dedo para assinar aqui</p>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={handleClear}
          disabled={isEmpty}
          className="flex items-center gap-2 py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Eraser className="w-4 h-4" /> Limpar
        </button>

        <button
          type="button"
          onClick={handleSave}
          disabled={isEmpty}
          className="flex-1 flex items-center justify-center gap-2 py-3 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm shadow-lg shadow-emerald-900/30 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Check className="w-4 h-4" /> Confirmar Entrega
        </button>
      </div>
    </div>
  );
}

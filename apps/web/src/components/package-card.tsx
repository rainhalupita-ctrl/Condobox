'use client';

import React, { useState } from 'react';
import { Package as PackageType } from '../types/database';
import { LocalApiClient } from '../lib/local-api';
import { Package, Clock, CheckCircle2, AlertCircle, Eye, ArrowRight, ShieldCheck } from 'lucide-react';

interface PackageCardProps {
  pkg: PackageType;
  onSelectDeliver?: (pkg: PackageType) => void;
  showActions?: boolean;
}

export function PackageCard({ pkg, onSelectDeliver, showActions = true }: PackageCardProps) {
  const [modalImage, setModalImage] = useState<string | null>(null);

  const getCarrierColor = (carrier: string) => {
    const c = carrier.toLowerCase();
    if (c.includes('mercado livre')) return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30';
    if (c.includes('amazon')) return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
    if (c.includes('shopee')) return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    if (c.includes('correios')) return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
    if (c.includes('shein')) return 'bg-pink-500/20 text-pink-300 border-pink-500/30';
    if (c.includes('magalu')) return 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30';
    return 'bg-slate-700/40 text-slate-300 border-slate-600/40';
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DELIVERED':
        return (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            <CheckCircle2 className="w-3.5 h-3.5" /> Entregue
          </span>
        );
      case 'NOTIFIED':
      case 'RECEIVED':
      default:
        return (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
            <Clock className="w-3.5 h-3.5 animate-pulse" /> Aguardando Retirada
          </span>
        );
    }
  };

  const labelUrl = LocalApiClient.getImageUrl(pkg.label_image_path);
  const signatureUrl = LocalApiClient.getImageUrl(pkg.signature_image_path);

  const formattedDate = new Date(pkg.received_at || Date.now()).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });

  return (
    <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl hover:border-slate-700 transition flex flex-col justify-between gap-4">
      {/* Header do Card */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2.5 rounded-xl bg-slate-800 text-slate-300 border border-slate-700/50">
            <Package className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border ${getCarrierColor(pkg.carrier)}`}>
                {pkg.carrier}
              </span>
              {getStatusBadge(pkg.status)}
            </div>
            <h4 className="text-base font-bold text-slate-100 mt-1">
              {pkg.unit ? `${pkg.unit.block} - Apto ${pkg.unit.unit_number}` : 'Unidade'}
            </h4>
          </div>
        </div>

        {/* Código de retirada destacado */}
        <div className="flex flex-col items-end">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Código</span>
          <span className="text-lg font-black font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2.5 py-0.5 rounded-lg">
            {pkg.pickup_code}
          </span>
        </div>
      </div>

      {/* Detalhes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-300 bg-slate-950/50 p-3 rounded-xl border border-slate-800/80">
        <div>
          <span className="text-slate-500 block">Destinatário:</span>
          <span className="font-medium text-slate-200 truncate block">
            {pkg.resident?.name || pkg.recipient_name_ocr || 'Não identificado'}
          </span>
        </div>
        <div>
          <span className="text-slate-500 block">Recebido em:</span>
          <span className="font-medium text-slate-200">{formattedDate}</span>
        </div>
        {pkg.tracking_code && (
          <div className="col-span-full">
            <span className="text-slate-500 block">Rastreio:</span>
            <span className="font-mono text-slate-300">{pkg.tracking_code}</span>
          </div>
        )}
      </div>

      {/* Thumbnails das Fotos (Etiqueta e Assinatura) */}
      <div className="flex items-center gap-3">
        {labelUrl && (
          <button
            type="button"
            onClick={() => setModalImage(labelUrl)}
            className="group relative flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-xs text-slate-300 transition"
          >
            <Eye className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-400" />
            <span>Foto da Etiqueta</span>
          </button>
        )}

        {pkg.status === 'DELIVERED' && signatureUrl && (
          <button
            type="button"
            onClick={() => setModalImage(signatureUrl)}
            className="group relative flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-xs text-emerald-300 transition"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Assinatura de Retirada</span>
          </button>
        )}
      </div>

      {/* Ações */}
      {showActions && pkg.status !== 'DELIVERED' && onSelectDeliver && (
        <button
          type="button"
          onClick={() => onSelectDeliver(pkg)}
          className="w-full mt-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-semibold shadow-lg shadow-emerald-950 transition"
        >
          <span>Dar Baixa com Assinatura</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      )}

      {/* Modal de visualização de foto ampliada */}
      {modalImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onClick={() => setModalImage(null)}
        >
          <div className="relative max-w-2xl w-full max-h-[90vh] bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl p-4 flex flex-col items-center">
            <img
              src={modalImage}
              alt="Visualização"
              className="max-h-[75vh] w-auto object-contain rounded-xl"
            />
            <button
              onClick={() => setModalImage(null)}
              className="mt-4 px-6 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm font-medium transition"
            >
              Fechar Visualização
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

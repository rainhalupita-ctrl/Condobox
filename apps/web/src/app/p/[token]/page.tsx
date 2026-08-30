'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { LocalApiClient } from '../../../lib/local-api';
import {
  Package,
  Building2,
  User,
  Truck,
  Clock,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Eye,
  ShieldCheck,
  Sparkles,
  RefreshCw,
  QrCode
} from 'lucide-react';

interface PublicPackageData {
  id: string;
  pickup_code: string;
  qr_token: string;
  carrier: string;
  tracking_code?: string | null;
  recipient_name: string;
  status: 'RECEIVED' | 'NOTIFIED' | 'DELIVERED' | 'RETURNED';
  received_at: string;
  delivered_at?: string | null;
  delivered_to_name?: string | null;
  label_image_path?: string | null;
  signature_image_path?: string | null;
  unit?: {
    block: string;
    unit_number: string;
  } | null;
}

export default function PublicPackagePage() {
  const params = useParams();
  const token = params?.token as string;

  const [pkg, setPkg] = useState<PublicPackageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [modalImage, setModalImage] = useState<string | null>(null);

  useEffect(() => {
    if (token) {
      loadPackage();
    }
  }, [token]);

  const loadPackage = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/package/${token}`);
      const data = await res.json();
      if (res.ok && data.package) {
        setPkg(data.package);
      } else {
        setError(data.error || 'Encomenda não encontrada.');
      }
    } catch (err: any) {
      setError('Não foi possível carregar as informações da encomenda.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCode = () => {
    if (pkg?.pickup_code) {
      navigator.clipboard.writeText(pkg.pickup_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const labelUrl = pkg?.label_image_path ? LocalApiClient.getImageUrl(pkg.label_image_path) : null;
  const signatureUrl = pkg?.signature_image_path ? LocalApiClient.getImageUrl(pkg.signature_image_path) : null;

  const formattedDate = pkg?.received_at
    ? new Date(pkg.received_at).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    : '';

  const deliveredDate = pkg?.delivered_at
    ? new Date(pkg.delivered_at).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    : '';

  const isDelivered = pkg?.status === 'DELIVERED';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-start p-4 sm:p-6 selection:bg-emerald-500 selection:text-slate-950">
      {/* Topo / Marca */}
      <div className="w-full max-w-md flex items-center justify-between py-4 mb-2">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-950">
            <Package className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-black tracking-tight text-slate-100">CondoBox</h1>
            <p className="text-[10px] uppercase font-bold tracking-widest text-emerald-400">Retirada de Encomenda</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-900 border border-slate-800 rounded-full text-[11px] text-slate-300 font-medium">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          Portaria 24h
        </div>
      </div>

      {/* Container Principal */}
      <div className="w-full max-w-md">
        {loading ? (
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-12 text-center space-y-4 shadow-2xl backdrop-blur-xl">
            <RefreshCw className="w-10 h-10 text-emerald-400 animate-spin mx-auto" />
            <p className="text-sm font-semibold text-slate-300">Carregando dados da encomenda...</p>
          </div>
        ) : error || !pkg ? (
          <div className="bg-slate-900/90 border border-red-500/30 rounded-3xl p-8 text-center space-y-4 shadow-2xl">
            <div className="w-14 h-14 bg-red-500/20 text-red-400 border border-red-500/30 rounded-2xl flex items-center justify-center mx-auto">
              <AlertCircle className="w-8 h-8" />
            </div>
            <h2 className="text-lg font-bold text-slate-100">Código Não Encontrado</h2>
            <p className="text-xs text-slate-400 max-w-xs mx-auto">
              {error || 'Não foi possível encontrar a encomenda correspondente a este link. Verifique o link recebido no WhatsApp.'}
            </p>
            <button
              onClick={loadPackage}
              className="mt-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition"
            >
              Tentar Novamente
            </button>
          </div>
        ) : (
          <div className="space-y-4 animate-fade-in">
            {/* Status Banner */}
            <div
              className={`p-4 rounded-2xl border flex items-center justify-between gap-3 ${
                isDelivered
                  ? 'bg-blue-950/40 border-blue-800/50 text-blue-300'
                  : 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300'
              }`}
            >
              <div className="flex items-center gap-2.5">
                {isDelivered ? (
                  <CheckCircle2 className="w-5 h-5 text-blue-400 shrink-0" />
                ) : (
                  <Clock className="w-5 h-5 text-emerald-400 animate-pulse shrink-0" />
                )}
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider">
                    {isDelivered ? 'Encomenda Entregue' : 'Disponível na Portaria'}
                  </h3>
                  <p className="text-[11px] opacity-80 mt-0.5">
                    {isDelivered
                      ? `Retirada por ${pkg.delivered_to_name || 'morador'} em ${deliveredDate}`
                      : 'Apresente o QR Code ou código abaixo ao porteiro'}
                  </p>
                </div>
              </div>
            </div>

            {/* CARD PRINCIPAL DO QR CODE E CÓDIGO */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-2xl backdrop-blur-xl text-center space-y-5 relative overflow-hidden">
              <div className="absolute -top-16 -right-16 w-36 h-36 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none"></div>

              {/* QR Code Container */}
              <div className="relative inline-block p-4 bg-white rounded-2xl shadow-xl shadow-slate-950/60 border border-slate-200">
                <QRCodeSVG
                  value={pkg.qr_token || pkg.pickup_code}
                  size={190}
                  level="H"
                  includeMargin={false}
                  className="mx-auto"
                />
              </div>

              {/* Código Numérico de 4 Dígitos */}
              <div className="space-y-1.5">
                <span className="text-[11px] uppercase font-bold tracking-widest text-slate-400">
                  Código de Retirada
                </span>
                <div className="flex items-center justify-center gap-3">
                  <div className="bg-slate-950 border border-emerald-500/40 px-5 py-2 rounded-2xl shadow-inner inline-flex items-center gap-2">
                    <span className="text-3xl sm:text-4xl font-black font-mono tracking-widest text-emerald-400">
                      {pkg.pickup_code}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={handleCopyCode}
                    title="Copiar Código"
                    className="p-3 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-2xl transition active:scale-95 flex items-center justify-center"
                  >
                    {copied ? <Check className="w-5 h-5 text-emerald-400" /> : <Copy className="w-5 h-5" />}
                  </button>
                </div>
                {copied && (
                  <p className="text-[11px] font-semibold text-emerald-400 animate-fade-in">
                    Código copiado para a área de transferência!
                  </p>
                )}
              </div>

              <p className="text-xs text-slate-400 px-4 leading-relaxed">
                💡 O porteiro pode escanear o <strong>QR Code</strong> diretamente da tela do seu celular ou você pode apenas falar o código <strong>{pkg.pickup_code}</strong>.
              </p>
            </div>

            {/* DETALHES DA ENCOMENDA */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-3.5 text-xs text-slate-300">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-emerald-400" />
                Dados de Entrega
              </h4>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800/80">
                  <span className="text-slate-500 block text-[10px] uppercase font-bold">Unidade</span>
                  <span className="font-bold text-slate-100 text-sm mt-0.5 block">
                    {pkg.unit ? `${pkg.unit.block} - Apto ${pkg.unit.unit_number}` : 'Unidade'}
                  </span>
                </div>

                <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800/80">
                  <span className="text-slate-500 block text-[10px] uppercase font-bold">Remetente</span>
                  <span className="font-bold text-slate-100 text-sm mt-0.5 block truncate">
                    {pkg.carrier}
                  </span>
                </div>

                <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800/80">
                  <span className="text-slate-500 block text-[10px] uppercase font-bold">Destinatário</span>
                  <span className="font-semibold text-slate-200 mt-0.5 block truncate">
                    {pkg.recipient_name}
                  </span>
                </div>

                <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800/80">
                  <span className="text-slate-500 block text-[10px] uppercase font-bold">Recebido Em</span>
                  <span className="font-semibold text-slate-200 mt-0.5 block">
                    {formattedDate}
                  </span>
                </div>
              </div>

              {pkg.tracking_code && (
                <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800/80 flex items-center justify-between">
                  <div>
                    <span className="text-slate-500 block text-[10px] uppercase font-bold">Rastreio / NF</span>
                    <span className="font-mono text-slate-200 font-semibold">{pkg.tracking_code}</span>
                  </div>
                  <Truck className="w-4 h-4 text-slate-500" />
                </div>
              )}

              {/* Botão de Ver Foto da Etiqueta */}
              {labelUrl && (
                <button
                  type="button"
                  onClick={() => setModalImage(labelUrl)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-semibold transition border border-slate-700"
                >
                  <Eye className="w-4 h-4 text-emerald-400" />
                  <span>Ver Foto da Etiqueta da Encomenda</span>
                </button>
              )}

              {isDelivered && signatureUrl && (
                <button
                  type="button"
                  onClick={() => setModalImage(signatureUrl)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-emerald-300 rounded-xl font-semibold transition border border-slate-700"
                >
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Ver Assinatura Digital de Entrega</span>
                </button>
              )}
            </div>

            {/* Rodapé Informativo */}
            <div className="text-center py-4 text-[11px] text-slate-500">
              Sistema CondoBox • Portaria Inteligente
            </div>
          </div>
        )}
      </div>

      {/* Modal de Foto Ampliada */}
      {modalImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in"
          onClick={() => setModalImage(null)}
        >
          <div className="relative max-w-lg w-full bg-slate-900 border border-slate-800 rounded-3xl p-4 shadow-2xl flex flex-col items-center space-y-3">
            <img
              src={modalImage}
              alt="Foto da Etiqueta"
              className="max-h-[70vh] w-auto object-contain rounded-2xl"
            />
            <button
              onClick={() => setModalImage(null)}
              className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition"
            >
              Fechar Foto
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

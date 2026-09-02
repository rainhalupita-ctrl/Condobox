'use client';

import React, { useState, useEffect } from 'react';
import { Package as PackageType } from '../types/database';
import { LocalApiClient } from '../lib/local-api';
import { createClient } from '../lib/supabase/client';
import {
  Package,
  Clock,
  CheckCircle2,
  AlertCircle,
  Eye,
  ArrowRight,
  ShieldCheck,
  MessageSquare,
  Send,
  Loader2,
  RefreshCw
} from 'lucide-react';

interface PackageCardProps {
  pkg: PackageType;
  onSelectDeliver?: (pkg: PackageType) => void;
  onPackageUpdated?: () => void;
  showActions?: boolean;
}

export function PackageCard({ pkg, onSelectDeliver, onPackageUpdated, showActions = true }: PackageCardProps) {
  const [modalImage, setModalImage] = useState<string | null>(null);
  const [isSendingWhatsApp, setIsSendingWhatsApp] = useState(false);
  const [whatsAppFeedback, setWhatsAppFeedback] = useState<string | null>(null);
  // true = confirmado que WhatsApp foi enviado em algum momento via notifications_log
  const [wasNotified, setWasNotified] = useState<boolean | null>(null);

  // Verifica se existe log de notificação enviada (SENT) para este pacote
  useEffect(() => {
    if (pkg.status === 'DELIVERED') { setWasNotified(null); return; }
    if (pkg.status === 'NOTIFIED') { setWasNotified(true); return; }

    // Status RECEIVED: verifica se há notificação enviada no log
    const checkNotification = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('notifications_log')
          .select('id, status')
          .eq('package_id', pkg.id)
          .in('status', ['SENT', 'DELIVERED'])
          .limit(1);
        setWasNotified(!!(data && data.length > 0));
      } catch {
        setWasNotified(false);
      }
    };

    checkNotification();

    const onCloseModals = () => setModalImage(null);
    window.addEventListener('condobox:close-modals', onCloseModals);
    return () => window.removeEventListener('condobox:close-modals', onCloseModals);
  }, [pkg.id, pkg.status]);

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

  const isCiente = (pkg as any).notes?.includes('CIENTE');

  const getStatusBadge = () => {
    if (pkg.status === 'DELIVERED') {
      return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
          <CheckCircle2 className="w-3.5 h-3.5" /> Entregue
        </span>
      );
    }

    if (isCiente) {
      return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-teal-500/25 text-teal-300 border border-teal-500/40 shadow-sm">
          <Eye className="w-3.5 h-3.5 text-teal-400" /> Morador Ciente
        </span>
      );
    }

    if (pkg.status === 'NOTIFIED' || wasNotified === true) {
      return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
          <MessageSquare className="w-3.5 h-3.5 text-emerald-400" /> Mensagem Enviada
        </span>
      );
    }

    if (wasNotified === null && pkg.status === 'RECEIVED') {
      // Ainda verificando — mostra shimmer neutro
      return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-700/40 text-slate-400 border border-slate-600/40 animate-pulse">
          <Clock className="w-3.5 h-3.5" /> Verificando...
        </span>
      );
    }

    // wasNotified === false + status RECEIVED: sem mensagem enviada
    return (
      <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
        <Clock className="w-3.5 h-3.5 animate-pulse" /> Aguardando
      </span>
    );
  };

  const handleSendWhatsApp = async (force = false) => {
    setIsSendingWhatsApp(true);
    setWhatsAppFeedback(null);
    try {
      const res = await LocalApiClient.notifyPackage(pkg.id, force);
      if (res.success) {
        if (res.alreadySent) {
          setWhatsAppFeedback('ℹ️ Mensagem já havia sido enviada anteriormente.');
        } else {
          setWhatsAppFeedback('✅ Notificação enviada para o morador!');
        }
        // Atualiza badge local imediatamente
        setWasNotified(true);
        if (onPackageUpdated) onPackageUpdated();
      } else {
        setWhatsAppFeedback(`❌ Erro: ${res.error || 'Falha ao enviar.'}`);
      }
    } catch (err: any) {
      setWhatsAppFeedback(`❌ Erro de conexão: ${err.message}`);
    } finally {
      setIsSendingWhatsApp(false);
      setTimeout(() => setWhatsAppFeedback(null), 5000);
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

  const isEffectivelyNotified = pkg.status === 'NOTIFIED' || wasNotified === true;

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
              {getStatusBadge()}
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
      <div className="grid grid-cols-2 gap-3 text-xs text-slate-300 bg-slate-950/50 p-3 rounded-xl border border-slate-800/80">
        <div className="min-w-0">
          <span className="text-slate-500 block text-[11px] font-medium">Destinatário:</span>
          <span className="font-semibold text-slate-200 truncate block text-xs mt-0.5">
            {pkg.resident?.name || pkg.recipient_name_ocr || 'Não identificado'}
          </span>
        </div>
        <div className="min-w-0">
          <span className="text-slate-500 block text-[11px] font-medium">Recebido em:</span>
          <span className="font-semibold text-slate-200 block text-xs mt-0.5 whitespace-nowrap">
            {formattedDate}
          </span>
        </div>
        {pkg.tracking_code && (
          <div className="col-span-2 pt-1 border-t border-slate-900">
            <span className="text-slate-500 text-[11px] font-medium">Rastreio: </span>
            <span className="font-mono text-slate-300 font-semibold">{pkg.tracking_code}</span>
          </div>
        )}
      </div>

      {/* WhatsApp Feedback Banner */}
      {whatsAppFeedback && (
        <div className="text-xs px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 font-medium">
          {whatsAppFeedback}
        </div>
      )}

      {/* Thumbnails das Fotos e Ação de WhatsApp */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          {labelUrl && (
            <button
              type="button"
              onClick={() => setModalImage(labelUrl)}
              className="group relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-xs text-slate-300 transition"
            >
              <Eye className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-400" />
              <span>Etiqueta</span>
            </button>
          )}

          {pkg.status === 'DELIVERED' && signatureUrl && (
            <button
              type="button"
              onClick={() => setModalImage(signatureUrl)}
              className="group relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-xs text-emerald-300 transition"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Assinatura</span>
            </button>
          )}
        </div>

        {/* Botão de WhatsApp */}
        {pkg.status !== 'DELIVERED' && (
          <button
            type="button"
            onClick={() => handleSendWhatsApp(isEffectivelyNotified)}
            disabled={isSendingWhatsApp}
            title={isEffectivelyNotified ? 'Reenviar notificação de WhatsApp' : 'Verificar e disparar mensagem WhatsApp'}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition disabled:opacity-50 ${
              isEffectivelyNotified
                ? 'bg-slate-800 hover:bg-slate-700 text-emerald-400 border-slate-700'
                : 'bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border-emerald-500/40 animate-pulse'
            }`}
          >
            {isSendingWhatsApp ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : isEffectivelyNotified ? (
              <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Send className="w-3.5 h-3.5 text-emerald-400" />
            )}
            <span>{isEffectivelyNotified ? 'Reenviar WhatsApp' : 'Enviar WhatsApp'}</span>
          </button>
        )}
      </div>

      {/* Ações de Entrega */}
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

'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
  RefreshCw,
  PhoneCall,
  AlertTriangle,
  X,
  ExternalLink,
  User
} from 'lucide-react';

interface PackageCardProps {
  pkg: PackageType;
  onSelectDeliver?: (pkg: PackageType) => void;
  onPackageUpdated?: () => void;
  showActions?: boolean;
  staleDaysThreshold?: number;
}

export function PackageCard({ pkg, onSelectDeliver, onPackageUpdated, showActions = true, staleDaysThreshold = 5 }: PackageCardProps) {
  const [modalImage, setModalImage] = useState<string | null>(null);
  const [isSendingWhatsApp, setIsSendingWhatsApp] = useState(false);
  const [whatsAppFeedback, setWhatsAppFeedback] = useState<string | null>(null);
  // true = confirmado que WhatsApp foi enviado em algum momento via notifications_log
  const [wasNotified, setWasNotified] = useState<boolean | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

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

  // Fecha modal ao pressionar ESC e bloqueia scroll do fundo
  useEffect(() => {
    if (!modalImage) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModalImage(null);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [modalImage]);

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

  const receivedTime = new Date(pkg.received_at || Date.now()).getTime();
  const ageDays = Math.floor(Math.max(0, Date.now() - receivedTime) / (1000 * 60 * 60 * 24));
  const isStale = pkg.status !== 'DELIVERED' && ageDays >= (staleDaysThreshold || 5);

  const resident = pkg.resident || (pkg.unit?.residents?.find((r) => r.is_primary) || pkg.unit?.residents?.[0]);
  const rawPhone = resident?.phone || (pkg as any).phone;
  const residentName = resident?.name || pkg.recipient_name_ocr || 'Morador(a)';
  
  let cleanPhone = (rawPhone || '').replace(/\D/g, '');
  if (cleanPhone && !cleanPhone.startsWith('55') && cleanPhone.length >= 10) {
    cleanPhone = `55${cleanPhone}`;
  }

  const directReminderText =
    `👋 Olá, *${residentName}*! Tudo bem?\n\n` +
    `Aqui é da *Portaria do Condomínio*.\n` +
    `Sua encomenda da *${pkg.carrier}* (${pkg.unit ? `${pkg.unit.block} - Apto ${pkg.unit.unit_number}` : 'sua unidade'}) está disponível para retirada na portaria há *${ageDays} dias* (Código: *${pkg.pickup_code}*).\n\n` +
    `Por favor, venha retirar na portaria quando puder! Obrigado.`;

  const directWhatsAppUrl = cleanPhone ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(directReminderText)}` : null;

  return (
    <div className={`bg-slate-900/90 backdrop-blur-md rounded-2xl p-4 sm:p-5 shadow-xl transition flex flex-col justify-between gap-4 ${
      isStale
        ? 'border-2 border-rose-500/60 bg-gradient-to-b from-rose-950/20 via-slate-900/90 to-slate-900/90 shadow-rose-950/30 ring-1 ring-rose-500/30'
        : 'border border-slate-800 hover:border-slate-700'
    }`}>
      {/* Header do Card */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className={`p-2.5 rounded-xl border ${
            isStale
              ? 'bg-rose-950/40 text-rose-300 border-rose-800/50'
              : 'bg-slate-800 text-slate-300 border-slate-700/50'
          }`}>
            <Package className={`w-5 h-5 ${isStale ? 'text-rose-400' : 'text-emerald-400'}`} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border ${getCarrierColor(pkg.carrier)}`}>
                {pkg.carrier}
              </span>
              {getStatusBadge()}
              {isStale && (
                <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse shadow-sm">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                  <span>Parada há {ageDays} {ageDays === 1 ? 'dia' : 'dias'}</span>
                </span>
              )}
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
            {residentName}
          </span>
        </div>
        <div className="min-w-0 text-right">
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

        <div className="flex items-center gap-2">
          {/* Botão de Contato Direto para Encomendas Paradas */}
          {isStale && directWhatsAppUrl && (
            <a
              href={directWhatsAppUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 transition shadow-sm"
              title={`Chamar ${residentName} no WhatsApp para retirar encomenda parada`}
            >
              <PhoneCall className="w-3.5 h-3.5 text-amber-400" />
              <span>Chamar Morador</span>
            </a>
          )}

          {/* Botão de WhatsApp Oficial */}
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

      {/* Modal de visualização de foto ampliada via Portal (livre de contain/transforms dos cards) */}
      {modalImage && isMounted && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[99999] flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md overflow-y-auto"
          onClick={() => setModalImage(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg my-auto bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh]"
          >
            {/* Cabeçalho do Modal com botão X de fechar */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/95 gap-2 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-1.5 rounded-lg bg-slate-800 text-slate-300 border border-slate-700/60 shrink-0">
                  {modalImage.includes('signature') ? (
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Package className="w-4 h-4 text-amber-400" />
                  )}
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-100 truncate">
                    {modalImage.includes('signature') ? 'Assinatura de Entrega' : 'Foto da Etiqueta'}
                  </h3>
                  <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-slate-400">
                    <span className={`px-1.5 py-0.5 rounded font-semibold border ${getCarrierColor(pkg.carrier)}`}>
                      {pkg.carrier}
                    </span>
                    <span>•</span>
                    <span className="font-medium text-slate-300">
                      {pkg.unit ? `${pkg.unit.block} - Apto ${pkg.unit.unit_number}` : 'Unidade'}
                    </span>
                    <span>•</span>
                    <span className="font-mono font-bold text-emerald-400">
                      {pkg.pickup_code}
                    </span>
                  </div>
                </div>
              </div>

              {/* Botão de Fechar X */}
              <button
                type="button"
                onClick={() => setModalImage(null)}
                className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700/60 transition shrink-0"
                title="Fechar visualização (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Imagem Central (Tamanho responsivo que não corta na tela) */}
            <div className="relative flex-1 min-h-0 w-full p-2 sm:p-4 flex items-center justify-center bg-slate-950/80 overflow-hidden">
              <img
                src={modalImage}
                alt="Visualização da Encomenda"
                className="max-h-[42vh] sm:max-h-[46vh] max-w-full w-auto object-contain rounded-xl shadow-lg border border-slate-800/80 transition select-none"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  if (!target.dataset.triedFallback) {
                    target.dataset.triedFallback = 'true';
                    target.src = LocalApiClient.getLocalFallbackUrl(
                      modalImage.includes('signature') ? pkg.signature_image_path : pkg.label_image_path
                    );
                  } else {
                    target.style.display = 'none';
                    const parent = target.parentElement;
                    if (parent && !parent.querySelector('.img-error')) {
                      const span = document.createElement('span');
                      span.className = 'img-error text-slate-400 font-medium py-12 block text-center';
                      span.innerHTML = '🚫<br/>Imagem não encontrada<br/><span class="text-xs text-slate-500 font-normal mt-2 block">Pode ter sido apagada na limpeza automática.</span>';
                      parent.insertBefore(span, target);
                    }
                  }
                }}
              />
            </div>

            {/* Rodapé com Informações do Morador e Ações (Fechar e Enviar) */}
            <div className="p-3 sm:p-4 bg-slate-900 border-t border-slate-800 flex flex-col gap-2.5 shrink-0">
              {whatsAppFeedback && (
                <div className="text-xs px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 font-medium text-slate-200">
                  {whatsAppFeedback}
                </div>
              )}

              <div className="flex items-center justify-between text-xs text-slate-400 flex-wrap gap-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <User className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span className="text-slate-200 font-semibold truncate">{residentName}</span>
                  {rawPhone && (
                    <span className="text-slate-400 font-mono text-[11px]">({rawPhone})</span>
                  )}
                </div>
                <div>{getStatusBadge()}</div>
              </div>

              <div className="flex items-center justify-end gap-2 flex-wrap sm:flex-nowrap pt-1">
                <button
                  type="button"
                  onClick={() => setModalImage(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-semibold border border-slate-700 transition"
                >
                  Fechar
                </button>

                {directWhatsAppUrl && (
                  <a
                    href={directWhatsAppUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 transition shadow-sm"
                    title={`Abrir conversa no WhatsApp Web com ${residentName}`}
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Conversar</span>
                  </a>
                )}

                <button
                  type="button"
                  onClick={() => handleSendWhatsApp(true)}
                  disabled={isSendingWhatsApp}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white shadow-lg shadow-emerald-950 transition"
                  title="Disparar notificação automática via WhatsApp da portaria"
                >
                  {isSendingWhatsApp ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  <span>{isEffectivelyNotified ? 'Reenviar Notificação' : 'Enviar pro Morador'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

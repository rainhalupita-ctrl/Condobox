'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Package as PackageType } from '../../types/database';
import { PackageCard } from '../../components/package-card';
import { SignaturePad } from '../../components/signature-pad';
import { SubscriptionGate } from '../../components/SubscriptionGate';
import { VoiceService } from '../../lib/voice';
import { LocalApiClient } from '../../lib/local-api';
import { createClient } from '../../lib/supabase/client';
import {
  Camera,
  QrCode,
  Search,
  RefreshCw,
  PackageCheck,
  Clock,
  CheckCircle,
  AlertCircle,
  Filter,
  X,
  MessageSquare,
  Send,
  Loader2
} from 'lucide-react';

export default function PortariaDashboardPage() {
  const [packages, setPackages] = useState<PackageType[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'DELIVERED'>('PENDING');
  const [selectedForDelivery, setSelectedForDelivery] = useState<PackageType | null>(null);
  const [deliveredToName, setDeliveredToName] = useState('');
  const [isSubmittingDelivery, setIsSubmittingDelivery] = useState(false);
  const [isNotifyingPending, setIsNotifyingPending] = useState(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  const loadPackages = async () => {
    setLoading(true);
    const supabase = createClient();
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        window.location.href = '/login?redirect=/portaria';
        return;
      }

      const { data, error } = await supabase
        .from('packages')
        .select('*, unit:units(*), resident:residents(*)')
        .order('received_at', { ascending: false });

      if (!error && data) {
        setPackages(data as PackageType[]);
      } else {
        setPackages([]);
      }
    } catch (err) {
      console.error('Erro ao buscar encomendas:', err);
      setPackages([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPackages();

    const onSetFilter = (e: any) => {
      if (e.detail) setStatusFilter(e.detail);
    };
    const onRefresh = () => loadPackages();
    const onNotify = () => handleNotifyPending();
    const onCloseModals = () => {
      setSelectedForDelivery(null);
      setDeliveredToName('');
    };

    window.addEventListener('condobox:set-filter', onSetFilter);
    window.addEventListener('condobox:refresh-packages', onRefresh);
    window.addEventListener('condobox:notify-pending', onNotify);
    window.addEventListener('condobox:close-modals', onCloseModals);

    return () => {
      window.removeEventListener('condobox:set-filter', onSetFilter);
      window.removeEventListener('condobox:refresh-packages', onRefresh);
      window.removeEventListener('condobox:notify-pending', onNotify);
      window.removeEventListener('condobox:close-modals', onCloseModals);
    };
  }, []);

  const handleStartDelivery = (pkg: PackageType) => {
    setSelectedForDelivery(pkg);
    setDeliveredToName(pkg.resident?.name || pkg.recipient_name_ocr || '');
  };

  const handleConfirmSignature = async (signatureDataUrl: string) => {
    if (!selectedForDelivery) return;

    setIsSubmittingDelivery(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      await LocalApiClient.submitSignature({
        packageId: selectedForDelivery.id,
        signatureBase64: signatureDataUrl,
        deliveredToName: deliveredToName || 'Morador/Autorizado',
        deliveredByUserId: user?.id,
        sendWhatsAppConfirmation: true
      });

      VoiceService.playSuccessBeep();
      VoiceService.speak(`Entrega concluída para ${deliveredToName || 'o morador'}`);

      setSuccessToast(`Encomenda entregue com sucesso para ${deliveredToName || 'o morador'}!`);
      setSelectedForDelivery(null);
      loadPackages();
    } catch (err: any) {
      alert(`Erro ao registrar entrega: ${err.message}`);
    } finally {
      setIsSubmittingDelivery(false);
    }
  };

  const handleNotifyPending = async () => {
    setIsNotifyingPending(true);
    try {
      const res = await LocalApiClient.notifyPendingPackages();
      if (res.success) {
        if (res.sentCount > 0) {
          setSuccessToast(`✅ ${res.sentCount} notificação(ões) de WhatsApp enviada(s) com sucesso!`);
        } else if (res.alreadySentCount > 0) {
          setSuccessToast(`ℹ️ Todas as encomendas pendentes já haviam sido notificadas.`);
        } else if (res.failedCount > 0) {
          setSuccessToast(`⚠️ ${res.failedCount} notificação(ões) falharam. Verifique os telefones dos moradores e a conexão com o WhatsApp.`);
        } else {
          setSuccessToast(`⚠️ Nenhuma mensagem nova enviada. Verifique os telefones cadastrados dos moradores.`);
        }
        loadPackages();
      } else {
        setSuccessToast(`❌ Erro: ${res.error || 'Falha na comunicação com a portaria.'}`);
      }
    } catch (err: any) {
      setSuccessToast(`❌ Erro ao comunicar com a portaria: ${err.message}`);
    } finally {
      setIsNotifyingPending(false);
    }
  };

  const filteredPackages = packages.filter(pkg => {
    if (statusFilter === 'PENDING' && pkg.status === 'DELIVERED') return false;
    if (statusFilter === 'DELIVERED' && pkg.status !== 'DELIVERED') return false;

    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const unitMatch = pkg.unit ? `${pkg.unit.block} ${pkg.unit.unit_number}`.toLowerCase().includes(q) : false;
    const nameMatch = (pkg.resident?.name || pkg.recipient_name_ocr || '').toLowerCase().includes(q);
    const codeMatch = pkg.pickup_code.includes(q);
    const carrierMatch = pkg.carrier.toLowerCase().includes(q);

    return unitMatch || nameMatch || codeMatch || carrierMatch;
  });

  const pendingCount = packages.filter(p => p.status !== 'DELIVERED').length;
  const unnotifiedCount = packages.filter(p => p.status === 'RECEIVED').length;
  const deliveredTodayCount = packages.filter(p => p.status === 'DELIVERED').length;

  return (
    <SubscriptionGate>
      <div className="space-y-6">
        {/* Toast de Sucesso */}
        {successToast && (
          <div className="fixed top-20 right-4 z-50 flex items-center gap-3 bg-emerald-600 text-white px-5 py-3 rounded-2xl shadow-2xl animate-fade-in">
            <CheckCircle className="w-5 h-5" />
            <span className="text-sm font-semibold">{successToast}</span>
            <button onClick={() => setSuccessToast(null)} className="hover:opacity-75">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Título e Botão de Configuração */}
        <div className="flex items-center justify-end">
          <button
            onClick={() => {
              const current = LocalApiClient.getCurrentImageBaseUrl();
              const url = window.prompt("Configuração para Uso no Celular:\n\nDigite o IP do computador da portaria (Ex: http://192.168.0.10:3001)\n\nIsso fará o celular enviar as mensagens direto pelo seu computador em vez da nuvem.", current);
              if (url !== null) {
                LocalApiClient.setCustomBaseUrl(url);
                alert("Configuração salva no seu aparelho!");
              }
            }}
            className="text-[10px] text-slate-500 hover:text-slate-300 underline"
          >
            Configurar IP Local (Apenas para Celular)
          </button>
        </div>

        {/* Ações Rápidas da Portaria (Touch/Tablet) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link
            href="/portaria/nova"
            className="flex items-center justify-between p-5 sm:p-6 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 rounded-3xl shadow-xl shadow-emerald-950/40 text-white group transition active:scale-[0.99]"
          >
            <div className="flex items-center gap-4">
              <div className="p-3.5 bg-white/10 backdrop-blur-md rounded-2xl border border-white/20 group-hover:scale-110 transition">
                <Camera className="w-7 h-7" />
              </div>
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-100">Entrada Rápida</span>
                <h2 className="text-xl sm:text-2xl font-black">Nova Encomenda</h2>
                <p className="text-xs text-emerald-100/90 mt-0.5">Tirar Foto da Etiqueta + OCR</p>
              </div>
            </div>
            <div className="hidden sm:block text-2xl font-black opacity-60">＋</div>
          </Link>

          <Link
            href="/portaria/retirada"
            className="flex items-center justify-between p-5 sm:p-6 bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 rounded-3xl shadow-xl shadow-sky-950/40 text-white group transition active:scale-[0.99]"
          >
            <div className="flex items-center gap-4">
              <div className="p-3.5 bg-white/10 backdrop-blur-md rounded-2xl border border-white/20 group-hover:scale-110 transition">
                <QrCode className="w-7 h-7" />
              </div>
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-sky-100">Saída / Baixa</span>
                <h2 className="text-xl sm:text-2xl font-black">Retirar Encomenda</h2>
                <p className="text-xs text-sky-100/90 mt-0.5">Ler QR Code ou Digitar Código</p>
              </div>
            </div>
            <div className="hidden sm:block text-2xl font-black opacity-60">✓</div>
          </Link>
        </div>

        {/* Barra de Filtros, Busca e Disparo de WhatsApp */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3 sm:p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 shadow-lg">
          <div className="relative w-full md:w-80 lg:w-96">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar por Apto, Morador, Código..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-sm focus:outline-none focus:border-emerald-500 transition"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-between sm:justify-end">
            <button
              type="button"
              onClick={handleNotifyPending}
              disabled={isNotifyingPending}
              title="Verifica encomendas pendentes e dispara no WhatsApp para quem ainda não recebeu"
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-bold transition disabled:opacity-50 shadow-sm whitespace-nowrap"
            >
              {isNotifyingPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />}
              <span>{isNotifyingPending ? 'Disparando...' : 'Disparar WhatsApp'}</span>
              {unnotifiedCount > 0 && (
                <span className="px-1.5 py-0.5 bg-amber-500 text-slate-950 font-black rounded-full text-[10px]">
                  {unnotifiedCount}
                </span>
              )}
            </button>

            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs shrink-0">
              <button
                onClick={() => setStatusFilter('PENDING')}
                className={`px-2.5 py-1.5 rounded-lg font-semibold transition ${
                  statusFilter === 'PENDING'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Pendentes ({pendingCount})
              </button>
              <button
                onClick={() => setStatusFilter('DELIVERED')}
                className={`px-2.5 py-1.5 rounded-lg font-semibold transition ${
                  statusFilter === 'DELIVERED'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Entregues ({deliveredTodayCount})
              </button>
              <button
                onClick={() => setStatusFilter('ALL')}
                className={`px-2.5 py-1.5 rounded-lg font-semibold transition ${
                  statusFilter === 'ALL'
                    ? 'bg-slate-800 text-slate-200'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Todas ({packages.length})
              </button>
            </div>

            <button
              onClick={loadPackages}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition shrink-0"
              title="Atualizar lista"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Grade de Encomendas */}
        {loading ? (
          <div className="py-16 text-center text-slate-400 flex flex-col items-center gap-3">
            <RefreshCw className="w-8 h-8 animate-spin text-emerald-400" />
            <p className="text-sm">Carregando encomendas da portaria...</p>
          </div>
        ) : filteredPackages.length === 0 ? (
          <div className="py-16 text-center text-slate-400 bg-slate-900/40 border border-dashed border-slate-800 rounded-3xl p-8 flex flex-col items-center gap-3">
            <PackageCheck className="w-12 h-12 text-slate-600" />
            <h3 className="text-base font-bold text-slate-300">Nenhuma encomenda encontrada</h3>
            <p className="text-xs text-slate-500 max-w-sm">
              Não há pacotes com os filtros selecionados. Clique em "Nova Encomenda" para registrar uma nova entrega.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredPackages.map((pkg) => (
              <PackageCard
                key={pkg.id}
                pkg={pkg}
                onSelectDeliver={handleStartDelivery}
                onPackageUpdated={loadPackages}
              />
            ))}
          </div>
        )}

        {/* Modal de Assinatura Rápida */}
        {selectedForDelivery && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
            <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">Entrega de Encomenda</span>
                  <h3 className="text-lg font-bold text-slate-100">
                    {selectedForDelivery.unit
                      ? `${selectedForDelivery.unit.block} - Apto ${selectedForDelivery.unit.unit_number}`
                      : 'Unidade'}
                  </h3>
                </div>
                <button
                  onClick={() => setSelectedForDelivery(null)}
                  className="text-slate-400 hover:text-slate-200"
                >
                  ✕
                </button>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Nome de quem está retirando:
                </label>
                <input
                  type="text"
                  value={deliveredToName}
                  onChange={(e) => setDeliveredToName(e.target.value)}
                  placeholder="Nome do morador ou autorizado"
                  className="w-full px-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>

              <SignaturePad
                recipientName={deliveredToName}
                onSave={handleConfirmSignature}
                onCancel={() => setSelectedForDelivery(null)}
              />
            </div>
          </div>
        )}
      </div>
    </SubscriptionGate>
  );
}

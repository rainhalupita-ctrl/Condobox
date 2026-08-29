'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Package as PackageType } from '../../types/database';
import { PackageCard } from '../../components/package-card';
import { SignaturePad } from '../../components/signature-pad';
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
  X
} from 'lucide-react';

export default function PortariaDashboardPage() {
  const [packages, setPackages] = useState<PackageType[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'DELIVERED'>('PENDING');
  const [selectedForDelivery, setSelectedForDelivery] = useState<PackageType | null>(null);
  const [deliveredToName, setDeliveredToName] = useState('');
  const [isSubmittingDelivery, setIsSubmittingDelivery] = useState(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  useEffect(() => {
    loadPackages();
    setupRealtimeSubscription();
  }, []);

  const loadPackages = async () => {
    setLoading(true);
    const supabase = createClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('packages')
        .select('*, unit:units(*), resident:residents(*)')
        .order('received_at', { ascending: false });

      if (!error && data) {
        setPackages(data as PackageType[]);
        setLoading(false);
        return;
      }
    }

    // Fallback: busca da API local ou dados de demonstração
    try {
      const res = await fetch(`${LocalApiClient.getCurrentImageBaseUrl()}/api/packages/search`);
      if (res.ok) {
        const json = await res.json();
        if (json.packages && json.packages.length > 0) {
          setPackages(json.packages);
          setLoading(false);
          return;
        }
      }
    } catch {}

    // Mock inicial caso o banco ainda esteja sendo configurado
    setPackages([
      {
        id: 'pkg-1',
        unit_id: 'u-1',
        carrier: 'Mercado Livre',
        tracking_code: 'ML998822BR',
        recipient_name_ocr: 'Carlos Silva',
        status: 'RECEIVED',
        pickup_code: '4821',
        qr_token: 'pkg_token_1',
        label_image_path: null,
        received_at: new Date(Date.now() - 3600000).toISOString(),
        unit: { id: 'u-1', block: 'Bloco A', unit_number: '101' },
        resident: {
          id: 'r-1',
          unit_id: 'u-1',
          name: 'Carlos Silva',
          phone: '5511999990001',
          is_authorized_receiver: true,
          is_primary: true,
          active: true
        }
      },
      {
        id: 'pkg-2',
        unit_id: 'u-2',
        carrier: 'Amazon',
        tracking_code: 'AMZ883311',
        recipient_name_ocr: 'Fernanda Souza',
        status: 'RECEIVED',
        pickup_code: '9304',
        qr_token: 'pkg_token_2',
        label_image_path: null,
        received_at: new Date(Date.now() - 7200000).toISOString(),
        unit: { id: 'u-2', block: 'Bloco B', unit_number: '101' },
        resident: {
          id: 'r-2',
          unit_id: 'u-2',
          name: 'Fernanda Souza',
          phone: '5511999990004',
          is_authorized_receiver: true,
          is_primary: true,
          active: true
        }
      }
    ]);
    setLoading(false);
  };

  const setupRealtimeSubscription = () => {
    const supabase = createClient();
    if (!supabase) return;

    const channel = supabase
      .channel('packages-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'packages' },
        () => {
          loadPackages();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const handleStartDelivery = (pkg: PackageType) => {
    setSelectedForDelivery(pkg);
    setDeliveredToName(pkg.resident?.name || pkg.recipient_name_ocr || '');
  };

  const handleConfirmSignature = async (signatureBase64: string) => {
    if (!selectedForDelivery) return;
    setIsSubmittingDelivery(true);

    try {
      await LocalApiClient.submitSignature({
        packageId: selectedForDelivery.id,
        signatureBase64,
        deliveredToName: deliveredToName || 'Morador',
        sendWhatsAppConfirmation: true
      });

      setSuccessToast(`Encomenda entregue com sucesso para ${deliveredToName || 'o morador'}!`);
      setSelectedForDelivery(null);
      loadPackages();
    } catch (err: any) {
      alert(`Erro ao registrar entrega: ${err.message}`);
    } finally {
      setIsSubmittingDelivery(false);
    }
  };

  const filteredPackages = packages.filter(pkg => {
    // Filtro de status
    if (statusFilter === 'PENDING' && pkg.status === 'DELIVERED') return false;
    if (statusFilter === 'DELIVERED' && pkg.status !== 'DELIVERED') return false;

    // Busca textual
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const unitMatch = pkg.unit ? `${pkg.unit.block} ${pkg.unit.unit_number}`.toLowerCase().includes(q) : false;
    const nameMatch = (pkg.resident?.name || pkg.recipient_name_ocr || '').toLowerCase().includes(q);
    const codeMatch = pkg.pickup_code.includes(q);
    const carrierMatch = pkg.carrier.toLowerCase().includes(q);

    return unitMatch || nameMatch || codeMatch || carrierMatch;
  });

  const pendingCount = packages.filter(p => p.status !== 'DELIVERED').length;
  const deliveredTodayCount = packages.filter(p => p.status === 'DELIVERED').length;

  return (
    <div className="space-y-6">
      {/* Toast de Sucesso */}
      {successToast && (
        <div className="fixed top-20 right-4 z-50 flex items-center gap-3 bg-emerald-600 text-white px-5 py-3 rounded-2xl shadow-2xl animate-fade-in">
          <CheckCircle className="w-5 h-5" />
          <span className="text-sm font-semibold">{successToast}</span>
          <button onClick={() => setSuccessToast(null)} className="ml-2 hover:opacity-80">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

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

      {/* Barra de Filtros e Busca */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* Input de Busca */}
        <div className="relative w-full sm:w-96">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por Apto, Morador, Código..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-sm focus:outline-none focus:border-emerald-500"
          />
        </div>

        {/* Filtro por Status */}
        <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setStatusFilter('PENDING')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                statusFilter === 'PENDING'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Pendentes ({pendingCount})
            </button>
            <button
              onClick={() => setStatusFilter('DELIVERED')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                statusFilter === 'DELIVERED'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Entregues ({deliveredTodayCount})
            </button>
            <button
              onClick={() => setStatusFilter('ALL')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition ${
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
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
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
            />
          ))}
        </div>
      )}

      {/* Modal de Assinatura Rápida Direto no Dashboard */}
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
  );
}

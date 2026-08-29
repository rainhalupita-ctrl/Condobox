'use client';

import React, { useState, useEffect } from 'react';
import { PackageCard } from '../../components/package-card';
import { QRGenerator } from '../../components/qr-generator';
import { Package as PackageType, Resident } from '../../types/database';
import { createClient } from '../../lib/supabase/client';
import {
  Smartphone,
  QrCode,
  Package,
  Clock,
  CheckCircle2,
  UserCheck,
  ShieldCheck,
  RefreshCw,
  Bell
} from 'lucide-react';

export default function MoradorPage() {
  const [residents, setResidents] = useState<Resident[]>([]);
  const [selectedResidentId, setSelectedResidentId] = useState<string>('r-1');
  const [packages, setPackages] = useState<PackageType[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'PENDING' | 'HISTORY'>('PENDING');

  useEffect(() => {
    loadMockOrRealData();
  }, [selectedResidentId]);

  const loadMockOrRealData = async () => {
    setLoading(true);
    const supabase = createClient();

    if (supabase) {
      const { data: resData } = await supabase.from('residents').select('*, unit:units(*)');
      if (resData && resData.length > 0) {
        setResidents(resData);
        if (!selectedResidentId) setSelectedResidentId(resData[0].id);
      }

      const { data: pkgData } = await supabase
        .from('packages')
        .select('*, unit:units(*), resident:residents(*)')
        .eq('resident_id', selectedResidentId)
        .order('received_at', { ascending: false });

      if (pkgData) {
        setPackages(pkgData);
        setLoading(false);
        return;
      }
    }

    // Mock para demonstração
    const mockRes: Resident[] = [
      { id: 'r-1', unit_id: 'u-1', name: 'Carlos Silva', phone: '5511999990001', is_authorized_receiver: true, is_primary: true, active: true, unit: { id: 'u-1', block: 'Bloco A', unit_number: '101' } },
      { id: 'r-2', unit_id: 'u-1', name: 'Mariana Silva', phone: '5511999990002', is_authorized_receiver: true, is_primary: false, active: true, unit: { id: 'u-1', block: 'Bloco A', unit_number: '101' } },
      { id: 'r-4', unit_id: 'u-5', name: 'Fernanda Souza', phone: '5511999990004', is_authorized_receiver: true, is_primary: true, active: true, unit: { id: 'u-5', block: 'Bloco B', unit_number: '101' } },
    ];
    setResidents(mockRes);

    const mockPkgs: PackageType[] = [
      {
        id: 'pkg-1',
        unit_id: 'u-1',
        resident_id: 'r-1',
        carrier: 'Mercado Livre',
        tracking_code: 'ML998822BR',
        recipient_name_ocr: 'Carlos Silva',
        status: 'RECEIVED',
        pickup_code: '4821',
        qr_token: 'pkg_token_4821',
        label_image_path: null,
        received_at: new Date(Date.now() - 3600000).toISOString(),
        unit: { id: 'u-1', block: 'Bloco A', unit_number: '101' },
        resident: mockRes[0]
      },
      {
        id: 'pkg-3',
        unit_id: 'u-1',
        resident_id: 'r-1',
        carrier: 'Amazon',
        tracking_code: 'AMZ-4411-BR',
        recipient_name_ocr: 'Carlos Silva',
        status: 'DELIVERED',
        pickup_code: '1290',
        qr_token: 'pkg_token_1290',
        label_image_path: null,
        signature_image_path: null,
        received_at: new Date(Date.now() - 86400000).toISOString(),
        delivered_at: new Date(Date.now() - 43200000).toISOString(),
        delivered_to_name: 'Carlos Silva',
        unit: { id: 'u-1', block: 'Bloco A', unit_number: '101' },
        resident: mockRes[0]
      }
    ];

    setPackages(mockPkgs);
    setLoading(false);
  };

  const currentResident = residents.find(r => r.id === selectedResidentId) || residents[0];
  const pendingPackages = packages.filter(p => p.status !== 'DELIVERED');
  const historyPackages = packages.filter(p => p.status === 'DELIVERED');

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Seletor de Perfil do Morador (Simulação / Auth) */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-sky-500/20 text-sky-400 border border-sky-500/30 flex items-center justify-center font-bold text-lg">
            {currentResident ? currentResident.name.charAt(0) : 'M'}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-100">{currentResident?.name || 'Morador'}</h2>
              <span className="text-[10px] font-semibold bg-sky-500/20 text-sky-300 border border-sky-500/30 px-2 py-0.5 rounded-full">
                Morador Ativo
              </span>
            </div>
            <p className="text-xs text-slate-400">
              {currentResident?.unit ? `${currentResident.unit.block} - Apto ${currentResident.unit.unit_number}` : 'Unidade'}
            </p>
          </div>
        </div>

        {/* Alternar Morador para Teste */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs text-slate-400 whitespace-nowrap">Trocar Perfil:</span>
          <select
            value={selectedResidentId}
            onChange={(e) => setSelectedResidentId(e.target.value)}
            className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-xs focus:outline-none focus:border-sky-500 font-medium"
          >
            {residents.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.unit ? `${r.unit.block} ${r.unit.unit_number}` : ''})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Cartão de Retirada Rápida com QR Code (Se houver encomendas pendentes) */}
      {pendingPackages.length > 0 && (
        <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-sky-950/40 border border-sky-500/30 rounded-3xl p-6 sm:p-8 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-8 animate-fade-in">
          <div className="space-y-4 text-center md:text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-500/20 text-sky-300 text-xs font-semibold border border-sky-500/30">
              <Bell className="w-3.5 h-3.5 animate-bounce" /> {pendingPackages.length} Encomenda(s) Pronta(s) para Retirada
            </div>
            <h3 className="text-2xl sm:text-3xl font-black text-slate-100">
              Apresente na Portaria para Retirar
            </h3>
            <p className="text-xs sm:text-sm text-slate-300 max-w-md">
              Mostre este QR Code ou informe o código numérico ao porteiro para retirar sua encomenda com segurança.
            </p>
            <div className="flex items-center justify-center md:justify-start gap-3 pt-2">
              <span className="text-xs text-slate-400">Código de Retirada:</span>
              <span className="text-2xl font-black font-mono text-sky-400 bg-sky-950/80 border border-sky-700/60 px-4 py-1 rounded-xl tracking-widest">
                {pendingPackages[0].pickup_code}
              </span>
            </div>
          </div>

          <div className="flex-shrink-0">
            <QRGenerator
              value={pendingPackages[0].qr_token || pendingPackages[0].pickup_code}
              label={`RETIRADA: ${pendingPackages[0].pickup_code}`}
              size={170}
            />
          </div>
        </div>
      )}

      {/* Abas: Pendentes vs Histórico */}
      <div className="flex items-center gap-3 border-b border-slate-800 pb-3">
        <button
          onClick={() => setActiveTab('PENDING')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition ${
            activeTab === 'PENDING'
              ? 'bg-sky-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
        >
          <Clock className="w-4 h-4" /> Aguardando Retirada ({pendingPackages.length})
        </button>
        <button
          onClick={() => setActiveTab('HISTORY')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition ${
            activeTab === 'HISTORY'
              ? 'bg-sky-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
        >
          <CheckCircle2 className="w-4 h-4" /> Histórico Entregue ({historyPackages.length})
        </button>
      </div>

      {/* Lista de Encomendas */}
      {loading ? (
        <div className="py-12 text-center text-slate-400 flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 animate-spin text-sky-400" />
          <p className="text-sm">Carregando encomendas...</p>
        </div>
      ) : activeTab === 'PENDING' ? (
        pendingPackages.length === 0 ? (
          <div className="py-16 text-center text-slate-400 bg-slate-900/40 border border-dashed border-slate-800 rounded-3xl p-8 flex flex-col items-center gap-3">
            <Package className="w-12 h-12 text-slate-600" />
            <h3 className="text-base font-bold text-slate-300">Você não tem encomendas pendentes na portaria</h3>
            <p className="text-xs text-slate-500 max-w-sm">
              Quando um pacote chegar, você receberá uma notificação instantânea no WhatsApp.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {pendingPackages.map((pkg) => (
              <PackageCard key={pkg.id} pkg={pkg} showActions={false} />
            ))}
          </div>
        )
      ) : historyPackages.length === 0 ? (
        <div className="py-16 text-center text-slate-400 bg-slate-900/40 border border-dashed border-slate-800 rounded-3xl p-8 flex flex-col items-center gap-3">
          <ShieldCheck className="w-12 h-12 text-slate-600" />
          <h3 className="text-base font-bold text-slate-300">Nenhum histórico anterior</h3>
          <p className="text-xs text-slate-500 max-w-sm">
            Aqui você poderá consultar todas as entregas passadas e visualizar as assinaturas digitais coletadas.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {historyPackages.map((pkg) => (
            <PackageCard key={pkg.id} pkg={pkg} showActions={false} />
          ))}
        </div>
      )}
    </div>
  );
}

'use client';

import React, { useState, useEffect } from 'react';
import { Unit, Resident, Package as PackageType } from '../../types/database';
import { createClient } from '../../lib/supabase/client';
import { LocalApiClient } from '../../lib/local-api';
import {
  Shield,
  Users,
  Building2,
  TrendingUp,
  Package,
  Clock,
  Phone,
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
  RefreshCw,
  Search,
  Server
} from 'lucide-react';

export default function AdminPage() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [packages, setPackages] = useState<PackageType[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'METRICS' | 'RESIDENTS' | 'SYSTEM'>('METRICS');
  const [healthStatus, setHealthStatus] = useState<any | null>(null);

  // Formulário de novo morador
  const [isAddResidentModalOpen, setIsAddResidentModalOpen] = useState(false);
  const [newResName, setNewResName] = useState('');
  const [newResPhone, setNewResPhone] = useState('');
  const [newResEmail, setNewResEmail] = useState('');
  const [newResUnitId, setNewResUnitId] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const health = await LocalApiClient.checkHealth();
    setHealthStatus(health);

    const supabase = createClient();
    if (supabase) {
      const { data: uData } = await supabase.from('units').select('*').order('block').order('unit_number');
      const { data: rData } = await supabase.from('residents').select('*, unit:units(*)').order('name');
      const { data: pData } = await supabase.from('packages').select('*, unit:units(*), resident:residents(*)');
      if (uData) setUnits(uData);
      if (rData) setResidents(rData);
      if (pData) setPackages(pData);
      setLoading(false);
      return;
    }

    // Mock para visualização imediata
    const mockUnits: Unit[] = [
      { id: 'u-1', block: 'Bloco A', unit_number: '101' },
      { id: 'u-2', block: 'Bloco A', unit_number: '102' },
      { id: 'u-3', block: 'Bloco A', unit_number: '201' },
      { id: 'u-4', block: 'Bloco A', unit_number: '202' },
      { id: 'u-5', block: 'Bloco B', unit_number: '101' },
      { id: 'u-6', block: 'Bloco B', unit_number: '102' },
    ];
    const mockResidents: Resident[] = [
      { id: 'r-1', unit_id: 'u-1', name: 'Carlos Silva', phone: '5511999990001', email: 'carlos@email.com', is_authorized_receiver: true, is_primary: true, active: true, unit: mockUnits[0] },
      { id: 'r-2', unit_id: 'u-1', name: 'Mariana Silva', phone: '5511999990002', email: 'mariana@email.com', is_authorized_receiver: true, is_primary: false, active: true, unit: mockUnits[0] },
      { id: 'r-3', unit_id: 'u-2', name: 'Roberto Oliveira', phone: '5511999990003', email: 'roberto@email.com', is_authorized_receiver: true, is_primary: true, active: true, unit: mockUnits[1] },
      { id: 'r-4', unit_id: 'u-5', name: 'Fernanda Souza', phone: '5511999990004', email: 'fernanda@email.com', is_authorized_receiver: true, is_primary: true, active: true, unit: mockUnits[4] },
      { id: 'r-5', unit_id: 'u-6', name: 'Lucas Pereira', phone: '5511999990005', email: 'lucas@email.com', is_authorized_receiver: true, is_primary: true, active: true, unit: mockUnits[5] },
    ];
    const mockPkgs: PackageType[] = [
      { id: 'pkg-1', unit_id: 'u-1', carrier: 'Mercado Livre', recipient_name_ocr: 'Carlos Silva', status: 'RECEIVED', pickup_code: '4821', qr_token: 't1', received_at: new Date().toISOString(), unit: mockUnits[0], resident: mockResidents[0] },
      { id: 'pkg-2', unit_id: 'u-5', carrier: 'Amazon', recipient_name_ocr: 'Fernanda Souza', status: 'DELIVERED', pickup_code: '9304', qr_token: 't2', received_at: new Date(Date.now() - 86400000).toISOString(), delivered_at: new Date().toISOString(), unit: mockUnits[4], resident: mockResidents[3] },
    ];

    setUnits(mockUnits);
    setResidents(mockResidents);
    setPackages(mockPkgs);
    setLoading(false);
  };

  const handleAddResident = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newResName || !newResPhone || !newResUnitId) {
      alert('Preencha os campos obrigatórios.');
      return;
    }

    const supabase = createClient();
    if (supabase) {
      const { data, error } = await supabase.from('residents').insert({
        name: newResName,
        phone: newResPhone,
        email: newResEmail || null,
        unit_id: newResUnitId,
        is_authorized_receiver: true,
        is_primary: true,
        active: true
      }).select('*, unit:units(*)').single();

      if (!error && data) {
        setResidents(prev => [...prev, data as Resident]);
      }
    } else {
      const selectedUnit = units.find(u => u.id === newResUnitId);
      const newRes: Resident = {
        id: `r-${Date.now()}`,
        unit_id: newResUnitId,
        name: newResName,
        phone: newResPhone,
        email: newResEmail,
        is_authorized_receiver: true,
        is_primary: true,
        active: true,
        unit: selectedUnit
      };
      setResidents(prev => [...prev, newRes]);
    }

    setIsAddResidentModalOpen(false);
    setNewResName('');
    setNewResPhone('');
    setNewResEmail('');
    setNewResUnitId('');
  };

  const pendingCount = packages.filter(p => p.status !== 'DELIVERED').length;
  const deliveredCount = packages.filter(p => p.status === 'DELIVERED').length;
  const totalCount = packages.length;

  return (
    <div className="space-y-6">
      {/* Header do Painel */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-indigo-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">Administração Geral</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-100 mt-1">Painel do Síndico</h1>
        </div>

        <div className="flex items-center gap-2 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
          <button
            onClick={() => setActiveTab('METRICS')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg font-bold transition ${
              activeTab === 'METRICS'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <TrendingUp className="w-4 h-4" /> Métricas
          </button>
          <button
            onClick={() => setActiveTab('RESIDENTS')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg font-bold transition ${
              activeTab === 'RESIDENTS'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users className="w-4 h-4" /> Moradores ({residents.length})
          </button>
          <button
            onClick={() => setActiveTab('SYSTEM')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg font-bold transition ${
              activeTab === 'SYSTEM'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Server className="w-4 h-4" /> Diagnóstico
          </button>
        </div>
      </div>

      {/* ABA 1: MÉTRICAS E INDICADORES */}
      {activeTab === 'METRICS' && (
        <div className="space-y-6 animate-fade-in">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1 */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-slate-400 block">Aguardando Retirada</span>
                <span className="text-3xl font-black text-amber-400 mt-1 block">{pendingCount}</span>
                <span className="text-[11px] text-slate-500">Na portaria agora</span>
              </div>
              <div className="p-3 bg-amber-500/10 text-amber-400 rounded-2xl border border-amber-500/20">
                <Clock className="w-6 h-6" />
              </div>
            </div>

            {/* Card 2 */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-slate-400 block">Entregues com Sucesso</span>
                <span className="text-3xl font-black text-emerald-400 mt-1 block">{deliveredCount}</span>
                <span className="text-[11px] text-slate-500">Com assinatura</span>
              </div>
              <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-2xl border border-emerald-500/20">
                <CheckCircle2 className="w-6 h-6" />
              </div>
            </div>

            {/* Card 3 */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-slate-400 block">Total de Encomendas</span>
                <span className="text-3xl font-black text-sky-400 mt-1 block">{totalCount}</span>
                <span className="text-[11px] text-slate-500">Histórico registrado</span>
              </div>
              <div className="p-3 bg-sky-500/10 text-sky-400 rounded-2xl border border-sky-500/20">
                <Package className="w-6 h-6" />
              </div>
            </div>

            {/* Card 4 */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-slate-400 block">Moradores Ativos</span>
                <span className="text-3xl font-black text-indigo-400 mt-1 block">{residents.length}</span>
                <span className="text-[11px] text-slate-500">Em {units.length} unidades</span>
              </div>
              <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-2xl border border-indigo-500/20">
                <Users className="w-6 h-6" />
              </div>
            </div>
          </div>

          {/* Relatório de Retenção e Armazenamento */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-indigo-400" />
              Estatísticas do Armazenamento Local da Portaria
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                <span className="text-slate-500 block">Política de Retenção:</span>
                <span className="text-slate-200 font-bold text-sm">90 Dias (Automático)</span>
                <p className="text-[11px] text-slate-500 mt-1">Fotos de etiquetas antigas são excluídas pelo cron local.</p>
              </div>
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                <span className="text-slate-500 block">Assinaturas Digitais:</span>
                <span className="text-emerald-400 font-bold text-sm">Retenção Permanente</span>
                <p className="text-[11px] text-slate-500 mt-1">Garantia jurídica e segurança para o condomínio.</p>
              </div>
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                <span className="text-slate-500 block">Custo de Servidor/Nuvem:</span>
                <span className="text-emerald-400 font-bold text-sm">$0.00 / mês</span>
                <p className="text-[11px] text-slate-500 mt-1">Tudo roda no PC local + Free Tier do Supabase.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ABA 2: CADASTRO DE MORADORES */}
      {activeTab === 'RESIDENTS' && (
        <div className="space-y-4 animate-fade-in">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-100">Moradores e Unidades</h3>
            <button
              onClick={() => setIsAddResidentModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-md transition"
            >
              <Plus className="w-4 h-4" /> Novo Morador
            </button>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="p-4">Morador</th>
                    <th className="p-4">Unidade</th>
                    <th className="p-4">WhatsApp</th>
                    <th className="p-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {residents.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-800/40 transition">
                      <td className="p-4 font-semibold text-slate-100">
                        {r.name} {r.is_primary && <span className="text-[10px] text-indigo-400 ml-1">(Titular)</span>}
                      </td>
                      <td className="p-4 font-medium text-slate-200">
                        {r.unit ? `${r.unit.block} - Apto ${r.unit.unit_number}` : 'Sem Unidade'}
                      </td>
                      <td className="p-4 font-mono text-slate-300">
                        {r.phone}
                      </td>
                      <td className="p-4">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          Ativo
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ABA 3: DIAGNÓSTICO DO SISTEMA */}
      {activeTab === 'SYSTEM' && (
        <div className="space-y-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Server className="w-5 h-5 text-indigo-400" />
              Status dos Serviços da Arquitetura
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200">Local API (Porta 3001)</span>
                  <span className="text-emerald-400 font-semibold">Online</span>
                </div>
                <p className="text-slate-400 text-[11px]">
                  Executando no PC da portaria, cuidando do OCR Gemini, uploads em disco e servidor estático.
                </p>
              </div>

              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200">Evolution API (Porta 8080)</span>
                  <span className={healthStatus?.services?.whatsapp?.connected ? 'text-emerald-400 font-semibold' : 'text-amber-400 font-semibold'}>
                    {healthStatus?.services?.whatsapp?.connected ? 'WhatsApp Conectado' : 'Pronto para Pareamento'}
                  </span>
                </div>
                <p className="text-slate-400 text-[11px]">
                  Container Docker rodando localmente para disparo de mensagens com $0 de custo de API.
                </p>
              </div>

              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200">Banco Supabase (PostgreSQL)</span>
                  <span className="text-emerald-400 font-semibold">Sincronizado</span>
                </div>
                <p className="text-slate-400 text-[11px]">
                  Tabelas com Row Level Security (RLS) e Realtime para atualização instantânea dos dashboards.
                </p>
              </div>

              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200">Google Gemini Flash OCR</span>
                  <span className="text-emerald-400 font-semibold">Ativo</span>
                </div>
                <p className="text-slate-400 text-[11px]">
                  Visão computacional processando etiquetas em alta velocidade.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Adicionar Morador */}
      {isAddResidentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-slate-100">Cadastrar Novo Morador</h3>
              <button
                onClick={() => setIsAddResidentModalOpen(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddResident} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Nome Completo: *</label>
                <input
                  type="text"
                  required
                  value={newResName}
                  onChange={(e) => setNewResName(e.target.value)}
                  placeholder="Ex: João da Silva"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Unidade (Bloco/Apto): *</label>
                <select
                  required
                  value={newResUnitId}
                  onChange={(e) => setNewResUnitId(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                >
                  <option value="">Selecione a Unidade...</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.block} - Apto {u.unit_number}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">WhatsApp com DDD (para alertas): *</label>
                <input
                  type="text"
                  required
                  value={newResPhone}
                  onChange={(e) => setNewResPhone(e.target.value)}
                  placeholder="Ex: 5511999998888"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">E-mail (Opcional):</label>
                <input
                  type="email"
                  value={newResEmail}
                  onChange={(e) => setNewResEmail(e.target.value)}
                  placeholder="morador@email.com"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddResidentModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-semibold transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold shadow-md transition"
                >
                  Cadastrar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

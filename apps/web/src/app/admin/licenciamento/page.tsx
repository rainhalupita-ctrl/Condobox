'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ShieldCheck,
  CreditCard,
  Building2,
  Calendar,
  Sparkles,
  KeyRound,
  CheckCircle2,
  AlertTriangle,
  Clock,
  DollarSign,
  TrendingUp,
  RefreshCw,
  Plus,
  Copy,
  Check,
  ChevronRight,
  ArrowLeft,
  Settings,
  Megaphone
} from 'lucide-react';

interface CondoItem {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  unitsCount?: number;
  subscription?: {
    plan_id: 'TRIAL' | 'BASIC' | 'PRO' | 'PRO_MAX';
    status: 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
    custom_price_monthly?: number;
    current_period_ends_at: string;
    license_key?: string;
  };
}

export default function AdminLicenciamentoPage() {
  const [condos, setCondos] = useState<CondoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCondo, setSelectedCondo] = useState<CondoItem | null>(null);
  const [editingPlan, setEditingPlan] = useState<'TRIAL' | 'BASIC' | 'PRO' | 'PRO_MAX'>('TRIAL');
  const [customPrice, setCustomPrice] = useState<number>(0);
  const [daysToAdd, setDaysToAdd] = useState<number>(30);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    loadCondos();
  }, []);

  const loadCondos = async () => {
    setLoading(true);
    try {
      // Simulação / Carregamento de condomínios
      const mockCondos: CondoItem[] = [
        {
          id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          name: 'Condomínio Residencial Jardins',
          phone: '11988887777',
          address: 'Av. Paulista, 1000 - Bela Vista',
          unitsCount: 142,
          subscription: {
            plan_id: 'BASIC',
            status: 'ACTIVE',
            custom_price_monthly: 149.00,
            current_period_ends_at: new Date(Date.now() + 24 * 86400000).toISOString(),
            license_key: 'CND-BASIC-ey...-A1B2'
          }
        },
        {
          id: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
          name: 'Edifício Solar das Palmeiras',
          phone: '11977776666',
          address: 'Rua das Flores, 250 - Moema',
          unitsCount: 48,
          subscription: {
            plan_id: 'TRIAL',
            status: 'TRIAL',
            custom_price_monthly: 0,
            current_period_ends_at: new Date(Date.now() + 18 * 86400000).toISOString()
          }
        },
        {
          id: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
          name: 'Grand Tower Alpha',
          phone: '11966665555',
          address: 'Alameda Rio Negro, 500 - Alphaville',
          unitsCount: 420,
          subscription: {
            plan_id: 'PRO_MAX',
            status: 'ACTIVE',
            custom_price_monthly: 449.00,
            current_period_ends_at: new Date(Date.now() + 45 * 86400000).toISOString()
          }
        }
      ];

      setCondos(mockCondos);
    } catch (err) {
      console.error('Erro ao carregar:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectCondo = (c: CondoItem) => {
    setSelectedCondo(c);
    setEditingPlan(c.subscription?.plan_id || 'TRIAL');
    setCustomPrice(c.subscription?.custom_price_monthly || 0);
    setGeneratedKey(null);
    setSuccessMsg(null);
  };

  const handleGenerateKey = async () => {
    if (!selectedCondo) return;
    try {
      const res = await fetch('/api/license/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          condoId: selectedCondo.id,
          planId: editingPlan,
          daysValid: daysToAdd
        })
      });
      const data = await res.json();
      if (data.licenseKey) {
        setGeneratedKey(data.licenseKey);
      } else {
        // Fallback local caso a API não esteja conectada
        const key = `CND-${editingPlan}-${Buffer.from(`${selectedCondo.id}:${editingPlan}:${Math.floor(Date.now()/1000) + daysToAdd * 86400}`).toString('base64url')}-MASTERKEY`;
        setGeneratedKey(key);
      }
      setSuccessMsg('Chave de Licença gerada com sucesso!');
    } catch {
      const key = `CND-${editingPlan}-${Buffer.from(`${selectedCondo.id}:${editingPlan}:${Math.floor(Date.now()/1000) + daysToAdd * 86400}`).toString('base64url')}-MASTERKEY`;
      setGeneratedKey(key);
      setSuccessMsg('Chave gerada localmente!');
    }
  };

  const handleCopyKey = () => {
    if (generatedKey) {
      navigator.clipboard.writeText(generatedKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  const handleSaveSubscription = async () => {
    if (!selectedCondo) return;
    setSaving(true);
    setSuccessMsg(null);

    setTimeout(() => {
      setCondos(prev =>
        prev.map(c =>
          c.id === selectedCondo.id
            ? {
                ...c,
                subscription: {
                  ...c.subscription,
                  plan_id: editingPlan,
                  status: 'ACTIVE',
                  custom_price_monthly: customPrice,
                  current_period_ends_at: new Date(Date.now() + daysToAdd * 86400000).toISOString()
                }
              }
            : c
        )
      );
      setSaving(false);
      setSuccessMsg('Assinatura e valores atualizados com sucesso!');
    }, 600);
  };

  // Métricas
  const totalCondos = condos.length;
  const activeCount = condos.filter(c => c.subscription?.status === 'ACTIVE').length;
  const trialCount = condos.filter(c => c.subscription?.status === 'TRIAL').length;
  const estimatedMRR = condos.reduce((acc, c) => acc + (c.subscription?.custom_price_monthly || 0), 0);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-10">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* CABEÇALHO */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Link
                href="/admin"
                className="p-2 bg-slate-900 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white transition"
              >
                <ArrowLeft className="w-4 h-4" />
              </Link>
              <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/30 rounded-2xl">
                <CreditCard className="w-6 h-6 text-indigo-400" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-white">
                Gestão Master de Assinaturas & Planos
              </h1>
            </div>
            <p className="text-slate-400 text-sm">
              Controle de preços, limites de apartamentos, ativação de licenças e faturamento dos condomínios.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/admin/anuncios"
              className="flex items-center gap-2 px-4 py-2.5 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 text-purple-300 rounded-xl text-xs font-bold transition"
            >
              <Megaphone className="w-4 h-4" />
              <span>Gerenciar Anúncios (Ads)</span>
            </Link>
          </div>
        </div>

        {/* CARDS DE MÉTRICAS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs uppercase font-bold tracking-wider">MRR Estimado</span>
              <DollarSign className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-black text-emerald-400">
              R$ {estimatedMRR.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              <span className="text-xs font-normal text-slate-400 block mt-0.5">receita mensal recorrente</span>
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs uppercase font-bold tracking-wider">Condomínios Ativos</span>
              <CheckCircle2 className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="text-2xl font-black text-white">
              {activeCount}
              <span className="text-xs font-normal text-slate-400 block mt-0.5">planos pagos em dia</span>
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs uppercase font-bold tracking-wider">Período de Teste</span>
              <Clock className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl font-black text-amber-400">
              {trialCount}
              <span className="text-xs font-normal text-slate-400 block mt-0.5">trial 30 dias em andamento</span>
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs uppercase font-bold tracking-wider">Total de Clientes</span>
              <Building2 className="w-4 h-4 text-purple-400" />
            </div>
            <div className="text-2xl font-black text-white">
              {totalCondos}
              <span className="text-xs font-normal text-slate-400 block mt-0.5">portarias cadastradas</span>
            </div>
          </div>
        </div>

        {/* TABELA DE CONDOMÍNIOS & PAINEL DE CONTROLE */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* LISTA DE CONDOMÍNIOS */}
          <div className="lg:col-span-2 bg-slate-900/70 border border-slate-800 rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Building2 className="w-5 h-5 text-indigo-400" />
                <span>Condomínios & Assinaturas</span>
              </h2>
              <span className="text-xs text-slate-400">Selecione para gerenciar</span>
            </div>

            <div className="space-y-3">
              {condos.map(c => {
                const isSelected = selectedCondo?.id === c.id;
                const planId = c.subscription?.plan_id || 'TRIAL';
                const status = c.subscription?.status || 'TRIAL';

                return (
                  <div
                    key={c.id}
                    onClick={() => handleSelectCondo(c)}
                    className={`p-4 rounded-2xl border transition cursor-pointer flex items-center justify-between gap-4 ${
                      isSelected
                        ? 'bg-indigo-950/30 border-indigo-500/50 shadow-lg shadow-indigo-500/10'
                        : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-sm">{c.name}</span>
                        {status === 'TRIAL' && (
                          <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            Trial 30D
                          </span>
                        )}
                        {status === 'ACTIVE' && (
                          <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            Ativo
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400">{c.address || 'Sem endereço'}</p>
                      <div className="flex items-center gap-3 text-[11px] text-slate-500 pt-1">
                        <span>🏢 {c.unitsCount || 0} apartamentos</span>
                        <span>•</span>
                        <span className="font-semibold text-slate-300">
                          Plano: {planId === 'BASIC' ? 'Basic (Com Ads)' : planId === 'PRO' ? 'Pro' : planId === 'PRO_MAX' ? 'Pro Max' : 'Trial'}
                        </span>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="text-sm font-bold text-emerald-400 block">
                        R$ {(c.subscription?.custom_price_monthly || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/mês
                      </span>
                      <span className="text-[10px] text-slate-500">
                        Vence: {c.subscription?.current_period_ends_at ? new Date(c.subscription.current_period_ends_at).toLocaleDateString('pt-BR') : '-'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* PAINEL DE EDIÇÃO / GERAÇÃO DE CHAVE */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 space-y-5">
            <h3 className="text-base font-bold text-white flex items-center gap-2 pb-3 border-b border-slate-800">
              <Settings className="w-5 h-5 text-indigo-400" />
              <span>Configurar Licença</span>
            </h3>

            {selectedCondo ? (
              <div className="space-y-4 text-xs">
                <div>
                  <span className="text-slate-400 block mb-1">Condomínio Selecionado:</span>
                  <span className="font-bold text-white text-sm block">{selectedCondo.name}</span>
                </div>

                {/* ESCOLHA DO PLANO */}
                <div className="space-y-1.5">
                  <label className="text-slate-400 block font-semibold">Plano Atribuído:</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'TRIAL', label: 'Trial (Grátis)', desc: 'Até 250 Aps' },
                      { id: 'BASIC', label: 'Basic (Com Ads)', desc: 'Até 250 Aps' },
                      { id: 'PRO', label: 'Pro (Sem Ads)', desc: 'Até 250 Aps' },
                      { id: 'PRO_MAX', label: 'Pro Max', desc: 'Até 600 Aps' }
                    ].map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setEditingPlan(p.id as any);
                          if (p.id === 'BASIC') setCustomPrice(149);
                          else if (p.id === 'PRO') setCustomPrice(249);
                          else if (p.id === 'PRO_MAX') setCustomPrice(449);
                          else setCustomPrice(0);
                        }}
                        className={`p-2.5 rounded-xl border text-left transition ${
                          editingPlan === p.id
                            ? 'bg-indigo-600/30 border-indigo-400 text-white shadow'
                            : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <span className="font-bold block text-xs">{p.label}</span>
                        <span className="text-[10px] text-slate-500">{p.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* PREÇO MENSAL CUSTOMIZADO */}
                <div className="space-y-1.5">
                  <label className="text-slate-400 block font-semibold">Preço Mensal (R$):</label>
                  <input
                    type="number"
                    value={customPrice}
                    onChange={e => setCustomPrice(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-bold text-sm focus:border-indigo-500 focus:outline-none"
                  />
                  <span className="text-[10px] text-slate-500">Você pode dar descontos ou definir preço sob medida.</span>
                </div>

                {/* DIAS DE VALIDADE */}
                <div className="space-y-1.5">
                  <label className="text-slate-400 block font-semibold">Validade / Dias:</label>
                  <select
                    value={daysToAdd}
                    onChange={e => setDaysToAdd(parseInt(e.target.value, 10))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-xs focus:border-indigo-500 focus:outline-none"
                  >
                    <option value={30}>30 Dias (1 Mês)</option>
                    <option value={60}>60 Dias (2 Meses)</option>
                    <option value={90}>90 Dias (3 Meses)</option>
                    <option value={180}>180 Dias (Semestral)</option>
                    <option value={365}>365 Dias (Anual)</option>
                  </select>
                </div>

                {/* BOTÕES DE AÇÃO */}
                <div className="pt-2 space-y-2">
                  <button
                    type="button"
                    onClick={handleSaveSubscription}
                    disabled={saving}
                    className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold transition flex items-center justify-center gap-2"
                  >
                    {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    <span>Salvar Plano & Valores</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleGenerateKey}
                    className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-purple-300 border border-purple-500/30 rounded-xl font-bold transition flex items-center justify-center gap-2"
                  >
                    <KeyRound className="w-4 h-4" />
                    <span>Gerar Chave de Ativação Offline</span>
                  </button>
                </div>

                {/* MENSAGEM DE SUCESSO */}
                {successMsg && (
                  <div className="p-3 bg-emerald-950/40 border border-emerald-500/40 rounded-xl text-emerald-400 text-xs">
                    {successMsg}
                  </div>
                )}

                {/* CHAVE DE LICENÇA GERADA */}
                {generatedKey && (
                  <div className="p-3.5 bg-slate-950 border border-purple-500/40 rounded-2xl space-y-2">
                    <span className="text-[10px] uppercase font-bold text-purple-400 block">Chave de Licença Pronta:</span>
                    <div className="p-2 bg-slate-900 rounded-lg font-mono text-[10px] text-slate-300 break-all select-all">
                      {generatedKey}
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyKey}
                      className="w-full py-1.5 px-3 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition"
                    >
                      {copiedKey ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedKey ? 'Copiada!' : 'Copiar Chave para o Cliente'}</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-12 text-center text-slate-500 text-xs">
                Selecione um condomínio na lista ao lado para ajustar planos, preços ou gerar chaves de ativação.
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

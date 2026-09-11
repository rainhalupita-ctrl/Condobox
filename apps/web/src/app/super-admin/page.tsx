'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  ShieldAlert,
  ShieldCheck,
  Plus,
  Trash2,
  Building2,
  Users,
  Package,
  CreditCard,
  Image as ImageIcon,
  Loader2,
  Search,
  Eye,
  SlidersHorizontal,
  Calendar,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Phone,
  Mail,
  Pencil,
  X,
  ExternalLink,
  Sparkles,
  Lock,
  Unlock,
  Layers,
  ArrowRight
} from 'lucide-react';

interface AccountItem {
  id: string;
  name: string;
  address: string;
  phone: string;
  created_at: string;
  license: {
    id: string;
    plan: string;
    status: string;
    expires_at: string | null;
    max_apartments: number;
    created_at: string;
  } | null;
  syndic: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    role: string;
  } | null;
  stats: {
    units_count: number;
    max_units: number;
    residents_count: number;
    packages_count: number;
    pending_packages: number;
    staff_count: number;
  };
}

interface GlobalMetrics {
  total_condos: number;
  active_condos: number;
  trial_condos: number;
  blocked_condos: number;
  total_units: number;
  total_residents: number;
  total_packages: number;
  total_users: number;
}

export default function SuperAdminPage() {
  const { user, profile, isSuperAdmin, impersonateCondo, loading } = useAuth();
  const router = useRouter();
  const supabase = createClient();

  const [activeTab, setActiveTab] = useState<'ACCOUNTS' | 'ADS'>('ACCOUNTS');
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [metrics, setMetrics] = useState<GlobalMetrics | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [planFilter, setPlanFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Modal de Edição de Plano & Limites
  const [editingAccount, setEditingAccount] = useState<AccountItem | null>(null);
  const [editPlan, setEditPlan] = useState('TRIAL');
  const [editMaxApartments, setEditMaxApartments] = useState(250);
  const [editStatus, setEditStatus] = useState('ACTIVE');
  const [editExpiresAt, setEditExpiresAt] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [editMessage, setEditMessage] = useState<string | null>(null);

  // Modal de Cadastro de Nova Conta / Condomínio
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newCondoName, setNewCondoName] = useState('');
  const [newCondoAddress, setNewCondoAddress] = useState('');
  const [newCondoPhone, setNewCondoPhone] = useState('');
  const [newCondoPlan, setNewCondoPlan] = useState('TRIAL');
  const [newCondoMaxUnits, setNewCondoMaxUnits] = useState(250);
  const [newSyndicName, setNewSyndicName] = useState('');
  const [newSyndicEmail, setNewSyndicEmail] = useState('');
  const [newSyndicPassword, setNewSyndicPassword] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Anúncios
  const [ads, setAds] = useState<any[]>([]);
  const [adImage, setAdImage] = useState('');
  const [adLink, setAdLink] = useState('');
  const [adLoading, setAdLoading] = useState(false);

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.replace('/login');
      } else {
        loadData();
      }
    }
  }, [user, loading, router]);

  const loadData = async () => {
    setLoadingData(true);
    try {
      // 1. Carrega dados via API de Super Admin
      const res = await fetch('/api/super-admin/accounts');
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts || []);
        setMetrics(data.metrics || null);
      } else {
        console.error('Falha ao carregar contas do Super Admin');
      }

      // 2. Carrega anúncios
      const { data: adsData } = await supabase.from('ads').select('*').order('created_at', { ascending: false });
      if (adsData) setAds(adsData);
    } catch (e) {
      console.error('Erro ao carregar dados:', e);
    } finally {
      setLoadingData(false);
    }
  };

  // Abrir Modal de Edição de Plano
  const handleOpenEditModal = (account: AccountItem) => {
    setEditingAccount(account);
    setEditPlan(account.license?.plan || 'TRIAL');
    setEditMaxApartments(account.license?.max_apartments || 250);
    setEditStatus(account.license?.status || 'ACTIVE');

    if (account.license?.expires_at) {
      // Formato YYYY-MM-DD para input date
      const d = new Date(account.license.expires_at);
      setEditExpiresAt(d.toISOString().split('T')[0]);
    } else {
      setEditExpiresAt('');
    }
    setEditMessage(null);
  };

  // Salvar Alteração de Plano & Limites
  const handleSaveLicense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAccount) return;

    setEditLoading(true);
    setEditMessage(null);

    try {
      const res = await fetch('/api/super-admin/accounts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          condoId: editingAccount.id,
          plan: editPlan,
          status: editStatus,
          maxApartments: editMaxApartments,
          expiresAt: editExpiresAt ? new Date(editExpiresAt).toISOString() : null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Erro ao salvar licença.');
      }

      setEditMessage('✅ Plano e limites atualizados com sucesso!');
      setTimeout(() => {
        setEditingAccount(null);
        loadData();
      }, 1000);
    } catch (err: any) {
      setEditMessage(`❌ ${err.message}`);
    } finally {
      setEditLoading(false);
    }
  };

  // Criar Nova Conta
  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCondoName.trim()) {
      setCreateError('Informe o nome do condomínio.');
      return;
    }

    setCreateLoading(true);
    setCreateError(null);

    try {
      const res = await fetch('/api/super-admin/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCondoName.trim(),
          address: newCondoAddress.trim(),
          phone: newCondoPhone.trim(),
          plan: newCondoPlan,
          maxApartments: newCondoMaxUnits,
          syndicName: newSyndicName.trim() || undefined,
          syndicEmail: newSyndicEmail.trim() || undefined,
          syndicPassword: newSyndicPassword || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Erro ao cadastrar condomínio.');
      }

      setIsCreateModalOpen(false);
      setNewCondoName('');
      setNewCondoAddress('');
      setNewCondoPhone('');
      setNewSyndicName('');
      setNewSyndicEmail('');
      setNewSyndicPassword('');
      loadData();
    } catch (err: any) {
      setCreateError(err.message);
    } finally {
      setCreateLoading(false);
    }
  };

  // Impersonar Condomínio
  const handleImpersonate = (account: AccountItem) => {
    impersonateCondo({ id: account.id, name: account.name });
    router.push('/admin');
  };

  // Excluir Conta
  const handleDeleteAccount = async (account: AccountItem) => {
    const confirmName = prompt(`Para excluir permanentemente o condomínio "${account.name}", digite o nome exato dele:`);
    if (confirmName !== account.name) {
      if (confirmName !== null) alert('Nome incorreto. Exclusão cancelada.');
      return;
    }

    try {
      const res = await fetch(`/api/super-admin/accounts?condoId=${account.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      loadData();
    } catch (err: any) {
      alert(`Erro ao excluir: ${err.message}`);
    }
  };

  // Anúncios Handlers
  const handleCreateAd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adImage) return;
    setAdLoading(true);
    try {
      await supabase.from('ads').insert({
        image_url: adImage,
        link_url: adLink,
        active: true,
      });
      setAdImage('');
      setAdLink('');
      loadData();
    } finally {
      setAdLoading(false);
    }
  };

  const handleToggleAd = async (id: string, active: boolean) => {
    await supabase.from('ads').update({ active }).eq('id', id);
    loadData();
  };

  const handleDeleteAd = async (id: string) => {
    if (confirm('Deletar anúncio?')) {
      await supabase.from('ads').delete().eq('id', id);
      loadData();
    }
  };

  // Filtros de contas
  const filteredAccounts = accounts.filter(acc => {
    const q = searchQuery.toLowerCase();
    const matchSearch =
      !searchQuery.trim() ||
      acc.name.toLowerCase().includes(q) ||
      acc.address.toLowerCase().includes(q) ||
      (acc.syndic?.name && acc.syndic.name.toLowerCase().includes(q)) ||
      (acc.syndic?.email && acc.syndic.email.toLowerCase().includes(q));

    const matchPlan =
      planFilter === 'ALL' ||
      (acc.license?.plan || 'TRIAL').toUpperCase() === planFilter.toUpperCase();

    const matchStatus =
      statusFilter === 'ALL' ||
      (acc.license?.status || 'ACTIVE').toUpperCase() === statusFilter.toUpperCase();

    return matchSearch && matchPlan && matchStatus;
  });

  if (loading || loadingData) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center gap-3">
        <Loader2 className="animate-spin text-purple-500 w-9 h-9" />
        <p className="text-xs text-slate-400 font-medium">Carregando painel master SaaS...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in pb-16">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-2xl text-white shadow-lg shadow-purple-950/50">
              <ShieldAlert size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
                Super Admin <span className="text-xs px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 font-mono font-bold">MASTER SaaS</span>
              </h1>
              <p className="text-slate-400 text-xs mt-0.5">
                Controle global de contas de condomínios, licenciamento, limites de capacidade e impersonação.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={loadData}
            className="p-2.5 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl border border-slate-800 text-xs font-semibold transition flex items-center gap-1.5 shadow-sm"
            title="Atualizar dados"
          >
            <RefreshCw size={15} />
          </button>

          <button
            type="button"
            onClick={() => setIsCreateModalOpen(true)}
            className="px-4 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-lg shadow-purple-950/50 active:scale-95"
          >
            <Plus size={16} /> Nova Conta de Condomínio
          </button>
        </div>
      </div>

      {/* KPIs Globais da Plataforma */}
      {metrics && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-900 border border-slate-800/90 rounded-3xl p-5 shadow-xl flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-slate-400 block">Total de Condomínios</span>
              <span className="text-3xl font-black text-white mt-1 block">{metrics.total_condos}</span>
              <span className="text-[11px] text-emerald-400 font-medium">{metrics.active_condos} ativos no sistema</span>
            </div>
            <div className="p-3 bg-purple-500/10 text-purple-400 rounded-2xl border border-purple-500/20">
              <Building2 size={24} />
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800/90 rounded-3xl p-5 shadow-xl flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-slate-400 block">Apartamentos na Rede</span>
              <span className="text-3xl font-black text-indigo-400 mt-1 block">{metrics.total_units}</span>
              <span className="text-[11px] text-slate-500">Unidades cadastradas</span>
            </div>
            <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-2xl border border-indigo-500/20">
              <Layers size={24} />
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800/90 rounded-3xl p-5 shadow-xl flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-slate-400 block">Moradores Cadastrados</span>
              <span className="text-3xl font-black text-emerald-400 mt-1 block">{metrics.total_residents}</span>
              <span className="text-[11px] text-slate-500">Com alertas WhatsApp</span>
            </div>
            <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-2xl border border-emerald-500/20">
              <Users size={24} />
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800/90 rounded-3xl p-5 shadow-xl flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-slate-400 block">Total de Encomendas</span>
              <span className="text-3xl font-black text-amber-400 mt-1 block">{metrics.total_packages}</span>
              <span className="text-[11px] text-slate-500">Processadas pela IA</span>
            </div>
            <div className="p-3 bg-amber-500/10 text-amber-400 rounded-2xl border border-amber-500/20">
              <Package size={24} />
            </div>
          </div>
        </div>
      )}

      {/* Navegação entre Abas (Contas vs Anúncios) */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-1">
        <button
          type="button"
          onClick={() => setActiveTab('ACCOUNTS')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition ${
            activeTab === 'ACCOUNTS'
              ? 'bg-purple-600 text-white shadow-md shadow-purple-950/40'
              : 'text-slate-400 hover:text-white hover:bg-slate-900'
          }`}
        >
          <Building2 size={15} />
          Contas & Licenciamento ({accounts.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('ADS')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition ${
            activeTab === 'ADS'
              ? 'bg-purple-600 text-white shadow-md shadow-purple-950/40'
              : 'text-slate-400 hover:text-white hover:bg-slate-900'
          }`}
        >
          <ImageIcon size={15} />
          Rede de Anúncios / Ads ({ads.length})
        </button>
      </div>

      {/* ABA 1: GESTÃO DE CONTAS */}
      {activeTab === 'ACCOUNTS' && (
        <div className="space-y-4">
          {/* Barra de Busca e Filtros */}
          <div className="flex flex-col md:flex-row items-center justify-between gap-3 bg-slate-900/70 p-3 rounded-2xl border border-slate-800">
            <div className="relative w-full md:w-80">
              <Search size={14} className="text-slate-500 absolute left-3 top-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Buscar por condomínio, cidade, síndico..."
                className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-xs focus:outline-none focus:border-purple-500"
              />
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto">
              <select
                value={planFilter}
                onChange={e => setPlanFilter(e.target.value)}
                className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-xs font-semibold focus:outline-none"
              >
                <option value="ALL">Todos os Planos</option>
                <option value="TRIAL">Trial (30 dias)</option>
                <option value="BASIC">Basic (Com Ads)</option>
                <option value="PRO">Pro (Sem Ads)</option>
                <option value="PRO_MAX">Pro Max (600 Aps)</option>
              </select>

              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-xs font-semibold focus:outline-none"
              >
                <option value="ALL">Todos os Status</option>
                <option value="ACTIVE">Ativo</option>
                <option value="TRIAL">Em Teste</option>
                <option value="EXPIRED">Expirado</option>
                <option value="BLOCKED">Bloqueado</option>
              </select>
            </div>
          </div>

          {/* Tabela de Contas de Condomínio */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="p-4">Condomínio & Localização</th>
                    <th className="p-4">Síndico / Contato</th>
                    <th className="p-4">Plano</th>
                    <th className="p-4">Capacidade (Aptos)</th>
                    <th className="p-4">Status & Validade</th>
                    <th className="p-4 text-right">Ações Master</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredAccounts.map(account => {
                    const plan = account.license?.plan || 'TRIAL';
                    const status = account.license?.status || 'ACTIVE';
                    const maxUnits = account.license?.max_apartments || 250;
                    const usedUnits = account.stats.units_count;
                    const percentUnits = Math.min(Math.round((usedUnits / maxUnits) * 100), 100);

                    // Formatação de expiração
                    let expiresFormatted = 'Vitalício';
                    let isExpired = false;
                    if (account.license?.expires_at) {
                      const expDate = new Date(account.license.expires_at);
                      expiresFormatted = expDate.toLocaleDateString('pt-BR');
                      isExpired = expDate.getTime() < Date.now();
                    }

                    return (
                      <tr key={account.id} className="hover:bg-slate-850/50 transition">
                        {/* Condomínio */}
                        <td className="p-4">
                          <div className="font-bold text-sm text-slate-100 flex items-center gap-2">
                            <Building2 size={16} className="text-purple-400 shrink-0" />
                            <span>{account.name}</span>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5 truncate max-w-xs">
                            {account.address || 'Endereço não informado'}
                          </p>
                          <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                            ID: {account.id}
                          </p>
                        </td>

                        {/* Síndico */}
                        <td className="p-4">
                          {account.syndic ? (
                            <div className="space-y-0.5">
                              <p className="font-semibold text-slate-200 flex items-center gap-1.5">
                                <Users size={12} className="text-indigo-400" />
                                {account.syndic.name}
                              </p>
                              {account.syndic.email && (
                                <p className="text-[11px] text-slate-400 flex items-center gap-1 font-mono">
                                  <Mail size={11} className="text-slate-500" />
                                  {account.syndic.email}
                                </p>
                              )}
                              {account.syndic.phone && (
                                <p className="text-[11px] text-emerald-400 flex items-center gap-1 font-mono font-semibold">
                                  <Phone size={11} />
                                  {account.syndic.phone}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-500 italic text-[11px]">Nenhum síndico vinculado</span>
                          )}
                        </td>

                        {/* Plano */}
                        <td className="p-4">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-bold uppercase tracking-wide border ${
                              plan === 'PRO_MAX'
                                ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                                : plan === 'PRO'
                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                                : plan === 'BASIC'
                                ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                                : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                            }`}
                          >
                            <Sparkles size={11} />
                            {plan === 'PRO_MAX' ? 'Pro Max' : plan}
                          </span>
                        </td>

                        {/* Capacidade e Limite de Aptos */}
                        <td className="p-4">
                          <div className="space-y-1.5 w-36">
                            <div className="flex justify-between text-[11px] font-semibold">
                              <span className="text-slate-200">{usedUnits} aptos</span>
                              <span className="text-slate-500">/ {maxUnits}</span>
                            </div>
                            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  percentUnits >= 100
                                    ? 'bg-rose-500'
                                    : percentUnits >= 80
                                    ? 'bg-amber-400'
                                    : 'bg-indigo-500'
                                }`}
                                style={{ width: `${percentUnits}%` }}
                              />
                            </div>
                            <p className="text-[10px] text-slate-500">
                              {account.stats.residents_count} moradores • {account.stats.packages_count} encomendas
                            </p>
                          </div>
                        </td>

                        {/* Status e Validade */}
                        <td className="p-4">
                          <div className="space-y-1">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                                status === 'ACTIVE' && !isExpired
                                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                  : status === 'BLOCKED'
                                  ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                                  : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                              }`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${status === 'ACTIVE' && !isExpired ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                              {status === 'ACTIVE' && !isExpired ? 'Liberado' : status === 'BLOCKED' ? 'Bloqueado' : isExpired ? 'Expirado' : status}
                            </span>
                            <p className="text-[11px] text-slate-400 flex items-center gap-1">
                              <Calendar size={11} className="text-slate-500" />
                              Validade: <strong className="text-slate-300">{expiresFormatted}</strong>
                            </p>
                          </div>
                        </td>

                        {/* Ações Master */}
                        <td className="p-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Botão de Impersonação */}
                            <button
                              type="button"
                              onClick={() => handleImpersonate(account)}
                              className="px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm active:scale-95"
                              title={`Impersonar condomínio ${account.name} e navegar como Síndico`}
                            >
                              <Eye size={13} />
                              <span>Impersonar</span>
                            </button>

                            {/* Botão de Alterar Plano & Limites */}
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(account)}
                              className="p-1.5 text-slate-400 hover:text-purple-300 hover:bg-slate-800 rounded-xl transition border border-transparent hover:border-slate-700"
                              title="Alterar plano, limites e expiração"
                            >
                              <SlidersHorizontal size={15} />
                            </button>

                            {/* Botão de Excluir */}
                            <button
                              type="button"
                              onClick={() => handleDeleteAccount(account)}
                              className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded-xl transition"
                              title="Excluir condomínio"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredAccounts.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-500 text-xs">
                        Nenhum condomínio encontrado com os filtros selecionados.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ABA 2: REDE DE ANÚNCIOS */}
      {activeTab === 'ADS' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Formulário Novo Anúncio */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Plus size={18} className="text-purple-400" /> Cadastrar Novo Anúncio (Plano Basic)
            </h2>
            <p className="text-xs text-slate-400">
              Anúncios aparecem no rodapé de mensagens WhatsApp e na página de retirada de pacotes dos condomínios no plano Basic.
            </p>

            <form onSubmit={handleCreateAd} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">URL da Imagem / Banner *</label>
                <input
                  type="text"
                  required
                  placeholder="https://exemplo.com/banner.jpg"
                  value={adImage}
                  onChange={e => setAdImage(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Link de Destino (Site / WhatsApp) *</label>
                <input
                  type="text"
                  placeholder="https://wa.me/55... ou https://meusite.com"
                  value={adLink}
                  onChange={e => setAdLink(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-purple-500"
                />
              </div>

              <button
                type="submit"
                disabled={adLoading}
                className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-purple-950 disabled:opacity-50"
              >
                {adLoading ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                Cadastrar Anúncio
              </button>
            </form>
          </div>

          {/* Lista de Anúncios Rodando */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <ImageIcon size={18} className="text-purple-400" /> Anúncios Ativos na Rede
            </h2>

            <div className="space-y-3">
              {ads.map(ad => (
                <div
                  key={ad.id}
                  className={`p-3.5 rounded-2xl border flex items-center gap-3.5 transition ${
                    ad.active ? 'bg-slate-950 border-slate-800' : 'bg-slate-950/40 border-slate-800/40 opacity-50'
                  }`}
                >
                  <img
                    src={ad.image_url}
                    alt="Banner"
                    className="w-20 h-14 object-cover rounded-xl border border-slate-800 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <a
                      href={ad.link_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-purple-400 hover:underline truncate block font-mono"
                    >
                      {ad.link_url || 'Sem link externo'}
                    </a>
                    <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1.5">
                      <Eye size={12} className="text-slate-500" /> {ad.views || 0} visualizações
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleToggleAd(ad.id, !ad.active)}
                      className="px-2.5 py-1.5 bg-slate-850 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold transition"
                    >
                      {ad.active ? 'Pausar' : 'Ativar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteAd(ad.id)}
                      className="p-1.5 text-slate-500 hover:text-rose-400 rounded-xl transition"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
              {ads.length === 0 && (
                <p className="text-xs text-slate-500 text-center py-6">Nenhum anúncio veiculado no momento.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: EDITAR PLANO E LIMITES */}
      {editingAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-700/80 rounded-3xl p-6 sm:p-7 max-w-lg w-full space-y-5 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-purple-500/15 border border-purple-500/30 rounded-xl text-purple-400">
                  <SlidersHorizontal size={18} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Alterar Plano & Limites</h3>
                  <p className="text-xs text-slate-400 truncate max-w-xs">{editingAccount.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingAccount(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition"
              >
                <X size={18} />
              </button>
            </div>

            {editMessage && (
              <div
                className={`p-3 rounded-xl text-xs font-medium ${
                  editMessage.startsWith('✅')
                    ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
                }`}
              >
                {editMessage}
              </div>
            )}

            <form onSubmit={handleSaveLicense} className="space-y-4 text-xs">
              {/* Seletor de Plano */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">Plano de Assinatura *</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'TRIAL', name: 'Trial (30 dias)', desc: 'Até 250 Aps' },
                    { id: 'BASIC', name: 'Basic (Com Ads)', desc: 'Até 250 Aps • R$ 149' },
                    { id: 'PRO', name: 'Pro (Sem Ads)', desc: 'Até 250 Aps • R$ 249' },
                    { id: 'PRO_MAX', name: 'Pro Max', desc: 'Até 600 Aps • R$ 449' },
                  ].map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setEditPlan(p.id);
                        if (p.id === 'PRO_MAX') setEditMaxApartments(600);
                        else setEditMaxApartments(250);
                      }}
                      className={`p-3 rounded-2xl border text-left transition ${
                        editPlan === p.id
                          ? 'bg-purple-600/20 border-purple-500 text-white font-bold shadow-sm'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-bold text-xs">{p.name}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">{p.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Limite de Apartamentos Customizado */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Limite Máximo de Apartamentos (Capacidade) *
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="5000"
                    required
                    value={editMaxApartments}
                    onChange={e => setEditMaxApartments(Number(e.target.value))}
                    className="flex-1 px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white font-bold text-sm focus:outline-none focus:border-purple-500"
                  />
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditMaxApartments(250)}
                      className="px-2.5 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-[11px] font-semibold text-slate-300"
                    >
                      250
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditMaxApartments(600)}
                      className="px-2.5 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-[11px] font-semibold text-slate-300"
                    >
                      600
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditMaxApartments(1000)}
                      className="px-2.5 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-[11px] font-semibold text-slate-300"
                    >
                      1000
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Atualmente este condomínio está utilizando <strong>{editingAccount.stats.units_count}</strong> apartamentos.
                </p>
              </div>

              {/* Status da Licença */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Status de Acesso / Licença *</label>
                <select
                  value={editStatus}
                  onChange={e => setEditStatus(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white font-semibold text-xs focus:outline-none focus:border-purple-500"
                >
                  <option value="ACTIVE">ATIVO (Acesso liberado normal)</option>
                  <option value="TRIAL">EM TESTE (Trial gratuito)</option>
                  <option value="EXPIRED">EXPIRADO (Avisa expiração)</option>
                  <option value="BLOCKED">BLOQUEADO (Inadimplente / Bloqueio total)</option>
                </select>
              </div>

              {/* Data de Expiração */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Data de Expiração da Licença</label>
                <input
                  type="date"
                  value={editExpiresAt}
                  onChange={e => setEditExpiresAt(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs focus:outline-none focus:border-purple-500 font-mono"
                />
                <div className="flex gap-2 mt-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date();
                      d.setDate(d.getDate() + 30);
                      setEditExpiresAt(d.toISOString().split('T')[0]);
                    }}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[10px] font-semibold"
                  >
                    +30 dias
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date();
                      d.setMonth(d.getMonth() + 6);
                      setEditExpiresAt(d.toISOString().split('T')[0]);
                    }}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[10px] font-semibold"
                  >
                    +6 meses
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date();
                      d.setFullYear(d.getFullYear() + 1);
                      setEditExpiresAt(d.toISOString().split('T')[0]);
                    }}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[10px] font-semibold"
                  >
                    +1 ano
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditExpiresAt('')}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[10px] font-semibold"
                  >
                    Sem Expiração (Vitalício)
                  </button>
                </div>
              </div>

              {/* Botões do Modal */}
              <div className="flex gap-2.5 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingAccount(null)}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-semibold transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={editLoading}
                  className="flex-1 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-purple-950 disabled:opacity-50"
                >
                  {editLoading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: NOVA CONTA DE CONDOMÍNIO */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-700/80 rounded-3xl p-6 sm:p-7 max-w-lg w-full space-y-5 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-purple-500/15 border border-purple-500/30 rounded-xl text-purple-400">
                  <Plus size={18} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Criar Nova Conta de Condomínio</h3>
                  <p className="text-xs text-slate-400">Cadastre o condomínio e configure o plano inicial.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition"
              >
                <X size={18} />
              </button>
            </div>

            {createError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle size={15} className="shrink-0" />
                <span>{createError}</span>
              </div>
            )}

            <form onSubmit={handleCreateAccount} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Nome do Condomínio *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Condomínio Solar das Palmeiras"
                  value={newCondoName}
                  onChange={e => setNewCondoName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Endereço / Cidade</label>
                  <input
                    type="text"
                    placeholder="Ex: Av. Brasil, 500"
                    value={newCondoAddress}
                    onChange={e => setNewCondoAddress(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Telefone da Portaria</label>
                  <input
                    type="text"
                    placeholder="Ex: 5573981953741"
                    value={newCondoPhone}
                    onChange={e => setNewCondoPhone(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-purple-500 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Plano Inicial *</label>
                  <select
                    value={newCondoPlan}
                    onChange={e => {
                      setNewCondoPlan(e.target.value);
                      if (e.target.value === 'PRO_MAX') setNewCondoMaxUnits(600);
                      else setNewCondoMaxUnits(250);
                    }}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-purple-500 font-semibold"
                  >
                    <option value="TRIAL">Trial 30 Dias (Grátis)</option>
                    <option value="BASIC">Basic (Com Ads)</option>
                    <option value="PRO">Pro (Sem Ads)</option>
                    <option value="PRO_MAX">Pro Max (600 Aps)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Limite Máximo de Aps *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={newCondoMaxUnits}
                    onChange={e => setNewCondoMaxUnits(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-purple-500 font-mono font-bold"
                  />
                </div>
              </div>

              {/* Síndico Inicial (Opcional) */}
              <div className="pt-2 border-t border-slate-800 space-y-3">
                <p className="font-bold text-slate-200 flex items-center gap-1.5">
                  <Users size={14} className="text-indigo-400" />
                  Conta do Síndico / Gestor (Opcional)
                </p>

                <div>
                  <label className="block text-slate-400 mb-1">Nome do Síndico</label>
                  <input
                    type="text"
                    placeholder="Ex: Roberto Carlos"
                    value={newSyndicName}
                    onChange={e => setNewSyndicName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-purple-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-400 mb-1">E-mail de Acesso</label>
                    <input
                      type="email"
                      placeholder="sindico@condominio.com"
                      value={newSyndicEmail}
                      onChange={e => setNewSyndicEmail(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-purple-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Senha Inicial</label>
                    <input
                      type="password"
                      placeholder="••••••••"
                      value={newSyndicPassword}
                      onChange={e => setNewSyndicPassword(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-purple-500"
                    />
                  </div>
                </div>
              </div>

              {/* Botões do Modal */}
              <div className="flex gap-2.5 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-semibold transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={createLoading}
                  className="flex-1 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-purple-950 disabled:opacity-50"
                >
                  {createLoading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  Criar Condomínio
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

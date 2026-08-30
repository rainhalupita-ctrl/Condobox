'use client';

import React, { useState, useEffect } from 'react';
import { PackageCard } from '../../components/package-card';
import { QRGenerator } from '../../components/qr-generator';
import { Package as PackageType, Resident } from '../../types/database';
import { createClient } from '../../lib/supabase/client';
import { useAuth } from '../../contexts/auth-context';
import {
  Smartphone,
  QrCode,
  Package,
  Clock,
  CheckCircle2,
  UserCheck,
  ShieldCheck,
  RefreshCw,
  Bell,
  Building,
  AlertCircle
} from 'lucide-react';
import Link from 'next/link';

export default function MoradorPage() {
  const { user, profile, loading: authLoading } = useAuth();
  const [resident, setResident] = useState<Resident | null>(null);
  const [packages, setPackages] = useState<PackageType[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'PENDING' | 'HISTORY'>('PENDING');

  const loadResidentAndPackages = async () => {
    if (!user) return;
    setLoading(true);
    const supabase = createClient();

    try {
      // 1. Buscar morador vinculado ao user_id autenticado
      let { data: resData } = await supabase
        .from('residents')
        .select('*, unit:units(*)')
        .eq('user_id', user.id)
        .maybeSingle();

      // Fallback: se não vinculado por user_id, buscar por email ou telefone
      if (!resData && user.email) {
        const { data: resByEmail } = await supabase
          .from('residents')
          .select('*, unit:units(*)')
          .eq('email', user.email)
          .maybeSingle();
        
        if (resByEmail) {
          resData = resByEmail;
          // Vincular automaticamente o user_id para os próximos acessos
          await supabase
            .from('residents')
            .update({ user_id: user.id })
            .eq('id', resByEmail.id);
        }
      }

      setResident(resData as Resident | null);

      if (resData?.unit_id) {
        // 2. Buscar encomendas reais da unidade do morador
        const { data: pkgData } = await supabase
          .from('packages')
          .select('*, unit:units(*), resident:residents(*)')
          .eq('unit_id', resData.unit_id)
          .order('received_at', { ascending: false });

        setPackages((pkgData as PackageType[]) || []);
      } else {
        setPackages([]);
      }
    } catch (err) {
      console.error('Erro ao carregar dados do morador:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && user) {
      loadResidentAndPackages();

      const supabase = createClient();
      const channel = supabase
        .channel('packages-morador-live')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'packages' },
          () => {
            loadResidentAndPackages();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [authLoading, user]);

  const pendingPackages = packages.filter(p => p.status !== 'DELIVERED' && p.status !== 'RETURNED');
  const historyPackages = packages.filter(p => p.status === 'DELIVERED' || p.status === 'RETURNED');

  if (authLoading || loading) {
    return (
      <div className="py-20 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
        <RefreshCw className="w-8 h-8 animate-spin text-emerald-400" />
        <p className="text-sm font-medium">Carregando suas informações e encomendas...</p>
      </div>
    );
  }

  // Caso o usuário não tenha registro de morador/unidade vinculado
  if (!resident) {
    return (
      <div className="max-w-xl mx-auto py-12 px-4">
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center space-y-4 shadow-2xl">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center mx-auto">
            <AlertCircle size={32} />
          </div>
          <h2 className="text-xl font-bold text-slate-100">Unidade não vinculada</h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            Olá, <strong className="text-slate-200">{profile?.name || user?.email}</strong>! Sua conta ainda não possui um apartamento/unidade associado no condomínio.
          </p>
          <div className="pt-2">
            <Link
              href="/admin"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition"
            >
              Solicitar ao Síndico ou Portaria
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Perfil Real do Morador Autenticado */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl flex items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center font-bold text-lg">
            {resident.name ? resident.name.charAt(0).toUpperCase() : 'M'}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-100">{resident.name}</h2>
              <span className="text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2.5 py-0.5 rounded-full">
                Morador Ativo
              </span>
            </div>
            <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
              <Building size={13} className="text-slate-500" />
              {resident.unit ? `${resident.unit.block} — Apto ${resident.unit.unit_number}` : 'Unidade'}
            </p>
          </div>
        </div>

        <button
          onClick={loadResidentAndPackages}
          className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
          title="Atualizar"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Cartão de Retirada com QR Code (Se houver encomendas pendentes) */}
      {pendingPackages.length > 0 && (
        <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/30 border border-emerald-500/30 rounded-3xl p-6 sm:p-8 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-8 animate-fade-in">
          <div className="space-y-4 text-center md:text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-semibold border border-emerald-500/30">
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
              <span className="text-2xl font-black font-mono text-emerald-400 bg-emerald-950/80 border border-emerald-700/60 px-4 py-1 rounded-xl tracking-widest">
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
              ? 'bg-emerald-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
        >
          <Clock className="w-4 h-4" /> Aguardando Retirada ({pendingPackages.length})
        </button>
        <button
          onClick={() => setActiveTab('HISTORY')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition ${
            activeTab === 'HISTORY'
              ? 'bg-emerald-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
        >
          <CheckCircle2 className="w-4 h-4" /> Histórico Entregue ({historyPackages.length})
        </button>
      </div>

      {/* Lista de Encomendas Reais */}
      {activeTab === 'PENDING' ? (
        pendingPackages.length === 0 ? (
          <div className="py-16 text-center text-slate-400 bg-slate-900/40 border border-dashed border-slate-800 rounded-3xl p-8 flex flex-col items-center gap-3">
            <Package className="w-12 h-12 text-slate-600" />
            <h3 className="text-base font-bold text-slate-300">Você não tem encomendas pendentes na portaria</h3>
            <p className="text-xs text-slate-500 max-w-sm">
              Assim que um pacote for registrado na portaria para o seu apartamento, ele aparecerá aqui com o código e QR Code de retirada.
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
            Aqui você poderá consultar todas as encomendas retiradas no passado com data e assinatura.
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

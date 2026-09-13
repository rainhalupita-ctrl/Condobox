'use client';

import React, { useState, useEffect } from 'react';
import { createClient } from '../lib/supabase/client';
import { useAuth } from '../contexts/auth-context';
import { buildSupportWhatsAppUrl } from '@/lib/support-contacts';
import {
  Lock,
  KeyRound,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  PhoneCall,
  CreditCard,
  Building2,
  Clock
} from 'lucide-react';

interface SubscriptionData {
  plan_id: 'TRIAL' | 'BASIC' | 'PRO' | 'PRO_MAX';
  status: 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
  custom_price_monthly?: number;
  current_period_ends_at: string;
  plan?: {
    name: string;
    max_units: number;
    has_ads: boolean;
  };
}

interface Props {
  children: React.ReactNode;
}

export function SubscriptionGate({ children }: Props) {
  const { effectiveCondoId, license } = useAuth();
  const [sub, setSub] = useState<SubscriptionData | null>(null);
  const [unitsUsage, setUnitsUsage] = useState<{ current: number; max: number; canAddMore: boolean; percentage: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [licenseKeyInput, setLicenseKeyInput] = useState('');
  const [activating, setActivating] = useState(false);
  const [activationMsg, setActivationMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    checkLicense();

    const handleUnitsChanged = () => {
      checkLicense();
    };

    window.addEventListener('condo_units_changed', handleUnitsChanged);
    return () => {
      window.removeEventListener('condo_units_changed', handleUnitsChanged);
    };
  }, [effectiveCondoId, license]);

  const checkLicense = async () => {
    setLoading(true);
    try {
      let realUnitsCount = 0;
      let unitsFetched = false;
      try {
        if (effectiveCondoId) {
          const supabase = createClient();
          const { data: unitsData } = await supabase
            .from('units')
            .select('block, unit_number')
            .eq('condo_id', effectiveCondoId);
          if (unitsData) {
            const uniqueMap = new Map<string, boolean>();
            unitsData.forEach((u: any) => {
              const key = `${(u.block || 'Bloco A').trim().toUpperCase()}__${(u.unit_number || '').trim()}`;
              uniqueMap.set(key, true);
            });
            realUnitsCount = uniqueMap.size;
            unitsFetched = true;
          }
        }
      } catch {}

      const localApiUrl = effectiveCondoId
        ? `http://localhost:3001/api/license/status?condoId=${encodeURIComponent(effectiveCondoId)}`
        : 'http://localhost:3001/api/license/status';

      const res = await fetch(localApiUrl).catch(() => null);
      if (res && res.ok) {
        const data = await res.json();
        if (data.subscription) {
          // A quantidade real de unidades do condomínio ativo tem precedência absoluta
          const currentCount = unitsFetched ? realUnitsCount : (data.unitsUsage?.current ?? realUnitsCount);
          const maxUnits = license?.max_apartments || data.unitsUsage?.max || data.subscription.plan?.max_units || 250;
          setSub(data.subscription);
          setUnitsUsage({
            current: currentCount,
            max: maxUnits,
            canAddMore: currentCount < maxUnits,
            percentage: Math.min(100, Math.round((currentCount / maxUnits) * 100))
          });
          return;
        }
      }

      // Fallback padrão se API local não responder: usa a licença real do condomínio do Supabase
      const fallbackDate = license?.expires_at || new Date(Date.now() + 25 * 86400000).toISOString();
      const maxUnits = license?.max_apartments || 250;
      const currentCount = realUnitsCount;
      const planName = license?.plan === 'PRO_MAX' ? 'Plano Pro Max' : (license?.plan === 'PRO' ? 'Plano Pro' : (license?.plan === 'BASIC' ? 'Plano Básico' : 'Teste Grátis 30 Dias'));
      setSub({
        plan_id: (license?.plan as any) || 'TRIAL',
        status: (license?.status as any) || 'TRIAL',
        current_period_ends_at: fallbackDate,
        plan: {
          name: planName,
          max_units: maxUnits,
          has_ads: false
        }
      });
      setUnitsUsage({
        current: currentCount,
        max: maxUnits,
        canAddMore: currentCount < maxUnits,
        percentage: Math.min(100, Math.round((currentCount / maxUnits) * 100))
      });
    } catch {
      // Permitir uso caso de erro transitório
    } finally {
      setLoading(false);
    }
  };

  const handleActivateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!licenseKeyInput.trim()) return;

    setActivating(true);
    setActivationMsg(null);

    try {
      const res = await fetch('http://localhost:3001/api/license/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: licenseKeyInput })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setActivationMsg({ type: 'success', text: data.message || 'Licença ativada com sucesso!' });
        if (data.subscription) {
          setSub(data.subscription);
        }
        setTimeout(() => {
          checkLicense();
        }, 1500);
      } else {
        setActivationMsg({ type: 'error', text: data.message || 'Chave de licença inválida ou expirada.' });
      }
    } catch {
      setActivationMsg({ type: 'error', text: 'Não foi possível conectar com o serviço de licença local.' });
    } finally {
      setActivating(false);
    }
  };

  // Calcula dias restantes da assinatura / teste
  const getDaysRemaining = () => {
    const expirationDateStr = license?.expires_at || sub?.current_period_ends_at;
    if (!expirationDateStr) return null;
    const expiresAt = new Date(expirationDateStr).getTime();
    if (isNaN(expiresAt)) return null;
    const diffMs = expiresAt - Date.now();
    const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    return days;
  };

  const daysRemaining = getDaysRemaining();

  // Se a assinatura estiver expirada, suspensa ou com tempo esgotado (dias <= 0), exibe a tela de bloqueio
  const isExpiredByDate = daysRemaining !== null && daysRemaining <= 0;
  const isLicenseExpired = Boolean(
    license?.expires_at && new Date(license.expires_at).getTime() <= Date.now()
  );
  const isBlocked = Boolean(
    (sub && (sub.status === 'EXPIRED' || sub.status === 'SUSPENDED' || isExpiredByDate)) ||
    (license && (license.status === 'EXPIRED' || license.status === 'BLOCKED' || isLicenseExpired))
  );

  if (isBlocked) {
    const waMessage73 = buildSupportWhatsAppUrl('5573998419901', undefined, effectiveCondoId || undefined);
    const waMessage21 = buildSupportWhatsAppUrl('5521971966473', undefined, effectiveCondoId || undefined);

    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 select-none">
        <div className="max-w-lg w-full bg-slate-900/95 border border-rose-500/40 rounded-3xl p-6 md:p-8 shadow-2xl space-y-6 text-center backdrop-blur-xl relative overflow-hidden">
          
          <div className="w-16 h-16 bg-gradient-to-br from-rose-500/20 to-red-500/10 border border-rose-500/40 rounded-3xl flex items-center justify-center mx-auto text-rose-400 shadow-lg shadow-rose-950/50">
            <Lock className="w-8 h-8 animate-pulse" />
          </div>

          <div className="space-y-2.5">
            <span className="inline-block px-3 py-1 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[11px] font-bold uppercase tracking-wider">
              Tempo Esgotado • Conta Bloqueada
            </span>
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              Efetue o Pagamento ou Contate o Suporte
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-md mx-auto">
              O tempo do seu plano no <strong>CondoBox</strong> encerrou. Para continuar registrando encomendas, enviando avisos aos moradores e acessando a portaria, <strong>efetue o pagamento</strong> ou <strong>entre em contato com o suporte para desbloqueio da conta</strong>.
            </p>
          </div>

          {/* NÚMEROS DO SUPORTE PARA DESBLOQUEIO */}
          <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl space-y-3 text-left">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
              Contatos de Suporte para Desbloqueio:
            </span>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Contato 1: 73 99841-9901 */}
              <a
                href={waMessage73}
                target="_blank"
                rel="noopener noreferrer"
                className="p-3 bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-500/40 hover:border-emerald-500/60 rounded-xl flex items-center gap-3 transition group active:scale-[0.98]"
              >
                <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg group-hover:scale-110 transition shrink-0">
                  <PhoneCall className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] text-emerald-400 font-bold block uppercase tracking-wider">Suporte 1 (WhatsApp)</span>
                  <span className="text-xs font-black text-white font-mono">(73) 99841-9901</span>
                </div>
              </a>

              {/* Contato 2: 21 97196-6473 */}
              <a
                href={waMessage21}
                target="_blank"
                rel="noopener noreferrer"
                className="p-3 bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-500/40 hover:border-emerald-500/60 rounded-xl flex items-center gap-3 transition group active:scale-[0.98]"
              >
                <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg group-hover:scale-110 transition shrink-0">
                  <PhoneCall className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] text-emerald-400 font-bold block uppercase tracking-wider">Suporte 2 (WhatsApp)</span>
                  <span className="text-xs font-black text-white font-mono">(21) 97196-6473</span>
                </div>
              </a>
            </div>
          </div>

          {/* FORMULÁRIO DE CHAVE DE ATIVAÇÃO */}
          <form onSubmit={handleActivateKey} className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl space-y-3 text-left">
            <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-purple-400" />
              <span>Recebeu uma Chave de Desbloqueio do Suporte?</span>
            </label>
            <input
              type="text"
              required
              placeholder="Cole sua Chave CND-..."
              value={licenseKeyInput}
              onChange={e => setLicenseKeyInput(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white font-mono text-xs focus:border-purple-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={activating}
              className="w-full py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-purple-950/40 active:scale-[0.98] disabled:opacity-50"
            >
              {activating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              <span>Ativar e Desbloquear Imediatamente</span>
            </button>
          </form>

          {activationMsg && (
            <div className={`p-3 rounded-xl text-xs font-semibold ${
              activationMsg.type === 'success'
                ? 'bg-emerald-950/40 border border-emerald-500/40 text-emerald-400'
                : 'bg-red-950/40 border border-red-500/40 text-red-400'
            }`}>
              {activationMsg.text}
            </div>
          )}

          {effectiveCondoId && (
            <p className="text-[10px] text-slate-500 font-mono">
              Código da Conta: {effectiveCondoId}
            </p>
          )}

        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* BARRA INFORMATIVA DE STATUS DO PLANO E COTAS */}
      {sub && (
        <div className="bg-slate-900/90 border-b border-slate-800 px-4 py-1.5 flex items-center justify-between text-[11px] text-slate-400">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="flex items-center gap-1.5 text-slate-300 font-semibold">
              <Building2 className="w-3.5 h-3.5 text-indigo-400" />
              <span>
                {sub.status === 'TRIAL' || sub.plan_id === 'TRIAL'
                  ? 'Teste Grátis'
                  : (sub.plan?.name || sub.plan_id)}
              </span>
            </span>

            {/* Contador Dinâmico de Dias Restantes */}
            {daysRemaining !== null && (
              daysRemaining <= 0 ? (
                <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[10px] font-bold animate-pulse">
                  <AlertTriangle className="w-3 h-3 text-rose-400" />
                  <span>Período Expirado</span>
                </span>
              ) : daysRemaining === 1 ? (
                <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-500/25 text-rose-200 border border-rose-500/50 text-[10px] font-bold animate-pulse shadow-sm">
                  <Clock className="w-3 h-3 text-rose-400" />
                  <span>Último dia restante!</span>
                </span>
              ) : daysRemaining <= 5 ? (
                <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold animate-pulse shadow-sm">
                  <Clock className="w-3 h-3 text-amber-400" />
                  <span>Restam {daysRemaining} dias</span>
                </span>
              ) : (
                <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold shadow-sm">
                  <Clock className="w-3 h-3 text-emerald-400" />
                  <span>{daysRemaining} dias restantes</span>
                </span>
              )
            )}

            {sub.plan?.has_ads && (
              <span className="px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20 text-[10px]">
                Com Anúncios na Portaria
              </span>
            )}
          </div>

          {unitsUsage && (
            <div className="flex items-center gap-2">
              <span>
                Aptos: <strong className="text-white">{unitsUsage.current}</strong> / {unitsUsage.max}
              </span>
              <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full ${unitsUsage.percentage > 90 ? 'bg-red-500' : 'bg-indigo-500'}`}
                  style={{ width: `${unitsUsage.percentage}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {children}
    </div>
  );
}

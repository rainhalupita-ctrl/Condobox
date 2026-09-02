'use client';

import React, { useState, useEffect } from 'react';
import { createClient } from '../lib/supabase/client';
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
  Building2
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
  const [sub, setSub] = useState<SubscriptionData | null>(null);
  const [unitsUsage, setUnitsUsage] = useState<{ current: number; max: number; canAddMore: boolean; percentage: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [licenseKeyInput, setLicenseKeyInput] = useState('');
  const [activating, setActivating] = useState(false);
  const [activationMsg, setActivationMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    checkLicense();
  }, []);

  const checkLicense = async () => {
    setLoading(true);
    try {
      let realUnitsCount = 0;
      try {
        const supabase = createClient();
        const { data: unitsData } = await supabase.from('units').select('block, unit_number');
        if (unitsData) {
          const uniqueMap = new Map<string, boolean>();
          unitsData.forEach((u: any) => {
            const key = `${(u.block || 'Bloco A').trim().toUpperCase()}__${(u.unit_number || '').trim()}`;
            uniqueMap.set(key, true);
          });
          realUnitsCount = uniqueMap.size;
        }
      } catch {}

      const res = await fetch('http://localhost:3001/api/license/status').catch(() => null);
      if (res && res.ok) {
        const data = await res.json();
        if (data.subscription) {
          const currentCount = Math.max(data.unitsUsage?.current || 0, realUnitsCount);
          const maxUnits = data.unitsUsage?.max || data.subscription.plan?.max_units || 250;
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

      // Fallback padrão se API local não responder: Trial Ativo
      const fallbackDate = new Date(Date.now() + 25 * 86400000).toISOString();
      const maxUnits = 250;
      const currentCount = realUnitsCount;
      setSub({
        plan_id: 'TRIAL',
        status: 'TRIAL',
        current_period_ends_at: fallbackDate,
        plan: {
          name: 'Teste Grátis 30 Dias',
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

  // Se a assinatura estiver expirada ou suspensa, exibe a tela de bloqueio
  const isBlocked = sub && (sub.status === 'EXPIRED' || sub.status === 'SUSPENDED');

  if (isBlocked) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900 border border-red-500/30 rounded-3xl p-6 md:p-8 shadow-2xl space-y-6 text-center">
          
          <div className="w-16 h-16 bg-red-500/10 border border-red-500/30 rounded-3xl flex items-center justify-center mx-auto text-red-400">
            <Lock className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-bold text-white">Assinatura Expirada</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              O período de uso ou teste do <strong>CondoBox Portaria</strong> expirou. Para continuar registrando encomendas e enviando notificações no WhatsApp, renove sua assinatura.
            </p>
          </div>

          {/* FORMULÁRIO DE CHAVE DE ATIVAÇÃO */}
          <form onSubmit={handleActivateKey} className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl space-y-3 text-left">
            <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-purple-400" />
              <span>Possui uma Chave de Ativação?</span>
            </label>
            <input
              type="text"
              required
              placeholder="Cole sua Chave CND-..."
              value={licenseKeyInput}
              onChange={e => setLicenseKeyInput(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono text-xs focus:border-purple-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={activating}
              className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2"
            >
              {activating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              <span>Ativar Licença Imediatamente</span>
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

          {/* CONTATO DE SUPORTE / RENOVAÇÃO */}
          <div className="pt-2 border-t border-slate-800 space-y-2">
            <span className="text-[10px] text-slate-500 uppercase font-bold block">Falar com o Administrador:</span>
            <a
              href="https://wa.me/5511999999999?text=Ol%C3%A1%2C+preciso+renovar+a+assinatura+do+CondoBox+Portaria"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition"
            >
              <PhoneCall className="w-4 h-4" />
              <span>Falar no WhatsApp para Renovar</span>
            </a>
          </div>

        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* BARRA INFORMATIVA DE STATUS DO PLANO E COTAS */}
      {sub && (
        <div className="bg-slate-900/90 border-b border-slate-800 px-4 py-1.5 flex items-center justify-between text-[11px] text-slate-400">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-slate-300 font-semibold">
              <Building2 className="w-3.5 h-3.5 text-indigo-400" />
              <span>{sub.plan?.name || sub.plan_id}</span>
            </span>

            {sub.status === 'TRIAL' && (
              <span className="px-2 py-0.2 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] font-bold">
                Trial 30 Dias
              </span>
            )}

            {sub.plan?.has_ads && (
              <span className="px-2 py-0.2 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20 text-[10px]">
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

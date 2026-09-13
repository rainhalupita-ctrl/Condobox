'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { Package as PackageType } from '../../types/database';
import { PackageCard } from '../../components/package-card';
import { SignaturePad } from '../../components/signature-pad';
import { SubscriptionGate } from '../../components/SubscriptionGate';
import { VoiceService } from '../../lib/voice';
import { LocalApiClient } from '../../lib/local-api';
import { createClient } from '../../lib/supabase/client';
import { useAuth } from '../../contexts/auth-context';
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
  Loader2,
  Phone,
  PhoneCall,
  Copy,
  AlertTriangle,
  ExternalLink,
  ChevronDown,
  UserCheck
} from 'lucide-react';

export default function PortariaDashboardPage() {
  const { effectiveCondoId, loading: authLoading } = useAuth();
  const alertChannelRef = useRef<any>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [packages, setPackages] = useState<PackageType[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'DELIVERED' | 'STALE' | 'CONTESTED'>('PENDING');
  const [selectedForDelivery, setSelectedForDelivery] = useState<PackageType | null>(null);
  const [deliveredToName, setDeliveredToName] = useState('');
  const [isSubmittingDelivery, setIsSubmittingDelivery] = useState(false);
  const [isNotifyingPending, setIsNotifyingPending] = useState(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Previne que o Safari/Chrome no celular restaure foco ou abra o teclado virtual automaticamente ao carregar/atualizar a página
  useEffect(() => {
    const dismissAutoFocus = () => {
      if (searchInputRef.current && document.activeElement === searchInputRef.current) {
        searchInputRef.current.blur();
      }
      if (
        document.activeElement instanceof HTMLElement &&
        (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')
      ) {
        document.activeElement.blur();
      }
    };

    dismissAutoFocus();
    const t1 = setTimeout(dismissAutoFocus, 50);
    const t2 = setTimeout(dismissAutoFocus, 150);
    const t3 = setTimeout(dismissAutoFocus, 300);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  // Pop-up interativo para avisar o porteiro de outras encomendas pendentes para o mesmo morador
  const [additionalPendingPrompt, setAdditionalPendingPrompt] = useState<{
    residentName: string;
    phone: string;
    condoId?: string;
    unitInfo: string;
    pendingPackages: PackageType[];
    deliveredCarrier: string;
  } | null>(null);

  // Modal de Alerta de Emergência para Encomendas Contestadas no WhatsApp
  const [contestedAlertModal, setContestedAlertModal] = useState<{
    packageId?: string;
    carrier: string;
    pickupCode: string;
    residentName: string;
    unitInfo: string;
    phone: string;
    reason: string;
    isWithdrawalContest: boolean;
    timestamp: string;
  } | null>(null);

  // Configuração do alerta de encomendas paradas (padrão: 5 dias)
  const [staleDaysThreshold, setStaleDaysThreshold] = useState<number>(5);
  const [showDirectContactModal, setShowDirectContactModal] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null);
  const [notifyingMap, setNotifyingMap] = useState<{ [pkgId: string]: boolean }>({});
  const [promptCodeInput, setPromptCodeInput] = useState('');
  const [promptCodeError, setPromptCodeError] = useState<string | null>(null);

  const getCleanNotes = (notes?: string | null) => {
    if (!notes) return null;
    const clean = notes
      .split(';')
      .filter((n) => !n.startsWith('CIENTE:') && !n.startsWith('DELIVERY_NOTIFIED:') && !n.startsWith('Ciência confirmada'))
      .join(' ')
      .trim();
    return clean || null;
  };

  // 1. Carrega do localStorage imediato para não piscar a interface
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('condobox_stale_days_threshold');
      if (saved) {
        const val = parseInt(saved, 10);
        if (!isNaN(val) && val > 0) setStaleDaysThreshold(val);
      }
    }
  }, []);

  // 2. Função robusta para sincronizar a tolerância de alertas com a nuvem (com no-cache garantido)
  const syncSettingsFromCloud = useCallback(async (condoId?: string) => {
    const targetCondoId = condoId || effectiveCondoId;
    if (!targetCondoId) return;

    try {
      const res = await fetch(`/api/condos/settings?condo_id=${targetCondoId}&_t=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
        },
      });
      const data = await res.json();
      if (data?.success && typeof data.stale_days_threshold === 'number' && data.stale_days_threshold > 0) {
        setStaleDaysThreshold(data.stale_days_threshold);
        if (typeof window !== 'undefined') {
          localStorage.setItem('condobox_stale_days_threshold', data.stale_days_threshold.toString());
        }
      }
    } catch (err) {
      console.warn('[Portaria] Falha ao sincronizar tolerância do condomínio:', err);
    }
  }, [effectiveCondoId]);

  // Busca a configuração ao iniciar ou alterar o condomínio ativo
  useEffect(() => {
    if (effectiveCondoId) {
      syncSettingsFromCloud(effectiveCondoId);
    }
  }, [effectiveCondoId, syncSettingsFromCloud]);

  // Revalida automaticamente ao focar na janela ou voltar de outro app no celular
  useEffect(() => {
    const handleRecheck = () => {
      if (document.visibilityState === 'visible' && effectiveCondoId) {
        syncSettingsFromCloud(effectiveCondoId);
      }
    };

    window.addEventListener('focus', handleRecheck);
    document.addEventListener('visibilitychange', handleRecheck);

    return () => {
      window.removeEventListener('focus', handleRecheck);
      document.removeEventListener('visibilitychange', handleRecheck);
    };
  }, [effectiveCondoId, syncSettingsFromCloud]);

  const handleUpdateThreshold = async (days: number) => {
    const clean = Math.max(1, Math.min(60, days));
    setStaleDaysThreshold(clean);
    if (typeof window !== 'undefined') {
      localStorage.setItem('condobox_stale_days_threshold', clean.toString());
    }

    if (!effectiveCondoId) return;

    // A. Salva no banco de dados para persistência definitiva em novos logins/reloads
    try {
      await fetch('/api/condos/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
        },
        body: JSON.stringify({
          condo_id: effectiveCondoId,
          stale_days_threshold: clean,
        }),
      });
    } catch (postErr) {
      console.warn('[Portaria] Falha ao persistir tolerância na nuvem:', postErr);
    }

    // B. Dispara broadcast em tempo real para sincronizar os demais aparelhos (PC, celular) na mesma hora
    try {
      if (alertChannelRef.current) {
        await alertChannelRef.current.send({
          type: 'broadcast',
          event: 'stale-days-threshold-updated',
          payload: { threshold: clean, condoId: effectiveCondoId },
        });
      } else {
        const supabase = createClient();
        const ch = supabase.channel(`condo-alerts-${effectiveCondoId}`);
        ch.subscribe((status: string) => {
          if (status === 'SUBSCRIBED') {
            ch.send({
              type: 'broadcast',
              event: 'stale-days-threshold-updated',
              payload: { threshold: clean, condoId: effectiveCondoId },
            }).finally(() => {
              setTimeout(() => supabase.removeChannel(ch), 2000);
            });
          }
        });
      }
    } catch (bcErr) {
      console.warn('[Portaria] Falha ao emitir broadcast de tolerância:', bcErr);
    }
  };

  const loadPackages = async () => {
    if (authLoading) return;
    if (!effectiveCondoId) {
      setPackages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = createClient();
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        window.location.href = '/portaria/login?redirect=/portaria';
        return;
      }

      const { data, error } = await supabase
        .from('packages')
        .select('*, unit:units(*, residents(*)), resident:residents(*)')
        .eq('condo_id', effectiveCondoId)
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
      // Sempre re-sincroniza a tolerância para alertar em conjunto com as encomendas
      if (effectiveCondoId) {
        syncSettingsFromCloud(effectiveCondoId);
      }
    }
  };

  useEffect(() => {
    if (!authLoading) {
      loadPackages();
    }
  }, [authLoading, effectiveCondoId]);

  // Escuta alertas de contestação e atualizações em tempo real via Supabase
  useEffect(() => {
    if (authLoading || !effectiveCondoId) return;
    const supabase = createClient();

    const alertChannel = supabase.channel(`condo-alerts-${effectiveCondoId}`);
    alertChannelRef.current = alertChannel;

    alertChannel
      .on('broadcast', { event: 'package-contested' }, (payload: any) => {
        const data = payload?.payload || {};
        const isWithdrawal = Boolean(data.isWithdrawalContest);
        VoiceService.playErrorBeep();
        VoiceService.speak(
          isWithdrawal
            ? 'Alerta urgente: Retirada de encomenda contestada pelo morador no WhatsApp!'
            : 'Atenção: Encomenda contestada pelo morador no WhatsApp!'
        );
        setContestedAlertModal({
          packageId: data.packageId,
          carrier: data.carrier || 'Encomenda',
          pickupCode: data.pickupCode || '---',
          residentName: data.residentName || data.recipientName || 'Morador(a)',
          unitInfo: data.unitInfo || '',
          phone: data.phone || '',
          reason: data.reason || 'O morador informou que não reconhece ou contesta esta encomenda.',
          isWithdrawalContest: isWithdrawal,
          timestamp: data.timestamp || new Date().toISOString()
        });
        loadPackages();
      })
      .on('broadcast', { event: 'stale-days-threshold-updated' }, (payload: any) => {
        const newThreshold = payload?.payload?.threshold;
        if (typeof newThreshold === 'number' && newThreshold > 0) {
          setStaleDaysThreshold(newThreshold);
          if (typeof window !== 'undefined') {
            localStorage.setItem('condobox_stale_days_threshold', newThreshold.toString());
          }
        }
      })
      .subscribe();

    const dbChangesChannel = supabase
      .channel(`packages-realtime-${effectiveCondoId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'packages', filter: `condo_id=eq.${effectiveCondoId}` },
        () => {
          loadPackages();
        }
      )
      .subscribe();

    return () => {
      alertChannelRef.current = null;
      supabase.removeChannel(alertChannel);
      supabase.removeChannel(dbChangesChannel);
    };
  }, [authLoading, effectiveCondoId]);

  useEffect(() => {

    const onSetFilter = (e: any) => {
      if (e.detail) setStatusFilter(e.detail);
    };
    const onRefresh = () => {
      loadPackages();
      if (effectiveCondoId) syncSettingsFromCloud(effectiveCondoId);
    };
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

      // Guarda os dados antes de limpar o modal atual
      const deliveredPkg = selectedForDelivery;
      const recipientName = deliveredToName || deliveredPkg.resident?.name || deliveredPkg.recipient_name_ocr || 'Morador';
      const phone = deliveredPkg.resident?.phone || (deliveredPkg as any).phone || '';
      const unitInfo = deliveredPkg.unit
        ? `${deliveredPkg.unit.block} - Apto ${deliveredPkg.unit.unit_number}`
        : 'Unidade';

      // Verifica se o morador ainda possui OUTRAS encomendas pendentes no condomínio (estritamente não entregues)
      const otherPending = packages.filter(
        (p) =>
          p.id !== deliveredPkg.id &&
          (p.status === 'RECEIVED' || p.status === 'NOTIFIED') &&
          !p.delivered_at &&
          (deliveredPkg.resident_id
            ? p.resident_id === deliveredPkg.resident_id
            : deliveredPkg.unit_id && p.unit_id === deliveredPkg.unit_id)
      );

      const hasMore = otherPending.length > 0;

      await LocalApiClient.submitSignature({
        packageId: selectedForDelivery.id,
        signatureBase64: signatureDataUrl,
        deliveredToName: deliveredToName || 'Morador/Autorizado',
        deliveredByUserId: user?.id,
        sendWhatsAppConfirmation: true,
        hasMorePending: hasMore
      });

      // Se o morador NÃO possui outras pendentes, garante envio imediato de WhatsApp (sem delay de 75s)
      if (!hasMore && phone) {
        LocalApiClient.flushDeliveryBatch(phone, deliveredPkg.condo_id).catch(() => {});
      }

      // Dispara broadcast em tempo real para o site do morador
      const broadcastChannel = supabase.channel(`public-package-${selectedForDelivery.id}`);
      broadcastChannel.subscribe(async (status: string) => {
        if (status === 'SUBSCRIBED') {
          await broadcastChannel.send({
            type: 'broadcast',
            event: 'status-updated',
            payload: { status: 'DELIVERED', packageId: selectedForDelivery.id }
          }).catch(() => {});
          setTimeout(() => supabase.removeChannel(broadcastChannel), 3000);
        }
      });

      VoiceService.playSuccessBeep();
      VoiceService.speak(`Entrega concluída para ${deliveredToName || 'o morador'}`);

      setSelectedForDelivery(null);
      loadPackages();

      if (hasMore) {
        // Abre o Pop-up Interativo perguntando se deseja entregar o próximo pacote agora
        setAdditionalPendingPrompt({
          residentName: recipientName,
          phone,
          condoId: deliveredPkg.condo_id,
          unitInfo,
          pendingPackages: otherPending,
          deliveredCarrier: deliveredPkg.carrier || 'Encomenda'
        });
      } else {
        setSuccessToast(`Encomenda entregue com sucesso para ${recipientName}!`);
      }
    } catch (err: any) {
      alert(`Erro ao registrar entrega: ${err.message}`);
    } finally {
      setIsSubmittingDelivery(false);
    }
  };

  const handleDeliverNextPackage = (nextPkg: PackageType) => {
    if (!additionalPendingPrompt) return;
    const recipient = additionalPendingPrompt.residentName;
    setAdditionalPendingPrompt(null);
    setSelectedForDelivery(nextPkg);
    setDeliveredToName(recipient);
  };

  const handleFinishWithoutAdditional = async () => {
    if (!additionalPendingPrompt) return;
    const { phone, condoId, residentName } = additionalPendingPrompt;
    setAdditionalPendingPrompt(null);
    setSuccessToast(`Atendimento finalizado! Disparando confirmação única para ${residentName}...`);

    // Força o envio imediato da notificação única via WhatsApp sem aguardar o timer de debounce
    if (phone) {
      await LocalApiClient.flushDeliveryBatch(phone, condoId);
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

  const getPackageAgeDays = (receivedAt: string) => {
    const received = new Date(receivedAt).getTime();
    const diffMs = Math.max(0, Date.now() - received);
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  };

  const stalePackages = packages.filter((pkg) => {
    if (pkg.status === 'DELIVERED') return false;
    return getPackageAgeDays(pkg.received_at) >= staleDaysThreshold;
  });

  const contestedPackages = packages.filter((pkg) => {
    return Boolean(pkg.notes?.includes('CONTESTADO'));
  });

  const staleContactGroups = React.useMemo(() => {
    const groups: { [key: string]: {
      key: string;
      residentName: string;
      unitInfo: string;
      phone: string | null;
      packages: {
        id: string;
        carrier: string;
        pickup_code: string;
        received_at: string;
        ageDays: number;
      }[];
      maxAgeDays: number;
    }} = {};

    for (const pkg of stalePackages) {
      const resident = pkg.resident || (pkg.unit?.residents?.find((r) => r.is_primary) || pkg.unit?.residents?.[0]);
      const residentName = resident?.name || pkg.recipient_name_ocr || 'Morador(a)';
      const unitInfo = pkg.unit ? `${pkg.unit.block} - Apto ${pkg.unit.unit_number}` : 'Unidade';
      const phone = resident?.phone || (pkg as any).phone || null;
      const key = resident?.id ? `res_${resident.id}` : pkg.unit_id ? `unit_${pkg.unit_id}` : `pkg_${pkg.id}`;

      const ageDays = getPackageAgeDays(pkg.received_at);

      if (!groups[key]) {
        groups[key] = {
          key,
          residentName,
          unitInfo,
          phone,
          packages: [],
          maxAgeDays: ageDays,
        };
      }

      groups[key].packages.push({
        id: pkg.id,
        carrier: pkg.carrier,
        pickup_code: pkg.pickup_code,
        received_at: pkg.received_at,
        ageDays,
      });

      if (ageDays > groups[key].maxAgeDays) {
        groups[key].maxAgeDays = ageDays;
      }
    }

    return Object.values(groups).sort((a, b) => b.maxAgeDays - a.maxAgeDays);
  }, [stalePackages, staleDaysThreshold]);

  const filteredStaleGroups = staleContactGroups.filter((g) => {
    if (!contactSearch.trim()) return true;
    const q = contactSearch.toLowerCase();
    const nameMatch = g.residentName.toLowerCase().includes(q);
    const unitMatch = g.unitInfo.toLowerCase().includes(q);
    const codeMatch = g.packages.some(p => p.pickup_code.toLowerCase().includes(q) || p.carrier.toLowerCase().includes(q));
    const phoneMatch = g.phone ? g.phone.includes(q) : false;
    return nameMatch || unitMatch || codeMatch || phoneMatch;
  });

  const getGroupWhatsAppUrl = (group: { residentName: string; unitInfo: string; phone: string | null; packages: { carrier: string; pickup_code: string; ageDays: number }[] }) => {
    if (!group.phone) return null;
    let clean = group.phone.replace(/\D/g, '');
    if (!clean.startsWith('55') && clean.length >= 10) clean = `55${clean}`;

    const itemsText = group.packages
      .map((p, idx) => `📦 *${p.carrier}* (Código: *${p.pickup_code}* - há ${p.ageDays} dia(s))`)
      .join('\n');

    const msg =
      `👋 Olá, *${group.residentName}*! Tudo bem?\n\n` +
      `Aqui é da *Portaria do Condomínio*.\n` +
      `Consta que você possui encomenda(s) aguardando retirada na portaria há mais de *${staleDaysThreshold} dias* (${group.unitInfo}):\n\n` +
      `${itemsText}\n\n` +
      `🏢 Por favor, compareça à portaria com o código para retirar assim que puder.\n` +
      `Se tiver alguma dúvida, pode nos responder por aqui. Obrigado!`;

    return `https://wa.me/${clean}?text=${encodeURIComponent(msg)}`;
  };

  const handleCopyPhone = (phone: string) => {
    if (!phone) return;
    navigator.clipboard.writeText(phone);
    setCopiedPhone(phone);
    setTimeout(() => setCopiedPhone(null), 2500);
  };

  const handleNotifySingle = async (pkgId: string) => {
    setNotifyingMap(prev => ({ ...prev, [pkgId]: true }));
    try {
      const res = await LocalApiClient.notifyPackage(pkgId, true);
      if (res.success) {
        setSuccessToast('✅ Lembrete oficial enviado via WhatsApp com sucesso!');
        loadPackages();
      } else {
        setSuccessToast(`⚠️ ${res.error || 'Falha ao enviar notificação.'}`);
      }
    } catch (err: any) {
      setSuccessToast(`❌ Erro: ${err.message}`);
    } finally {
      setNotifyingMap(prev => ({ ...prev, [pkgId]: false }));
    }
  };

  const filteredPackages = packages.filter(pkg => {
    if (statusFilter === 'PENDING' && pkg.status === 'DELIVERED') return false;
    if (statusFilter === 'DELIVERED' && pkg.status !== 'DELIVERED') return false;
    if (statusFilter === 'CONTESTED') {
      if (!pkg.notes?.includes('CONTESTADO')) return false;
    }
    if (statusFilter === 'STALE') {
      if (pkg.status === 'DELIVERED') return false;
      if (getPackageAgeDays(pkg.received_at) < staleDaysThreshold) return false;
    }

    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const unitMatch = pkg.unit ? `${pkg.unit.block} ${pkg.unit.unit_number}`.toLowerCase().includes(q) : false;
    const nameMatch = (pkg.resident?.name || pkg.recipient_name_ocr || '').toLowerCase().includes(q);
    const codeMatch = pkg.pickup_code.toLowerCase().includes(q);
    const carrierMatch = pkg.carrier.toLowerCase().includes(q);
    const noteMatch = (pkg.notes || '').toLowerCase().includes(q);

    return unitMatch || nameMatch || codeMatch || carrierMatch || noteMatch;
  });

  const pendingCount = packages.filter(p => p.status !== 'DELIVERED').length;
  const unnotifiedCount = packages.filter(p => p.status === 'RECEIVED').length;
  const deliveredTodayCount = packages.filter(p => p.status === 'DELIVERED').length;
  const staleCount = stalePackages.length;
  const contestedCount = contestedPackages.length;

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

        {/* Barra Superior de Configurações da Portaria */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 bg-slate-900/90 border border-slate-800 px-3 py-1.5 rounded-xl text-slate-300 shadow-sm">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[11px] font-semibold text-slate-400">Tolerância para Alerta:</span>
            <select
              value={staleDaysThreshold}
              onChange={(e) => handleUpdateThreshold(parseInt(e.target.value, 10))}
              className="bg-slate-950 text-amber-400 font-bold border border-slate-700 rounded-lg px-2 py-0.5 text-xs focus:outline-none focus:border-amber-500 cursor-pointer"
            >
              <option value="1">A partir de 1 dia</option>
              <option value="2">A partir de 2 dias</option>
              <option value="3">A partir de 3 dias</option>
              <option value="4">A partir de 4 dias</option>
              <option value="5">A partir de 5 dias (Padrão)</option>
              <option value="7">A partir de 7 dias (1 semana)</option>
              <option value="10">A partir de 10 dias</option>
              <option value="15">A partir de 15 dias</option>
              <option value="30">A partir de 30 dias</option>
            </select>
          </div>

          <button
            onClick={() => {
              const current = LocalApiClient.getCurrentImageBaseUrl();
              const url = window.prompt("Configuração para Uso no Celular:\n\nDigite o IP do computador da portaria (Ex: http://192.168.0.10:3001)\n\nIsso fará o celular enviar as mensagens direto pelo seu computador em vez da nuvem.", current);
              if (url !== null) {
                LocalApiClient.setCustomBaseUrl(url);
                alert("Configuração salva no seu aparelho!");
              }
            }}
            className="text-[11px] text-slate-500 hover:text-slate-300 underline ml-auto"
          >
            Configurar IP Local (Celular)
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

        {/* BANNER DE ALERTA DE ENCOMENDAS CONTESTADAS (RESPOSTA DE NÃO CIÊNCIA PELO MORADOR) */}
        {contestedCount > 0 && (
          <div className="p-4 sm:p-5 bg-gradient-to-r from-red-950 via-rose-950 to-slate-900 border-2 border-red-500 rounded-3xl shadow-2xl shadow-red-950/60 relative overflow-hidden animate-fade-in ring-2 ring-red-500/40">
            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 relative z-10">
              <div className="flex items-start gap-3.5">
                <div className="p-3 bg-red-600/30 text-red-400 border border-red-500/50 rounded-2xl shrink-0 mt-0.5 animate-pulse">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-red-600 text-white shadow-sm">
                      Alerta Urgente da Portaria
                    </span>
                    <span className="text-xs text-red-300 font-bold">
                      {contestedCount} {contestedCount === 1 ? 'encomenda contestada' : 'encomendas contestadas'} no WhatsApp
                    </span>
                  </div>
                  <h3 className="text-base sm:text-lg font-black text-white mt-1">
                    Morador contestou a retirada ou não reconhece a encomenda!
                  </h3>
                  <p className="text-xs text-rose-200/90 mt-0.5">
                    Atenção urgente da portaria: Contestação registrada via WhatsApp (de retirada indevida ou pacote não reconhecido). Verifique os detalhes e câmeras.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto justify-start lg:justify-end">
                <button
                  type="button"
                  onClick={() => setStatusFilter('CONTESTED')}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black shadow-lg transition cursor-pointer ${
                    statusFilter === 'CONTESTED'
                      ? 'bg-red-600 text-white border border-red-400 ring-2 ring-red-400/50'
                      : 'bg-red-600/30 hover:bg-red-600/50 text-red-200 border border-red-500/50'
                  }`}
                >
                  <Filter className="w-4 h-4" />
                  <span>Ver Contestadas ({contestedCount})</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* BANNER DE ALERTA DE ENCOMENDAS PARADAS */}
        {stalePackages.length > 0 && (
          <div className="p-4 sm:p-5 bg-gradient-to-r from-rose-950/80 via-amber-950/60 to-slate-900 border-2 border-rose-500/50 rounded-3xl shadow-2xl shadow-rose-950/40 relative overflow-hidden animate-fade-in">
            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 relative z-10">
              <div className="flex items-start gap-3.5">
                <div className="p-3 bg-rose-500/20 text-rose-400 border border-rose-500/40 rounded-2xl shrink-0 mt-0.5 animate-pulse">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-500 text-white shadow-sm">
                      Alerta da Portaria
                    </span>
                    <span className="text-xs text-rose-300 font-bold">
                      {stalePackages.length} {stalePackages.length === 1 ? 'encomenda parada' : 'encomendas paradas'} há mais de {staleDaysThreshold} dias
                    </span>
                  </div>
                  <h3 className="text-base sm:text-lg font-black text-white mt-1">
                    {staleContactGroups.length} {staleContactGroups.length === 1 ? 'morador precisa' : 'moradores precisam'} ser contatados para liberar espaço
                  </h3>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Fale diretamente com os moradores pelo WhatsApp para solicitar a retirada rápida.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto justify-start lg:justify-end">
                {/* Botão de Contato Direto */}
                <button
                  type="button"
                  onClick={() => setShowDirectContactModal(true)}
                  className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white rounded-xl text-xs font-black shadow-lg shadow-emerald-950/60 transition cursor-pointer"
                >
                  <PhoneCall className="w-4 h-4 text-emerald-100" />
                  <span>Contato Direto ({staleContactGroups.length})</span>
                </button>

                {/* Botão para Filtrar na Grade */}
                <button
                  type="button"
                  onClick={() => setStatusFilter('STALE')}
                  className={`flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
                    statusFilter === 'STALE'
                      ? 'bg-rose-500 text-white border-rose-400'
                      : 'bg-slate-900/90 hover:bg-slate-800 text-rose-300 border-rose-500/40'
                  }`}
                >
                  <Filter className="w-3.5 h-3.5" />
                  <span>Ver na Grade</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Barra de Filtros, Busca e Disparo de WhatsApp */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3 sm:p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 shadow-lg">
          <div className="relative w-full md:w-80 lg:w-96">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Buscar por Apto, Morador, Código..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
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

            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs shrink-0 overflow-x-auto max-w-full">
              <button
                onClick={() => setStatusFilter('PENDING')}
                className={`px-2.5 py-1.5 rounded-lg font-semibold transition whitespace-nowrap ${
                  statusFilter === 'PENDING'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Pendentes ({pendingCount})
              </button>
              <button
                onClick={() => setStatusFilter('CONTESTED')}
                className={`px-2.5 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
                  statusFilter === 'CONTESTED'
                    ? 'bg-red-600 text-white border border-red-400 shadow-md'
                    : contestedCount > 0
                    ? 'text-red-400 hover:text-red-300 bg-red-950/60 border border-red-800/80 animate-pulse'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Exibe encomendas contestadas por moradores no WhatsApp"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                <span>Contestadas</span>
                {contestedCount > 0 && (
                  <span className="px-1.5 py-0.2 bg-red-600 text-white font-black rounded-full text-[10px]">
                    {contestedCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => setStatusFilter('STALE')}
                className={`px-2.5 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
                  statusFilter === 'STALE'
                    ? 'bg-rose-500/30 text-rose-300 border border-rose-500/50 shadow-sm'
                    : staleCount > 0
                    ? 'text-rose-400 hover:text-rose-300 bg-rose-950/40 border border-rose-800/40 animate-pulse'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title={`Exibe apenas encomendas paradas há mais de ${staleDaysThreshold} dias`}
              >
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                <span>Paradas (+{staleDaysThreshold}d)</span>
                {staleCount > 0 && (
                  <span className="px-1.5 py-0.2 bg-rose-500 text-white font-black rounded-full text-[10px]">
                    {staleCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => setStatusFilter('DELIVERED')}
                className={`px-2.5 py-1.5 rounded-lg font-semibold transition whitespace-nowrap ${
                  statusFilter === 'DELIVERED'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Entregues ({deliveredTodayCount})
              </button>
              <button
                onClick={() => setStatusFilter('ALL')}
                className={`px-2.5 py-1.5 rounded-lg font-semibold transition whitespace-nowrap ${
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
                staleDaysThreshold={staleDaysThreshold}
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

              {/* Alerta de Outras Encomendas Pendentes para o mesmo Morador/Unidade */}
              {(() => {
                const otherPending = packages.filter(
                  p => p.id !== selectedForDelivery.id &&
                       p.status !== 'DELIVERED' &&
                       ((selectedForDelivery.unit_id && p.unit_id === selectedForDelivery.unit_id) ||
                        (selectedForDelivery.resident_id && p.resident_id === selectedForDelivery.resident_id))
                );
                if (otherPending.length === 0) return null;
                return (
                  <div className="bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs px-3.5 py-2.5 rounded-2xl flex items-center gap-2.5">
                    <span className="text-lg shrink-0">📦</span>
                    <div className="leading-snug">
                      <p className="font-bold text-emerald-200">
                        O morador possui mais {otherPending.length} encomenda(s) pendente(s):
                      </p>
                      <p className="text-[11px] text-emerald-400/90 mt-0.5">
                        {otherPending.map(p => `${p.carrier || 'Encomenda'} (${p.pickup_code})`).join(', ')}.
                        {' '}As notificações de retirada serão <strong>agrupadas em uma única mensagem</strong> no WhatsApp.
                      </p>
                    </div>
                  </div>
                );
              })()}

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

        {/* Pop-up Proativo de Encomendas Adicionais Pendentes */}
        {additionalPendingPrompt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
            <div className="w-full max-w-lg bg-slate-900 border-2 border-amber-500/50 rounded-3xl p-6 sm:p-7 shadow-2xl shadow-black/80 space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-amber-500/20 text-amber-400 border border-amber-500/40 rounded-2xl shrink-0">
                    <PackageCheck className="w-7 h-7" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500 text-slate-950">
                        Atenção Porteiro
                      </span>
                      <span className="text-xs text-amber-400/90 font-bold">
                        {additionalPendingPrompt.pendingPackages.length} encomenda(s) restante(s)
                      </span>
                    </div>
                    <h3 className="text-lg sm:text-xl font-black text-white mt-1">
                      Outra Encomenda Pendente Detectada!
                    </h3>
                    <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                      O morador <strong className="text-white">{additionalPendingPrompt.residentName}</strong> ({additionalPendingPrompt.unitInfo}) acabou de retirar <strong className="text-white">{additionalPendingPrompt.deliveredCarrier}</strong>, mas ainda possui outro(s) pacote(s) aguardando retirada:
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleFinishWithoutAdditional}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition shrink-0 cursor-pointer"
                  title="Finalizar atendimento e enviar confirmação"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Lista dos Pacotes Pendentes Restantes (sem exibir o código secreto do morador) */}
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {additionalPendingPrompt.pendingPackages.map((pkg, idx) => {
                  const cleanNotes = getCleanNotes(pkg.notes);
                  const receivedDate = pkg.received_at
                    ? new Date(pkg.received_at).toLocaleDateString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                      })
                    : null;

                  return (
                    <div
                      key={pkg.id}
                      className="flex items-center justify-between p-3 bg-slate-950/80 border border-slate-800 rounded-2xl text-xs hover:border-amber-500/40 transition"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-300 font-bold flex items-center justify-center text-[11px] shrink-0">
                          {idx + 1}
                        </span>
                        <div className="min-w-0">
                          <span className="font-bold text-slate-100 block truncate">{pkg.carrier}</span>
                          {receivedDate && (
                            <span className="text-[10px] text-slate-400 block">Recebida em: {receivedDate}</span>
                          )}
                          {cleanNotes && (
                            <span className="text-[10px] text-amber-400/90 block truncate">{cleanNotes}</span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-[11px] font-semibold text-amber-400 bg-amber-950/60 border border-amber-800/60 px-2.5 py-1 rounded-lg">
                          Aguardando Validação
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Área para Inserir Código ou Bipar QR Code */}
              <div className="p-4 bg-slate-950/70 border border-amber-500/30 rounded-2xl space-y-3">
                <p className="text-xs font-bold text-amber-200 text-center">
                  Para fazer a retirada, bipe o QR Code ou insira o código do morador:
                </p>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!additionalPendingPrompt) return;
                    const clean = promptCodeInput.trim().toUpperCase();
                    if (!clean) return;
                    setPromptCodeError(null);

                    const matched = additionalPendingPrompt.pendingPackages.find(
                      (p) => p.pickup_code?.toUpperCase() === clean || p.qr_token?.toUpperCase() === clean
                    );

                    if (matched) {
                      setPromptCodeInput('');
                      setPromptCodeError(null);
                      handleDeliverNextPackage(matched);
                      return;
                    }

                    setPromptCodeError(`Código "${clean}" não confere com as encomendas pendentes deste morador.`);
                  }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    value={promptCodeInput}
                    onChange={(e) => {
                      setPromptCodeInput(e.target.value.toUpperCase());
                      setPromptCodeError(null);
                    }}
                    placeholder="Digite o código (ex: 7E50DB)..."
                    maxLength={10}
                    className="flex-1 px-4 py-2.5 bg-slate-900 border border-slate-700 focus:border-amber-400 rounded-xl text-amber-300 font-mono font-bold text-center uppercase tracking-widest text-sm outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!promptCodeInput.trim()}
                    className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-black text-xs rounded-xl transition flex items-center gap-1.5 shadow-md shadow-amber-950/50 cursor-pointer active:scale-95"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Validar
                  </button>
                </form>

                {promptCodeError && (
                  <p className="text-xs text-rose-400 font-semibold flex items-center justify-center gap-1.5 animate-fade-in">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {promptCodeError}
                  </p>
                )}

                <Link
                  href="/portaria/retirada"
                  className="w-full py-2.5 px-4 bg-sky-600/20 hover:bg-sky-600/30 border border-sky-500/40 text-sky-300 font-bold text-xs rounded-xl transition flex items-center justify-center gap-2 shadow-sm active:scale-98"
                >
                  <QrCode className="w-4 h-4 text-sky-400" />
                  <span>Bipar QR Code na Tela de Retirada</span>
                </Link>
              </div>

              {/* Botões de Ação do Porteiro */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setPromptCodeInput('');
                    setPromptCodeError(null);
                    handleFinishWithoutAdditional();
                  }}
                  className="w-full py-3 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs sm:text-sm rounded-xl border border-slate-700 transition active:scale-[0.98] cursor-pointer"
                >
                  Finalizar Atendimento (Entregar apenas este)
                </button>
              </div>

              <p className="text-[10px] text-center text-slate-500">
                💡 Ao finalizar, o morador receberá a notificação de confirmação da retirada feita.
              </p>
            </div>
          </div>
        )}

        {/* Modal de Contato Direto com Moradores (Encomendas Paradas) */}
        {showDirectContactModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-fade-in">
            <div className="w-full max-w-3xl max-h-[90vh] bg-slate-900 border-2 border-slate-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
              {/* Header do Modal */}
              <div className="p-5 sm:p-6 border-b border-slate-800 bg-slate-950/80 flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-rose-500/20 text-rose-400 border border-rose-500/40 rounded-2xl">
                    <PhoneCall className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-500 text-white">
                        Contato Direto
                      </span>
                      <span className="text-xs text-rose-300 font-semibold">
                        {stalePackages.length} encomenda(s) paradas há mais de {staleDaysThreshold} dias
                      </span>
                    </div>
                    <h3 className="text-lg sm:text-xl font-black text-white mt-1">
                      Moradores com Encomendas Acumuladas
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Fale diretamente com os moradores pelo WhatsApp para solicitar a retirada ou dispare um lembrete oficial.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowDirectContactModal(false)}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition shrink-0 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Barra de Busca dentro do Modal */}
              <div className="p-4 bg-slate-950/40 border-b border-slate-800 flex items-center gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Filtrar por morador, apto, bloco ou código..."
                    value={contactSearch}
                    onChange={(e) => setContactSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div className="text-xs text-slate-400 shrink-0 font-medium">
                  {filteredStaleGroups.length} {filteredStaleGroups.length === 1 ? 'morador' : 'moradores'}
                </div>
              </div>

              {/* Lista de Moradores com Encomendas Paradas */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
                {filteredStaleGroups.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 flex flex-col items-center gap-2">
                    <CheckCircle className="w-10 h-10 text-emerald-400" />
                    <p className="text-sm font-bold text-slate-300">Nenhum morador encontrado com os filtros atuais.</p>
                  </div>
                ) : (
                  filteredStaleGroups.map((group) => {
                    const waUrl = getGroupWhatsAppUrl(group);
                    return (
                      <div
                        key={group.key}
                        className="bg-slate-950/70 border border-slate-800/90 rounded-2xl p-4 sm:p-5 hover:border-slate-700 transition flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
                      >
                        <div className="space-y-2 flex-1 min-w-0">
                          <div className="flex items-center gap-2.5 flex-wrap">
                            <h4 className="text-base font-bold text-white">
                              {group.residentName}
                            </h4>
                            <span className="px-2.5 py-0.5 rounded-lg text-xs font-bold bg-slate-800 text-emerald-300 border border-slate-700">
                              {group.unitInfo}
                            </span>
                            <span className="px-2.5 py-0.5 rounded-lg text-xs font-black bg-rose-500/20 text-rose-300 border border-rose-500/30">
                              Até {group.maxAgeDays} dias parado
                            </span>
                          </div>

                          {/* Telefone */}
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-slate-400">Telefone:</span>
                            {group.phone ? (
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-slate-200 font-semibold">{group.phone}</span>
                                <button
                                  type="button"
                                  onClick={() => handleCopyPhone(group.phone!)}
                                  className="p-1 hover:text-emerald-400 text-slate-400 transition cursor-pointer"
                                  title="Copiar telefone"
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                </button>
                                {copiedPhone === group.phone && (
                                  <span className="text-[10px] text-emerald-400 font-bold">Copiado!</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-amber-400/80 italic">Telefone não cadastrado</span>
                            )}
                          </div>

                          {/* Lista das Encomendas */}
                          <div className="flex flex-wrap gap-2 pt-1">
                            {group.packages.map((pkgItem) => (
                              <div
                                key={pkgItem.id}
                                className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-slate-900 border border-slate-800 text-xs"
                              >
                                <span className="font-semibold text-slate-200">{pkgItem.carrier}</span>
                                <span className="font-mono text-emerald-400 font-bold bg-slate-950 px-1.5 py-0.5 rounded border border-emerald-500/20">
                                  {pkgItem.pickup_code}
                                </span>
                                <span className="text-[11px] text-rose-400 font-medium">
                                  ({pkgItem.ageDays}d)
                                </span>
                                <button
                                  type="button"
                                  disabled={notifyingMap[pkgItem.id]}
                                  onClick={() => handleNotifySingle(pkgItem.id)}
                                  title="Disparar notificação oficial de WhatsApp com QR code"
                                  className="ml-1 text-slate-400 hover:text-emerald-400 disabled:opacity-50 transition cursor-pointer"
                                >
                                  {notifyingMap[pkgItem.id] ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Send className="w-3 h-3" />
                                  )}
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Botões de Ação do Morador */}
                        <div className="flex items-center gap-2 w-full md:w-auto shrink-0 justify-end">
                          {waUrl ? (
                            <a
                              href={waUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-1 md:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 bg-[#25D366] hover:bg-[#20bd5a] text-slate-950 font-black rounded-xl text-xs shadow-lg shadow-emerald-950/40 transition active:scale-95 cursor-pointer"
                            >
                              <MessageSquare className="w-4 h-4" />
                              <span>Chamar no WhatsApp</span>
                            </a>
                          ) : (
                            <button
                              disabled
                              className="flex-1 md:flex-initial px-4 py-2.5 bg-slate-800 text-slate-500 font-bold rounded-xl text-xs cursor-not-allowed"
                            >
                              Sem WhatsApp
                            </button>
                          )}

                          {group.phone && (
                            <a
                              href={`tel:${group.phone.replace(/\D/g, '')}`}
                              className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition cursor-pointer"
                              title="Ligar para o morador"
                            >
                              <Phone className="w-4 h-4" />
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Rodapé do Modal */}
              <div className="p-4 bg-slate-950 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
                <span>
                  💡 <strong>Dica da Portaria:</strong> Mensagens diretas personalizadas no WhatsApp costumam resolver a retirada no mesmo dia!
                </span>
                <button
                  type="button"
                  onClick={() => setShowDirectContactModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-bold transition cursor-pointer"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* POP-UP MODAL DE EMERGÊNCIA: ENCOMENDA OU RETIRADA CONTESTADA */}
        {contestedAlertModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
            <div className="relative w-full max-w-lg bg-slate-900 border-2 border-red-500 rounded-3xl shadow-2xl shadow-red-950/80 overflow-hidden ring-4 ring-red-500/30 animate-scale-in">
              {/* Top Banner Vermelho Vibrante com Sirene */}
              <div className="bg-gradient-to-r from-red-600 via-rose-600 to-red-700 p-4 sm:p-5 text-white flex items-start justify-between gap-3">
                <div className="flex items-center gap-3.5">
                  <div className="p-2.5 bg-white/20 rounded-2xl backdrop-blur-md border border-white/30 animate-bounce">
                    <AlertTriangle className="w-7 h-7 text-white" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-black/40 text-red-200 border border-white/20">
                        Alerta Máximo da Portaria
                      </span>
                    </div>
                    <h3 className="text-lg sm:text-xl font-black tracking-tight mt-1">
                      {contestedAlertModal.isWithdrawalContest
                        ? '🚨 RETIRADA CONTESTADA PELO MORADOR!'
                        : '⚠️ ENCOMENDA CONTESTADA PELO MORADOR!'}
                    </h3>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setContestedAlertModal(null)}
                  className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
                  title="Fechar"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Corpo do Modal */}
              <div className="p-5 sm:p-6 space-y-4">
                <div className="p-3 bg-red-950/50 border border-red-500/40 rounded-2xl text-xs text-red-200">
                  <p className="font-semibold leading-relaxed">
                    {contestedAlertModal.isWithdrawalContest
                      ? 'O morador declarou no WhatsApp que NÃO realizou a retirada desta encomenda. A equipe da portaria deve averiguar imediatamente a assinatura digital e câmeras de segurança.'
                      : 'O morador informou no WhatsApp que não reconhece este pacote ou que a encomenda não pertence à sua unidade.'}
                  </p>
                </div>

                {/* Tabela de Dados da Encomenda */}
                <div className="space-y-2.5 bg-slate-950/70 p-4 rounded-2xl border border-slate-800 text-xs">
                  <div className="flex justify-between items-center py-1 border-b border-slate-800/60">
                    <span className="text-slate-400 font-medium">Morador / Destinatário:</span>
                    <span className="font-bold text-white text-sm">{contestedAlertModal.residentName}</span>
                  </div>
                  {contestedAlertModal.unitInfo && (
                    <div className="flex justify-between items-center py-1 border-b border-slate-800/60">
                      <span className="text-slate-400 font-medium">Unidade:</span>
                      <span className="font-bold text-emerald-400 text-sm">{contestedAlertModal.unitInfo}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center py-1 border-b border-slate-800/60">
                    <span className="text-slate-400 font-medium">Transportadora:</span>
                    <span className="font-bold text-slate-200 text-sm">{contestedAlertModal.carrier}</span>
                  </div>
                  <div className="flex justify-between items-center py-1 border-b border-slate-800/60">
                    <span className="text-slate-400 font-medium">Código de Retirada:</span>
                    <span className="font-black font-mono text-emerald-400 text-sm bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/50">
                      {contestedAlertModal.pickupCode}
                    </span>
                  </div>
                  <div>
                    <span className="text-red-400 font-bold block mb-1">Mensagem enviada pelo morador:</span>
                    <div className="p-3 bg-slate-900 border border-red-500/30 rounded-xl text-slate-200 italic font-medium leading-relaxed break-words">
                      "{contestedAlertModal.reason}"
                    </div>
                  </div>
                </div>

                {/* Botões de Ação */}
                <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
                  {contestedAlertModal.phone && (
                    <a
                      href={`https://wa.me/${contestedAlertModal.phone.replace(/\D/g, '')}?text=${encodeURIComponent(
                        `Olá ${contestedAlertModal.residentName}, aqui é da Portaria do Condomínio. Recebemos sua contestação sobre a encomenda da ${contestedAlertModal.carrier} (Código: ${contestedAlertModal.pickupCode}). Estamos verificando os registros e câmeras com urgência.`
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full sm:flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold text-xs shadow-lg shadow-emerald-950/50 transition cursor-pointer"
                    >
                      <MessageSquare className="w-4 h-4" />
                      <span>Falar no WhatsApp</span>
                    </a>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setStatusFilter('CONTESTED');
                      setContestedAlertModal(null);
                    }}
                    className="w-full sm:flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-red-600 hover:bg-red-500 active:scale-95 text-white font-bold text-xs shadow-lg shadow-red-950/50 transition cursor-pointer"
                  >
                    <Filter className="w-4 h-4" />
                    <span>Ver em Contestadas</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setContestedAlertModal(null)}
                    className="w-full sm:w-auto py-3 px-5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition cursor-pointer"
                  >
                    Estou Ciente
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </SubscriptionGate>
  );
}

'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { LocalApiClient } from '../../../lib/local-api';
import { createClient } from '../../../lib/supabase/client';
import {
  Package,
  Building2,
  User,
  Truck,
  Clock,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Eye,
  ShieldCheck,
  Sparkles,
  RefreshCw,
  QrCode,
  MessageSquare
} from 'lucide-react';

interface PublicPackageData {
  id: string;
  pickup_code: string;
  qr_token: string;
  carrier: string;
  tracking_code?: string | null;
  recipient_name: string;
  status: 'RECEIVED' | 'NOTIFIED' | 'DELIVERED' | 'RETURNED';
  received_at: string;
  delivered_at?: string | null;
  delivered_to_name?: string | null;
  label_image_path?: string | null;
  signature_image_path?: string | null;
  notes?: string | null;
  unit?: {
    block: string;
    unit_number: string;
  } | null;
  resident?: {
    name?: string;
    phone?: string;
  } | null;
  phone?: string | null;
  recipient_name_ocr?: string | null;
  condo_phone?: string | null;
}

export default function PublicPackagePage() {
  const params = useParams();
  const token = params?.token as string;

  const [pkg, setPkg] = useState<PublicPackageData | null>(null);
  const [ad, setAd] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [modalImage, setModalImage] = useState<string | null>(null);
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmedToast, setConfirmedToast] = useState(false);
  const [connectedWhatsappPhone, setConnectedWhatsappPhone] = useState<string | null>(null);

  // Sincronização em tempo real do número ativo do WhatsApp conectado via QR Code na portaria
  useEffect(() => {
    const supabase = createClient();
    const bridgeCh = supabase.channel('whatsapp_bridge', { config: { broadcast: { self: false } } });

    bridgeCh.on('broadcast', { event: 'status_sync' }, ({ payload }: any) => {
      if (payload?.phone) {
        const clean = payload.phone.replace(/\D/g, '');
        if (clean) setConnectedWhatsappPhone(clean);
      }
    });

    bridgeCh.subscribe((status: string) => {
      if (status === 'SUBSCRIBED') {
        bridgeCh.send({ type: 'broadcast', event: 'request_status', payload: {} });
      }
    });

    LocalApiClient.getWhatsAppStatus()
      .then((st) => {
        if (st?.phone) {
          const clean = st.phone.replace(/\D/g, '');
          if (clean) setConnectedWhatsappPhone(clean);
        }
      })
      .catch(() => {});

    return () => {
      supabase.removeChannel(bridgeCh);
    };
  }, []);

  useEffect(() => {
    if (token) {
      loadPackage();
    }
  }, [token]);

  // Real-time Push Subscription + Fallback Polling Ultra-Rápido
  useEffect(() => {
    if (!token) return;

    const supabase = createClient();
    const pkgId = pkg?.id;
    const cleanToken = token.trim();

    // Conecta canais Realtime para o pacote (por ID, por Token e canal global)
    const channelNames = new Set<string>();
    if (cleanToken) channelNames.add(`public-package-${cleanToken}`);
    if (pkgId) channelNames.add(`public-package-${pkgId}`);
    if (pkg?.qr_token) channelNames.add(`public-package-${pkg.qr_token}`);
    if (pkg?.pickup_code) channelNames.add(`public-package-${pkg.pickup_code}`);
    channelNames.add('packages-morador-live');

    const channels = Array.from(channelNames).map((chName) => {
      const ch = supabase.channel(chName);
      ch.on('broadcast', { event: 'status-updated' }, (payload: any) => {
        console.log('📡 [Morador] Broadcast recebido no canal ' + chName + ':', payload);
        const data = payload?.payload;
        if (
          !data?.packageId ||
          data.packageId === pkgId ||
          data.packageId === cleanToken ||
          data.qrToken === cleanToken ||
          data.pickupCode === cleanToken ||
          data.qrToken === pkg?.qr_token ||
          data.pickupCode === pkg?.pickup_code
        ) {
          try {
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
              navigator.vibrate([100, 50, 100]);
            }
          } catch {}
          setPkg((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              status: 'DELIVERED',
              delivered_to_name: data?.deliveredTo || prev.delivered_to_name || 'Morador',
              delivered_at: data?.deliveredAt || new Date().toISOString(),
              signature_image_path: data?.signatureUrl || prev.signature_image_path
            };
          });
          loadPackage(true);
        }
      });

      ch.on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'packages' },
        (payload: any) => {
          console.log('📡 [Morador] postgres_changes recebido:', payload);
          const updated = payload.new;
          if (
            updated &&
            (updated.id === pkgId ||
              updated.qr_token === cleanToken ||
              updated.pickup_code === cleanToken ||
              updated.qr_token === pkg?.qr_token ||
              updated.pickup_code === pkg?.pickup_code)
          ) {
            if (updated.status === 'DELIVERED') {
              try {
                if (typeof navigator !== 'undefined' && navigator.vibrate) {
                  navigator.vibrate([100, 50, 100]);
                }
              } catch {}
              setPkg((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  status: 'DELIVERED',
                  delivered_to_name: updated.delivered_to_name || prev.delivered_to_name,
                  delivered_at: updated.delivered_at || new Date().toISOString(),
                  signature_image_path: updated.signature_image_path || prev.signature_image_path
                };
              });
              loadPackage(true);
            }
          }
        }
      );

      ch.subscribe();
      return ch;
    });

    // Fallback de polling rápido (a cada 1.5s com cache-busting)
    const interval = setInterval(() => {
      if (pkg?.status !== 'DELIVERED') {
        const urlToken = encodeURIComponent(cleanToken);
        fetch(`/api/package/${urlToken}?_t=${Date.now()}`, { cache: 'no-store' })
          .then((res) => res.json())
          .then((data) => {
            if (data.package && data.package.status === 'DELIVERED') {
              setPkg((prev) => {
                if (prev?.status !== 'DELIVERED') {
                  try {
                    if (typeof navigator !== 'undefined' && navigator.vibrate) {
                      navigator.vibrate([100, 50, 100]);
                    }
                  } catch {}
                }
                return data.package;
              });
            }
          })
          .catch(() => {});
      }
    }, 1500);

    // Refresh imediato ao focar na janela ou voltar para a aba do navegador
    const handleVisibilityOrFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible' && pkg?.status !== 'DELIVERED') {
        loadPackage(true);
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleVisibilityOrFocus);
      document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    }

    return () => {
      channels.forEach((ch) => supabase.removeChannel(ch));
      clearInterval(interval);
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleVisibilityOrFocus);
        document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      }
    };
  }, [token, pkg?.id, pkg?.qr_token, pkg?.pickup_code, pkg?.status]);

  const loadPackage = async (silent = false, retryCount = 0) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const cleanToken = encodeURIComponent(token.trim());
      const res = await fetch(`/api/package/${cleanToken}?_t=${Date.now()}`, { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.package) {
        setPkg((prev) => {
          if (prev && prev.status !== 'DELIVERED' && data.package.status === 'DELIVERED') {
            try {
              if (typeof navigator !== 'undefined' && navigator.vibrate) {
                navigator.vibrate([100, 50, 100]);
              }
            } catch {}
          }
          return data.package;
        });
        if (data.ad) {
          setAd(data.ad);
        }
        // Verifica se o usuário já desbloqueou este QR code localmente
        if (typeof window !== 'undefined' && localStorage.getItem(`unlocked_${data.package.pickup_code}`) === 'true') {
          setIsUnlocked(true);
        }
      } else {
        if (retryCount < 2) {
          // Se acabou de ser criada na portaria, dá 1.5s para sincronizar na nuvem
          setTimeout(() => loadPackage(silent, retryCount + 1), 1500);
          return;
        }
        if (!silent) setError(data.error || 'Encomenda não encontrada.');
      }
    } catch (err: any) {
      if (retryCount < 2) {
        setTimeout(() => loadPackage(silent, retryCount + 1), 1500);
        return;
      }
      if (!silent) setError('Não foi possível carregar as informações da encomenda.');
    } finally {
      if (!silent && retryCount >= 2) setLoading(false);
      else if (!silent && !error) setLoading(false);
    }
  };

  const handleCopyCode = () => {
    if (pkg?.pickup_code) {
      navigator.clipboard.writeText(pkg.pickup_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleConfirmAndUnlock = () => {
    if (!pkg) return;
    setConfirming(true);

    // 1. Libera imediatamente o QR Code e código na tela e salva no navegador do morador
    setIsUnlocked(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem(`unlocked_${pkg.pickup_code}`, 'true');
    }

    // 2. Monta a mensagem exata com os dados da encomenda
    const rawBlock = pkg.unit?.block || '';
    const blockText = rawBlock
      ? (rawBlock.toLowerCase().startsWith('bloco') ? rawBlock : `Bloco ${rawBlock}`)
      : '';
    const aptoText = pkg.unit?.unit_number ? `Apto ${pkg.unit.unit_number}` : '';
    const unitText = [blockText, aptoText].filter(Boolean).join(' - ') || 'Minha Unidade';
    const residentName = pkg.recipient_name || pkg.resident?.name || 'Morador(a)';
    const carrier = pkg.carrier || 'Encomenda';

    const message =
      `👍 *CONFIRMAÇÃO DE CIÊNCIA REGISTRADA!*\n\n` +
      `Olá, *${residentName}*!\n` +
      `Registramos com sucesso sua confirmação para a encomenda da *${carrier}* (${unitText}).\n\n` +
      `🔑 *Código de Retirada:* *${pkg.pickup_code}*\n\n` +
      `🏢 *Portaria:* Notificação confirmada. Apresente o QR Code no balcão para retirar.`;

    const destPhone = targetWhatsappPhone || '557398419901';

    // 3. Registra a confirmação no backend em segundo plano
    try {
      const cleanToken = encodeURIComponent((pkg.pickup_code || token).trim());
      fetch(`/api/package/${cleanToken}/acknowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: destPhone }),
      }).catch(() => {});
    } catch {}

    // 4. Abre o WhatsApp do morador já com a conversa da portaria e a mensagem pronta
    const whatsappUrl = `https://api.whatsapp.com/send?phone=${destPhone}&text=${encodeURIComponent(message)}`;
    setTimeout(() => {
      window.location.href = whatsappUrl;
      setConfirming(false);
    }, 150);
  };

  const labelUrl = pkg?.label_image_path ? LocalApiClient.getImageUrl(pkg.label_image_path) : null;
  const signatureUrl = pkg?.signature_image_path ? LocalApiClient.getImageUrl(pkg.signature_image_path) : null;

  const formattedDate = pkg?.received_at
    ? new Date(pkg.received_at).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    : '';

  const deliveredDate = pkg?.delivered_at
    ? new Date(pkg.delivered_at).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    : '';

  const isDelivered = pkg?.status === 'DELIVERED';
  const targetWhatsappPhone = (
    connectedWhatsappPhone ||
    (pkg?.condo_phone && pkg.condo_phone !== '5511988887777' ? pkg.condo_phone : null) ||
    ''
  ).replace(/\D/g, '');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-start p-4 sm:p-6 selection:bg-emerald-500 selection:text-slate-950">
      {/* Topo / Marca Oficial */}
      <div className="w-full max-w-md flex items-center justify-between py-4 mb-2">
        <img
          src="/logo.png"
          alt="CondoBox"
          className="h-10 w-auto object-contain drop-shadow-md"
        />
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-900 border border-slate-800 rounded-full text-[11px] text-slate-300 font-medium">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          Portaria 24h
        </div>
      </div>

      {/* Container Principal */}
      <div className="w-full max-w-md">
        {loading ? (
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-12 text-center space-y-4 shadow-2xl backdrop-blur-xl">
            <RefreshCw className="w-10 h-10 text-emerald-400 animate-spin mx-auto" />
            <p className="text-sm font-semibold text-slate-300">Carregando dados da encomenda...</p>
          </div>
        ) : error || !pkg ? (
          <div className="bg-slate-900/90 border border-red-500/30 rounded-3xl p-8 text-center space-y-4 shadow-2xl">
            <div className="w-14 h-14 bg-red-500/20 text-red-400 border border-red-500/30 rounded-2xl flex items-center justify-center mx-auto">
              <AlertCircle className="w-8 h-8" />
            </div>
            <h2 className="text-lg font-bold text-slate-100">Código Não Encontrado</h2>
            <p className="text-xs text-slate-400 max-w-xs mx-auto">
              {error || 'Não foi possível encontrar a encomenda correspondente a este link. Verifique o link recebido no WhatsApp.'}
            </p>
            <button
              onClick={() => loadPackage()}
              className="mt-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition"
            >
              Tentar Novamente
            </button>
          </div>
        ) : (
          <div className="space-y-4 animate-fade-in">
            {/* Status Banner */}
            <div
              className={`p-4 rounded-2xl border flex items-center justify-between gap-3 ${
                isDelivered
                  ? 'bg-blue-950/40 border-blue-800/50 text-blue-300'
                  : 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300'
              }`}
            >
              <div className="flex items-center gap-2.5">
                {isDelivered ? (
                  <CheckCircle2 className="w-5 h-5 text-blue-400 shrink-0" />
                ) : (
                  <Clock className="w-5 h-5 text-emerald-400 animate-pulse shrink-0" />
                )}
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider">
                    {isDelivered ? 'Encomenda Entregue' : 'Disponível na Portaria'}
                  </h3>
                  <p className="text-[11px] opacity-80 mt-0.5">
                    {isDelivered
                      ? `Retirada por ${pkg.delivered_to_name || 'morador'} em ${deliveredDate}`
                      : 'Apresente o QR Code ou código abaixo ao porteiro'}
                  </p>
                </div>
              </div>
            </div>

            {/* TOAST DE CONFIRMAÇÃO AUTOMÁTICA ENVIADA NO WHATSAPP */}
            {confirmedToast && (
              <div className="p-3.5 bg-emerald-500/15 border border-emerald-500/30 rounded-2xl text-emerald-300 text-xs flex items-center justify-center gap-2 animate-fade-in font-medium shadow-lg shadow-emerald-950/40">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Mensagem de confirmação enviada com sucesso no WhatsApp!</span>
              </div>
            )}

            {/* CARD PRINCIPAL DO QR CODE E CÓDIGO */}
            {!isDelivered && (
              <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-2xl backdrop-blur-xl text-center space-y-5 relative overflow-hidden">
                <div className="absolute -top-16 -right-16 w-36 h-36 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none"></div>

              {/* Bloco de Conteúdo (Desfocado se não confirmado) */}
              <div className={`transition-all duration-700 ${!isUnlocked && !isDelivered ? 'blur-md opacity-40 select-none pointer-events-none' : ''}`}>
                {/* QR Code Container */}
                <div className="relative inline-block p-4 bg-white rounded-2xl shadow-xl shadow-slate-950/60 border border-slate-200">
                  <QRCodeSVG
                    value={pkg.qr_token || pkg.pickup_code}
                    size={190}
                    level="H"
                    includeMargin={false}
                    className="mx-auto"
                  />
                </div>

                {/* Código Numérico de 4 Dígitos */}
                <div className="space-y-1.5 mt-5">
                  <span className="text-[11px] uppercase font-bold tracking-widest text-slate-400">
                    Código de Retirada
                  </span>
                  <div className="flex items-center justify-center gap-3">
                    <div className="bg-slate-950 border border-emerald-500/40 px-5 py-2 rounded-2xl shadow-inner inline-flex items-center gap-2">
                      <span className="text-3xl sm:text-4xl font-black font-mono tracking-widest text-emerald-400">
                        {pkg.pickup_code}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={handleCopyCode}
                      title="Copiar Código"
                      className="p-3 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-2xl transition active:scale-95 flex items-center justify-center"
                    >
                      {copied ? <Check className="w-5 h-5 text-emerald-400" /> : <Copy className="w-5 h-5" />}
                    </button>
                  </div>
                  {copied && (
                    <p className="text-[11px] font-semibold text-emerald-400 animate-fade-in">
                      Código copiado para a área de transferência!
                    </p>
                  )}
                </div>

                <p className="text-xs text-slate-400 px-4 leading-relaxed mt-5">
                  💡 O porteiro pode escanear o <strong>QR Code</strong> diretamente da tela do seu celular ou você pode apenas falar o código <strong>{pkg.pickup_code}</strong>.
                </p>
              </div>

              {/* OVERLAY DE BLOQUEIO / BOTÃO DE CONFIRMAÇÃO */}
              {!isUnlocked && !isDelivered && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/40 backdrop-blur-[2px] p-6 animate-fade-in">
                  <div className="w-full">
                    <button
                      type="button"
                      disabled={confirming}
                      onClick={handleConfirmAndUnlock}
                      className="w-full py-4 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl text-sm font-bold flex flex-col items-center justify-center gap-2 shadow-[0_0_40px_rgba(16,185,129,0.4)] transition hover:scale-105 active:scale-95 border border-emerald-400/50 disabled:opacity-85"
                    >
                      <div className="flex items-center gap-2">
                        {confirming ? (
                          <RefreshCw className="w-5 h-5 text-emerald-100 animate-spin" />
                        ) : (
                          <MessageSquare className="w-5 h-5 text-emerald-100" />
                        )}
                        <span>{confirming ? 'Abrindo o WhatsApp...' : 'Confirmar e Liberar QR Code'}</span>
                      </div>
                      <span className="text-[10px] font-normal text-emerald-100/80">
                        Abre o WhatsApp e libera a etiqueta na volta
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>
            )}

            {/* CARD DE PATROCÍNIO / PROPAGANDA (Plano Basic) */}
            {ad && (
              <div className="bg-gradient-to-br from-indigo-950/40 via-slate-900/90 to-purple-950/30 border border-indigo-500/30 rounded-3xl p-5 shadow-xl relative overflow-hidden">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 bg-indigo-500/10 px-2.5 py-0.5 rounded-full border border-indigo-500/20">
                    📢 Patrocínio Portaria
                  </span>
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                </div>
                
                {ad.banner_url && (
                  <img
                    src={ad.banner_url}
                    alt={ad.title}
                    className="w-full h-32 object-cover rounded-2xl mb-3 border border-slate-800"
                  />
                )}

                <h4 className="text-sm font-bold text-white mb-1">
                  {ad.title}
                </h4>
                <p className="text-xs text-slate-300 mb-3 leading-relaxed">
                  {ad.description}
                </p>

                {ad.cta_url && (
                  <a
                    href={ad.cta_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      if (ad.id) {
                        fetch(`/api/ads/${ad.id}/click`, { method: 'POST' }).catch(() => {});
                      }
                    }}
                    className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition shadow-lg shadow-indigo-600/30"
                  >
                    <span>{ad.cta_text || 'Aproveitar Oferta'}</span>
                  </a>
                )}
              </div>
            )}

            {/* DETALHES DA ENCOMENDA */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-3.5 text-xs text-slate-300">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-emerald-400" />
                Dados de Entrega
              </h4>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800/80">
                  <span className="text-slate-500 block text-[10px] uppercase font-bold">Unidade</span>
                  <span className="font-bold text-slate-100 text-sm mt-0.5 block">
                    {pkg.unit ? `${pkg.unit.block} - Apto ${pkg.unit.unit_number}` : 'Unidade'}
                  </span>
                </div>

                <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800/80">
                  <span className="text-slate-500 block text-[10px] uppercase font-bold">Remetente</span>
                  <span className="font-bold text-slate-100 text-sm mt-0.5 block truncate">
                    {pkg.carrier}
                  </span>
                </div>

                <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800/80">
                  <span className="text-slate-500 block text-[10px] uppercase font-bold">Destinatário</span>
                  <span className="font-semibold text-slate-200 mt-0.5 block truncate">
                    {pkg.recipient_name}
                  </span>
                </div>

                <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800/80">
                  <span className="text-slate-500 block text-[10px] uppercase font-bold">Recebido Em</span>
                  <span className="font-semibold text-slate-200 mt-0.5 block">
                    {formattedDate}
                  </span>
                </div>
              </div>

              {pkg.tracking_code && (
                <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800/80 flex items-center justify-between mt-3">
                  <div>
                    <span className="text-slate-500 block text-[10px] uppercase font-bold">Rastreio / NF</span>
                    <span className="font-mono text-slate-200 font-semibold">{pkg.tracking_code}</span>
                  </div>
                  <Truck className="w-4 h-4 text-slate-500" />
                </div>
              )}

              {labelUrl && (
                <button
                  type="button"
                  onClick={() => setModalImage(labelUrl)}
                  className="w-full mt-4 flex items-center justify-center gap-2 py-3 px-4 bg-slate-800 hover:bg-slate-700 text-emerald-300 rounded-2xl font-semibold transition border border-slate-700"
                >
                  <Eye className="w-5 h-5 text-emerald-400" />
                  <span>Ver Foto da Etiqueta da Encomenda</span>
                </button>
              )}
            </div>

            {/* Botões de Ação quando Entregue - Conforme solicitado pelo usuário */}
            {isDelivered && (
              <div className="flex flex-col gap-3 mt-4 w-full animate-fade-in">
                {/* Botão Ver assinatura - Fundo Branco, Texto Preto */}
                <button
                  type="button"
                  onClick={() => setShowSignatureModal(true)}
                  className="w-full flex items-center justify-center py-4 px-6 bg-white hover:bg-slate-100 active:scale-[0.98] text-slate-950 rounded-2xl font-black text-base transition-all shadow-xl tracking-wide cursor-pointer border border-slate-200"
                >
                  Ver assinatura
                </button>
                
                {/* Botão Não fiz a retirada - Fundo Vermelho Vibrante, Texto Branco */}
                <a
                  href={targetWhatsappPhone ? `https://wa.me/${targetWhatsappPhone}?text=${encodeURIComponent(
                    `⚠️ *CONTESTAÇÃO DE RETIRADA*\n\nOlá, consta no sistema que a minha encomenda de *${pkg?.carrier || 'encomenda'}* (Código: *${pkg?.pickup_code}*, Destinatário: *${pkg?.recipient_name}*, Unidade: *${pkg?.unit ? `${pkg.unit.block} - Apto ${pkg.unit.unit_number}` : 'minha unidade'}*) foi registrada como retirada, mas eu *NÃO FIZ A RETIRADA*!\n\nSolicito verificar na portaria com urgência.`
                  )}` : '#'}
                  onClick={(e) => {
                    if (!targetWhatsappPhone) {
                      e.preventDefault();
                      alert('A portaria ainda não conectou o WhatsApp via QR Code no sistema.');
                    }
                  }}
                  target={targetWhatsappPhone ? '_blank' : undefined}
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center py-4 px-6 bg-[#EF4444] hover:bg-[#DC2626] active:scale-[0.98] text-white rounded-2xl font-black text-base transition-all shadow-xl shadow-red-500/25 tracking-wide cursor-pointer"
                >
                  Não fiz a retirada
                </a>
              </div>
            )}

            {/* Rodapé Informativo */}
            <div className="text-center py-4 text-[11px] text-slate-500">
              Sistema CondoBox • Portaria Inteligente
            </div>
          </div>
        )}
      </div>

      {/* Modal de Foto Ampliada */}
      {modalImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in"
          onClick={() => setModalImage(null)}
        >
          <div className="relative max-w-lg w-full bg-slate-900 border border-slate-800 rounded-3xl p-4 shadow-2xl flex flex-col items-center space-y-3">
            <img
              src={modalImage}
              alt="Foto da Etiqueta"
              className="max-h-[70vh] w-auto object-contain rounded-2xl"
            />
            <button
              onClick={() => setModalImage(null)}
              className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition"
            >
              Fechar Foto
            </button>
          </div>
        </div>
      )}

      {/* Modal de Visualização da Assinatura Digital */}
      {showSignatureModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in"
          onClick={() => setShowSignatureModal(false)}
        >
          <div
            className="relative max-w-sm w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl flex flex-col items-center space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-12 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-2xl flex items-center justify-center">
              <ShieldCheck className="w-6 h-6" />
            </div>

            <div className="text-center space-y-1">
              <h3 className="text-base font-bold text-white">Assinatura Digital de Retirada</h3>
              <p className="text-xs text-slate-400">
                Registrada eletronicamente no sistema da portaria
              </p>
            </div>

            {signatureUrl ? (
              <div className="w-full p-4 bg-white rounded-2xl border border-slate-200 shadow-inner flex items-center justify-center min-h-[140px]">
                <img
                  src={signatureUrl}
                  alt="Assinatura de Retirada"
                  className="max-h-36 max-w-full object-contain"
                />
              </div>
            ) : (
              <div className="w-full p-6 bg-slate-950 rounded-2xl border border-slate-800 text-center space-y-2">
                <p className="text-xs text-slate-300 font-semibold">Assinatura Coletada na Portaria</p>
                <p className="text-[11px] text-slate-500">Comprovante arquivado com segurança no sistema.</p>
              </div>
            )}

            <div className="w-full bg-slate-950/70 p-3.5 rounded-2xl border border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Retirado por:</span>
                <span className="font-bold text-slate-100">{pkg?.delivered_to_name || 'Morador'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Data e Hora:</span>
                <span className="font-bold text-slate-100">{deliveredDate || 'Registrado'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Código de Retirada:</span>
                <span className="font-mono font-bold text-emerald-400">{pkg?.pickup_code}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowSignatureModal(false)}
              className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition"
            >
              Fechar Assinatura
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

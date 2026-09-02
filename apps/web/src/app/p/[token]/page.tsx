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
  const [isUnlocked, setIsUnlocked] = useState(false);

  useEffect(() => {
    if (token) {
      loadPackage();
    }
  }, [token]);

  // Real-time Push Subscription + Fallback Polling
  useEffect(() => {
    if (!pkg?.id || pkg.status === 'DELIVERED') return;

    // Supabase Realtime Broadcast para atualização instantânea
    const supabase = createClient();
    const channel = supabase.channel(`public-package-${pkg.id}`)
      .on('broadcast', { event: 'status-updated' }, (payload) => {
        if (payload.payload?.status === 'DELIVERED') {
          loadPackage();
        }
      })
      .subscribe();

    // Fallback de polling a cada 5 segundos (garantia caso o broadcast falhe ou websocket caia)
    const interval = setInterval(() => {
      fetch(`/api/package/${token}`)
        .then(res => res.json())
        .then(data => {
          if (data.package && data.package.status === 'DELIVERED') {
            loadPackage();
          }
        })
        .catch(() => {});
    }, 5000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [pkg?.id, pkg?.status]);

  const loadPackage = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/package/${token}`);
      const data = await res.json();
      if (res.ok && data.package) {
        setPkg(data.package);
        if (data.ad) {
          setAd(data.ad);
        }
        // Verifica se o usuário já desbloqueou este QR code localmente
        if (typeof window !== 'undefined' && localStorage.getItem(`unlocked_${data.package.pickup_code}`) === 'true') {
          setIsUnlocked(true);
        }
      } else {
        setError(data.error || 'Encomenda não encontrada.');
      }
    } catch (err: any) {
      setError('Não foi possível carregar as informações da encomenda.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCode = () => {
    if (pkg?.pickup_code) {
      navigator.clipboard.writeText(pkg.pickup_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
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
              onClick={loadPackage}
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
                      onClick={() => {
                        setIsUnlocked(true);
                        localStorage.setItem(`unlocked_${pkg.pickup_code}`, 'true');
                        // Usa o scheme nativo do WhatsApp em vez do wa.me para evitar a página intermediária no navegador
                        const whatsappUrl = `whatsapp://send?phone=557398419901&text=${encodeURIComponent(`Estou ciente da encomenda ${pkg.pickup_code}`)}`;
                        // Cria um iframe invisível para forçar a abertura do app nativo sem navegar a página atual
                        const iframe = document.createElement('iframe');
                        iframe.style.display = 'none';
                        iframe.src = whatsappUrl;
                        document.body.appendChild(iframe);
                        
                        // Remove o iframe depois para limpeza
                        setTimeout(() => {
                          if (document.body.contains(iframe)) {
                            document.body.removeChild(iframe);
                          }
                        }, 2000);
                      }}
                      className="w-full py-4 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl text-sm font-bold flex flex-col items-center justify-center gap-2 shadow-[0_0_40px_rgba(16,185,129,0.4)] transition hover:scale-105 active:scale-95 border border-emerald-400/50"
                    >
                      <div className="flex items-center gap-2">
                        <MessageSquare className="w-5 h-5 text-emerald-100" />
                        <span>Confirmar e Liberar QR Code</span>
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

            {/* Botões - Exibidos fora do card DADOS DE ENTREGA para destaque quando entregue */}
            {isDelivered && (
              <div className="flex flex-col gap-3 mt-4 w-full">
                {signatureUrl && (
                  <button
                    type="button"
                    onClick={() => setModalImage(signatureUrl)}
                    className="w-full flex items-center justify-center py-4 px-4 bg-white hover:bg-gray-100 text-black rounded-full font-bold text-[15px] transition shadow-md"
                  >
                    Ver assinatura
                  </button>
                )}
                
                <a
                  href={`https://wa.me/${pkg?.condo_phone?.replace(/\D/g, '') || ''}?text=Ol%C3%A1%2C+consta+no+sistema+que+minha+encomenda+%28c%C3%B3digo+${pkg?.pickup_code}%29+foi+retirada%2C+mas+eu+n%C3%A3o+fiz+a+retirada.`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center py-4 px-4 bg-[#FF3B30] hover:bg-[#FF453A] text-white rounded-full font-bold text-[15px] transition shadow-md mt-2"
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
    </div>
  );
}
